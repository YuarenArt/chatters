import json
import os
import time
import traceback
import random
from locust import HttpUser, task, between, events
from locust.exception import RescheduleTask
from websocket import create_connection, WebSocketConnectionClosedException

# Загрузка конфигурации
config_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "test_config.json")
with open(config_path, "r") as f:
    config = json.load(f)

# Кастомные метрики для WebSocket
@events.request.add_listener
def on_request(request_type, name, response_time, response_length, exception, **kwargs):
    if name == "websocket_chat":
        if exception:
            events.request.fire(
                request_type="WS",
                name="WS_Messages",
                response_time=response_time,
                response_length=response_length,
                exception=exception
            )
        else:
            events.request.fire(
                request_type="WS",
                name="WS_Messages",
                response_time=response_time,
                response_length=response_length,
                exception=None
            )

# Базовый класс пользователя
class ChatUser(HttpUser):
    wait_time = between(1, 5)
    host = config["host"]

    def on_start(self):
        self.room_id = None
        self.host_token = None
        self.room_password = None
        self.ws = None
        self.ws_connected = False
        self.is_host = False

        create_endpoints = [e for e in config["endpoints"] if e["name"] in ["create_room", "create_room_no_password"]]
        for endpoint in create_endpoints:
            try:
                response = self.client.post(endpoint["path"], json=endpoint["body"])
                if response.status_code == 201:
                    data = response.json()
                    self.room_id = data.get("room_id")
                    self.host_token = data.get("host_token")
                    self.is_host = True
                    if "password" in endpoint["body"]:
                        self.room_password = endpoint["body"]["password"]
                    break
            except Exception as e:
                traceback.print_exc()

        if self.room_id:
            ws_endpoint_name = "websocket_chat" if self.room_password else "websocket_chat_no_password"
            ws_endpoint = next((e for e in config["endpoints"] if e["name"] == ws_endpoint_name), None)

            if ws_endpoint:
                ws_path = ws_endpoint["path"].format(room_id=self.room_id)
                ws_url = f"ws{self.host[4:]}{ws_path}"
                username = ws_endpoint["username"].format(id=self.environment.runner.user_count)

                params = [f"username={username}"]
                if self.room_password and "password" in ws_endpoint:
                    params.append(f"password={self.room_password}")
                if self.host_token and "host_token" in ws_endpoint:
                    params.append(f"host_token={self.host_token}")

                full_ws_url = f"{ws_url}?{'&'.join(params)}"

                try:
                    self.ws = create_connection(full_ws_url)
                    self.ws_connected = True
                    initial_msg = self.ws.recv()
                except Exception as e:
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
            traceback.print_exc()
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
            traceback.print_exc()
            raise RescheduleTask()

    @task(8)
    def validate_password(self):
        if not self.room_id or not self.room_password:
            raise RescheduleTask()

        endpoint = next((e for e in config["endpoints"] if e["name"] == "validate_password"), None)
        if not endpoint:
            raise RescheduleTask()

        path = endpoint["path"].format(room_id=self.room_id)

        try:
            response = self.client.post(path, json=endpoint["body"])
            if response.status_code >= 400:
                raise Exception(f"Password validation failed: {response.status_code}")
        except Exception as e:
            traceback.print_exc()
            raise RescheduleTask()

    @task(2)
    def change_password(self):
        if not self.room_id or not self.host_token or not self.is_host:
            raise RescheduleTask()

        endpoint = next((e for e in config["endpoints"] if e["name"] == "change_password"), None)
        if not endpoint:
            raise RescheduleTask()

        path = endpoint["path"].format(room_id=self.room_id)
        headers = {k: v.format(host_token=self.host_token) for k, v in endpoint["headers"].items()}

        try:
            response = self.client.put(path, json=endpoint["body"], headers=headers)
            if response.status_code >= 400:
                raise Exception(f"Change password failed: {response.status_code}")
        except Exception as e:
            traceback.print_exc()
            raise RescheduleTask()

    @task(40)
    def websocket_chat(self):
        if not self.room_id or not self.ws_connected:
            raise RescheduleTask()

        ws_endpoint_name = "websocket_chat" if self.room_password else "websocket_chat_no_password"
        ws_endpoint = next((e for e in config["endpoints"] if e["name"] == ws_endpoint_name), None)

        if not ws_endpoint:
            raise RescheduleTask()

        for msg in ws_endpoint["messages"]:
            text_template = msg["data"]["text"]
            text = text_template.format(room_id=self.room_id, id=self.environment.runner.user_count)

            payload = {
                "type": msg["type"],
                "data": {"text": text}
            }

            try:
                start_time = time.time()
                self.ws.send(json.dumps(payload))
                reply = self.ws.recv()
                response_time = (time.time() - start_time) * 1000
                events.request.fire(
                    request_type="WS",
                    name="websocket_chat",
                    response_time=response_time,
                    response_length=len(reply),
                    exception=None
                )
            except WebSocketConnectionClosedException as e:
                self.ws_connected = False
                events.request.fire(
                    request_type="WS",
                    name="websocket_chat",
                    response_time=0,
                    response_length=0,
                    exception=e
                )
                raise RescheduleTask()
            except Exception as e:
                traceback.print_exc()
                events.request.fire(
                    request_type="WS",
                    name="websocket_chat",
                    response_time=0,
                    response_length=0,
                    exception=str(e)
                )
                raise RescheduleTask()

    def on_stop(self):
        if self.ws_connected and self.ws:
            try:
                self.ws.close()
            except Exception as e:
                traceback.print_exc()
            finally:
                self.ws_connected = False

