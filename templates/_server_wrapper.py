"""Minimal Battlesnake server wrapper for local testing.
Used internally by `snake-arena test`.
Usage: python _server_wrapper.py <strategy.py> [port]
"""

import importlib.util
import json
import sys
from http.server import HTTPServer, BaseHTTPRequestHandler


class H(BaseHTTPRequestHandler):
    fn = None

    def do_GET(self):
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(json.dumps({"apiversion": "1"}).encode())

    def do_POST(self):
        length = int(self.headers.get("Content-Length", 0))
        body = json.loads(self.rfile.read(length)) if length else {}
        if self.path == "/move":
            try:
                move = self.__class__.fn(body)
                if move not in ("up", "down", "left", "right"):
                    move = "up"
            except Exception:
                move = "up"
            resp = {"move": move}
        else:
            resp = {"ok": True}
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(json.dumps(resp).encode())

    def log_message(self, format, *args):
        pass


spec = importlib.util.spec_from_file_location("s", sys.argv[1])
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)
H.fn = mod.decide_move
port = int(sys.argv[2]) if len(sys.argv) > 2 else 8080
server = HTTPServer(("0.0.0.0", port), H)
print(f"Snake server on port {port}", flush=True)
server.serve_forever()
