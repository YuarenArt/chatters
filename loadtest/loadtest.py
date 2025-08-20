import json
import os
import time
import traceback
from locust import HttpUser, task, between, events
from locust.exception import RescheduleTask
from websocket import create_connection, WebSocketConnectionClosedException

config_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "test_config.json")
with open(config_path, "r") as f:
    config = json.load(f)


class ChatUser(HttpUser):
    wait_time = between(1, 5)
    host = config["host"]

    def on_start(self):
        self.room_id = None
        self.ws = None
        self.ws_connected = False

        for endpoint in config["endpoints"]:
            if endpoint["name"] == "create_room":
                try:
                    response = self.client.post(endpoint["path"], json=endpoint["body"])
                    if response.status_code == 201:
                        self.room_id = response.json().get("room_id")
                        print(f"[INFO] Room created: {self.room_id}")
                    else:
                        print(f"[ERROR] Failed to create room: {response.status_code}, body={response.text}")
                except Exception as e:
                    print(f"[EXCEPTION] Error creating room: {e}")
                    traceback.print_exc()
                break

        if self.room_id:
            ws_endpoint = next((e for e in config["endpoints"] if e["name"] == "websocket_chat"), None)
            if ws_endpoint:
                ws_path = ws_endpoint["path"].format(room_id=self.room_id)
                ws_url = f"ws{self.host[4:]}{ws_path}"
                username = ws_endpoint["username"].format(id=self.environment.runner.user_count)

                try:
                    print(f"[INFO] Connecting to WebSocket: {ws_url}?username={username}")
                    self.ws = create_connection(f"{ws_url}?username={username}")
                    self.ws_connected = True
                    print("[INFO] WebSocket connected successfully")

                    # Сразу читаем приветственное сообщение от сервера
                    initial_msg = self.ws.recv()
                    print(f"[DEBUG] Initial WS message: {initial_msg}")

                except Exception as e:
                    print(f"[ERROR] WebSocket connection failed: {e}")
                    traceback.print_exc()
                    self.ws_connected = False

    @task(1)
    def health_check(self):
        endpoint = next(e for e in config["endpoints"] if e["name"] == "health_check")
        try:
            response = self.client.get(endpoint["path"])
            if response.status_code >= 400:
                raise Exception(f"Health check failed: {response.status_code}")
        except Exception as e:
            print(f"[ERROR] Error executing health_check: {e}")
            raise RescheduleTask()

    @task(15)
    def get_room_info(self):
        endpoint = next(e for e in config["endpoints"] if e["name"] == "get_room_info")
        path = endpoint["path"]
        if "{room_id}" in path:
            if not self.room_id:
                raise RescheduleTask()
            path = path.format(room_id=self.room_id)

        try:
            response = self.client.get(path)
            if response.status_code >= 400:
                raise Exception(f"Get room info failed: {response.status_code}")
        except Exception as e:
            print(f"[ERROR] Error executing get_room_info: {e}")
            raise RescheduleTask()

    @task(40)
    def websocket_chat(self):
        if not self.room_id or not self.ws_connected:
            raise RescheduleTask()

        ws_endpoint = next(e for e in config["endpoints"] if e["name"] == "websocket_chat")

        for msg in ws_endpoint["messages"]:
            text_template = msg["data"]["text"]
            text = text_template.format(room_id=self.room_id, id=self.environment.runner.user_count)

            payload = {
                "type": msg["type"],
                "data": {
                    "text": text,
                    "username": msg["data"]["username"].format(id=self.environment.runner.user_count)
                }
            }

            try:
                self.ws.send(json.dumps(payload))
                print(f"[SEND] {payload}")

                # Ждём ответ
                reply = self.ws.recv()
                print(f"[RECV] {reply}")

            except WebSocketConnectionClosedException as e:
                print(f"[WARN] WebSocket connection closed: {e}")
                self.ws_connected = False
                raise RescheduleTask()
            except Exception as e:
                print(f"[ERROR] Error sending WS message: {e}")
                traceback.print_exc()
                raise RescheduleTask()

    def on_stop(self):
        if self.ws_connected and self.ws:
            try:
                self.ws.close()
                print("[INFO] WebSocket disconnected")
            except Exception as e:
                print(f"[ERROR] Error disconnecting WebSocket: {e}")
            finally:
                self.ws_connected = False