# Сценарий: Много сообщений при малом числе клиентов
class HighMessageUser(ChatUser):
    wait_time = between(0.1, 0.5)  # Минимальная задержка для высокой частоты

    @task(80)  # 80% задач — чат
    def websocket_chat_high_volume(self):
        if not self.room_id or not self.ws_connected:
            raise RescheduleTask()

        ws_endpoint = next((e for e in config["endpoints"] if e["name"] in ["websocket_chat", "websocket_chat_no_password"]), None)
        if not ws_endpoint:
            raise RescheduleTask()

        # Отправляем 10-20 сообщений подряд
        num_messages = random.randint(10, 20)
        for i in range(num_messages):
            for msg in ws_endpoint["messages"]:
                text_template = msg["data"]["text"]
                text = text_template.format(room_id=self.room_id, id=self.environment.runner.user_count, seq=i)

                payload = {
                    "type": msg["type"],
                    "data": {"text": text}
                }

                try:
                    start_time = time.time()
                    self.ws.send(json.dumps(payload))
                    reply = self.ws.recv()
                    response_time = (time.time() - start_time) * 1000
                    events.request.fire(
                        request_type="WS",
                        name="websocket_chat",
                        response_time=response_time,
                        response_length=len(reply),
                        exception=None
                    )
                except WebSocketConnectionClosedException as e:
                    self.ws_connected = False
                    events.request.fire(
                        request_type="WS",
                        name="websocket_chat",
                        response_time=0,
                        response_length=0,
                        exception=e
                    )
                    raise RescheduleTask()
                except Exception as e:
                    traceback.print_exc()
                    events.request.fire(
                        request_type="WS",
                        name="websocket_chat",
                        response_time=0,
                        response_length=0,
                        exception=str(e)
                    )
                    raise RescheduleTask()

    @task(10)
    def get_room_info(self):
        super().get_room_info()

    @task(10)
    def health_check(self):
        super().health_check()

