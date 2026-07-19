"""Tiny vLLM-compatible mock used only for local container smoke tests."""

from __future__ import annotations

import json
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


class Handler(BaseHTTPRequestHandler):
    def do_GET(self) -> None:
        if self.path == "/v1/models":
            payload = json.dumps({"data": [{"id": "baidu/Unlimited-OCR"}]}).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)
            return
        self.send_error(404)

    def do_POST(self) -> None:
        if self.path != "/v1/chat/completions":
            self.send_error(404)
            return
        length = int(self.headers.get("Content-Length", "0"))
        request = json.loads(self.rfile.read(length))
        assert request["skip_special_tokens"] is False
        assert request["messages"][0]["content"][0]["text"].startswith("<image>")
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.send_header("Cache-Control", "no-cache")
        self.end_headers()
        chunks = [
            "# Erkannter Titel\n\n<|ref|>Lokaler OCR-Test<|/ref|>",
            "<|det|>[[1,2,3,4]]<|/det|>\n\n"
            "<|ref|>image<|/ref|><|det|>[[100,200,600,650]]<|/det|>\n\n"
            "| A | B |\n|---|---|\n| 1 | 2 |",
        ]
        for chunk in chunks:
            event = json.dumps({"choices": [{"delta": {"content": chunk}}]})
            self.wfile.write(f"data: {event}\n\n".encode())
            self.wfile.flush()
        self.wfile.write(b"data: [DONE]\n\n")
        self.wfile.flush()

    def log_message(self, _format: str, *_args: object) -> None:
        return


if __name__ == "__main__":
    port = int(os.environ.get("MOCK_OCR_PORT", "8000"))
    ThreadingHTTPServer(("0.0.0.0", port), Handler).serve_forever()  # noqa: S104
