import os
import json
import time
import threading
import jwt
import websocket
from locust import task, between, events, User

STORM_HOST = os.environ.get("STORM_HOST", "http://4.233.24.65")
JWT_SECRET = os.environ.get("JWT_SECRET", "storm-prod-jwt-secret-change-me")
CHANNELS = [f"chan-{i}" for i in range(1, 21)]

# Pre-created users: storm_1 to storm_100000
# Each Locust user picks a unique ID based on greenlet identity


class WebSocketUser(User):
    wait_time = between(0.5, 1.5)
    abstract = False
    _user_counter = 0
    _counter_lock = threading.Lock()

    def on_start(self):
        # Get a unique user ID
        with WebSocketUser._counter_lock:
            WebSocketUser._user_counter += 1
            self.user_num = WebSocketUser._user_counter

        self.channel = CHANNELS[self.user_num % len(CHANNELS)]
        self.ws = None
        self.running = True

        # Generate JWT locally (no API call)
        self.token = jwt.encode(
            {
                "sub": f"00000000-0000-0000-0000-{self.user_num:012d}",
                "username": f"storm_{self.user_num}",
                "exp": int(time.time()) + 86400,
            },
            JWT_SECRET,
            algorithm="HS256",
        )

        self._connect()

    def _connect(self):
        ws_host = STORM_HOST.replace("http://", "ws://").replace("https://", "wss://")
        ws_url = f"{ws_host}/ws?token={self.token}"

        start = time.time()
        try:
            self.ws = websocket.create_connection(ws_url, timeout=15)
            elapsed = (time.time() - start) * 1000
            events.request.fire(
                request_type="WS",
                name="connect",
                response_time=elapsed,
                response_length=0,
                exception=None,
            )
            self._reader = threading.Thread(target=self._read_loop, daemon=True)
            self._reader.start()
        except Exception as e:
            elapsed = (time.time() - start) * 1000
            events.request.fire(
                request_type="WS",
                name="connect",
                response_time=elapsed,
                response_length=0,
                exception=e,
            )
            self.ws = None

    def _read_loop(self):
        while self.running and self.ws:
            try:
                self.ws.settimeout(2)
                data = self.ws.recv()
                try:
                    msg = json.loads(data)
                    msg_type = msg.get("type", "unknown")
                    events.request.fire(
                        request_type="WS",
                        name=f"recv:{msg_type}",
                        response_time=0,
                        response_length=len(data),
                        exception=None,
                    )
                except json.JSONDecodeError:
                    pass
            except websocket.WebSocketTimeoutException:
                continue
            except Exception:
                break

    @task(5)
    def send_message(self):
        if not self.ws:
            self._connect()
            return

        msg = json.dumps({
            "type": "send_message",
            "channel_id": self.channel,
            "content": f"s{time.time()}",
        })

        start = time.time()
        try:
            self.ws.send(msg)
            elapsed = (time.time() - start) * 1000
            events.request.fire(
                request_type="WS",
                name="send_message",
                response_time=elapsed,
                response_length=len(msg),
                exception=None,
            )
        except Exception as e:
            elapsed = (time.time() - start) * 1000
            events.request.fire(
                request_type="WS",
                name="send_message",
                response_time=elapsed,
                response_length=0,
                exception=e,
            )
            self.ws = None

    @task(1)
    def ping(self):
        if not self.ws:
            return

        start = time.time()
        try:
            self.ws.send(json.dumps({"type": "ping"}))
            elapsed = (time.time() - start) * 1000
            events.request.fire(
                request_type="WS",
                name="ping",
                response_time=elapsed,
                response_length=0,
                exception=None,
            )
        except Exception as e:
            elapsed = (time.time() - start) * 1000
            events.request.fire(
                request_type="WS",
                name="ping",
                response_time=elapsed,
                response_length=0,
                exception=e,
            )
            self.ws = None

    def on_stop(self):
        self.running = False
        if self.ws:
            try:
                self.ws.close()
            except Exception:
                pass
