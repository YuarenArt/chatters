import json
import os
from locust import HttpUser, task, between, events
from locust.exception import RescheduleTask
from locust_plugins.users.socketio import SocketIOUser
from websocket import WebSocketConnectionClosedException

# Загружаем конфиг
config_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "test_config.json")
with open(config_path, "r") as f:
    config = json.load(f)

class ChatUser(HttpUser, SocketIOUser):
    wait_time = between(1, 5)
    host = config["host"]

    def on_start(self):
        self.room_id = None
        self.ws_connected = False

        # Создаем комнату
        for endpoint in config["endpoints"]:
            if endpoint["name"] == "create_room":
                try:
                    response = self.client.post(endpoint["path"], json=endpoint["body"])
                    if response.status_code == 201:
                        self.room_id = response.json().get("room_id")
                        print(f"Room created: {self.room_id}")
                    else:
                        print(f"Failed to create room: {response.status_code}")
                except Exception as e:
                    print(f"Error creating room: {e}")
                break

        # Подключаемся к WebSocket, если комната создана
        if self.room_id:
            ws_endpoint = next((e for e in config["endpoints"] if e["name"] == "websocket_chat"), None)
            if ws_endpoint:
                ws_path = ws_endpoint["path"].format(room_id=self.room_id)
                # Исправляем формирование ws_url, убираем лишний символ ':'
                ws_url = f"ws{self.host[4:]}{ws_path}"  # ws://localhost:8080/api/ws/{room_id}
                username = ws_endpoint["username"].format(id=self.environment.runner.user_count)
                try:
                    print(f"Connecting to WebSocket: {ws_url}?username={username}")
                    # Передаем username как параметр query
                    self.connect(f"{ws_url}?username={username}")
                    self.ws_connected = True
                    print("WebSocket connected successfully")
                except Exception as e:
                    print(f"WebSocket connection failed: {e}")
                    self.ws_connected = False

    @task(2)
    def health_check(self):
        endpoint = next(e for e in config["endpoints"] if e["name"] == "health_check")
        try:
            response = self.client.get(endpoint["path"])
            if response.status_code >= 400:
                raise Exception(f"Health check failed: {response.status_code}")
        except Exception as e:
            print(f"Error executing health_check: {e}")
            raise RescheduleTask()

    @task(1)
    def create_room(self):
        endpoint = next(e for e in config["endpoints"] if e["name"] == "create_room")
        try:
            response = self.client.post(endpoint["path"], json=endpoint["body"])
            if response.status_code == 201:
                self.room_id = response.json().get("room_id")
                print(f"Room created: {self.room_id}")
            else:
                raise Exception(f"Failed to create room: {response.status_code}")
        except Exception as e:
            print(f"Error executing create_room: {e}")
            raise RescheduleTask()

    @task(1)
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
            print(f"Error executing get_room_info: {e}")
            raise RescheduleTask()

    @task(5)
    def websocket_chat(self):
        if not self.room_id or not self.ws_connected:
            raise RescheduleTask()

        ws_endpoint = next(e for e in config["endpoints"] if e["name"] == "websocket_chat")
        username = ws_endpoint["username"].format(id=self.environment.runner.user_count)
        for msg in ws_endpoint["messages"]:
            content = msg["content"].format(room_id=self.room_id, id=self.environment.runner.user_count)
            payload = {
                "type": msg["type"],
                "content": content,
                "username": username
            }
            try:
                self.send(json.dumps(payload))
                print(f"Sent WebSocket message: {payload}")
                self.receive()  # Опционально: ожидаем ответа от сервера
            except WebSocketConnectionClosedException as e:
                print(f"WebSocket connection closed: {e}")
                self.ws_connected = False
                raise RescheduleTask()
            except Exception as e:
                print(f"Error sending WebSocket message: {e}")
                raise RescheduleTask()

    def on_stop(self):
        if self.ws_connected:
            try:
                self.disconnect()
                print("WebSocket disconnected")
            except Exception as e:
                print(f"Error disconnecting WebSocket: {e}")
            finally:
                self.ws_connected = False