# Сценарий: Мало сообщений при большом числе клиентов
class HighConcurrencyUser(ChatUser):
    wait_time = between(5, 10)  # Длинная задержка для низкой активности

    @task(5)  # Редкие сообщения (5% задач)
    def websocket_chat_low_volume(self):
        if not self.room_id or not self.ws_connected:
            raise RescheduleTask()

        ws_endpoint = next((e for e in config["endpoints"] if e["name"] in ["websocket_chat", "websocket_chat_no_password"]), None)
        if not ws_endpoint:
            raise RescheduleTask()

        msg = ws_endpoint["messages"][0]  # Только первое сообщение
        text_template = msg["data"]["text"]
        text = text_template.format(room_id=self.room_id, id=self.environment.runner.user_count)

        payload = {
            "type": msg["type"],
            "data": {"text": text}
        }

        try:
            start_time = time.time()
            self.ws.send(json.dumps(payload))
            reply = self.ws.recv()
            response_time = (time.time() - start_time) * 1000
            events.request.fire(
                request_type="WS",
                name="websocket_chat",
                response_time=response_time,
                response_length=len(reply),
                exception=None
            )
        except WebSocketConnectionClosedException as e:
            self.ws_connected = False
            events.request.fire(
                request_type="WS",
                name="websocket_chat",
                response_time=0,
                response_length=0,
                exception=e
            )
            raise RescheduleTask()
        except Exception as e:
            traceback.print_exc()
            events.request.fire(
                request_type="WS",
                name="websocket_chat",
                response_time=0,
                response_length=0,
                exception=str(e)
            )
            raise RescheduleTask()

    @task(20)  # Периодический пинг
    def websocket_ping(self):
        if not self.room_id or not self.ws_connected:
            raise RescheduleTask()

        try:
            start_time = time.time()
            self.ws.send(json.dumps({"type": "ping"}))
            reply = self.ws.recv()
            response_time = (time.time() - start_time) * 1000
            events.request.fire(
                request_type="WS",
                name="websocket_ping",
                response_time=response_time,
                response_length=len(reply),
                exception=None
            )
        except WebSocketConnectionClosedException as e:
            self.ws_connected = False
            events.request.fire(
                request_type="WS",
                name="websocket_ping",
                response_time=0,
                response_length=0,
                exception=e
            )
            raise RescheduleTask()
        except Exception as e:
            traceback.print_exc()
            events.request.fire(
                request_type="WS",
                name="websocket_ping",
                response_time=0,
                response_length=0,
                exception=str(e)
            )
            raise RescheduleTask()

    @task(30)  # Переподключение (churn)
    def websocket_churn(self):
        if self.ws_connected and self.ws:
            try:
                self.ws.close()
                self.ws_connected = False
            except Exception as e:
                traceback.print_exc()

        if self.room_id:
            ws_endpoint_name = "websocket_chat" if self.room_password else "websocket_chat_no_password"
            ws_endpoint = next((e for e in config["endpoints"] if e["name"] == ws_endpoint_name), None)
            if ws_endpoint:
                ws_path = ws_endpoint["path"].format(room_id=self.room_id)
                ws_url = f"ws{self.host[4:]}{ws_path}"
                username = ws_endpoint["username"].format(id=self.environment.runner.user_count)

                params = [f"username={username}"]
                if self.room_password:
                    params.append(f"password={self.room_password}")
                if self.host_token:
                    params.append(f"host_token={self.host_token}")

                full_ws_url = f"{ws_url}?{'&'.join(params)}"

                try:
                    start_time = time.time()
                    self.ws = create_connection(full_ws_url)
                    self.ws_connected = True
                    initial_msg = self.ws.recv()
                    response_time = (time.time() - start_time) * 1000
                    events.request.fire(
                        request_type="WS",
                        name="websocket_connect",
                        response_time=response_time,
                        response_length=len(initial_msg),
                        exception=None
                    )
                except Exception as e:
                    traceback.print_exc()
                    events.request.fire(
                        request_type="WS",
                        name="websocket_connect",
                        response_time=0,
                        response_length=0,
                        exception=str(e)
                    )
                    self.ws_connected = False
                    raise RescheduleTask()

    @task(25)
    def health_check(self):
        super().health_check()

    @task(25)
    def get_room_info(self):
        super().get_room_info()

    @task(25)
    def validate_password(self):
        super().validate_password()

# Сценарий: Смешанный трафик
class MixedLoadUser(ChatUser):
    wait_time = between(2, 4)

    @task(50)  # 50% — сообщения
    def websocket_chat(self):
        super().websocket_chat()

    @task(20)  # 20% — валидация
    def validate_password(self):
        super().validate_password()

    @task(15)  # 15% — смена пароля
    def change_password(self):
        super().change_password()

    @task(15)  # 15% — info/health
    def get_room_info(self):
        super().get_room_info()