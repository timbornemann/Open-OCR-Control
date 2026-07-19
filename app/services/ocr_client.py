from __future__ import annotations

import asyncio
import base64
import json
from collections.abc import AsyncIterator
from pathlib import Path
from typing import Any

import httpx

from app.config import Settings


class OcrServiceError(RuntimeError):
    pass


class OcrClient:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings

    def _client(self, *, short_timeout: bool = False) -> httpx.AsyncClient:
        timeout = httpx.Timeout(
            3.0 if short_timeout else self.settings.request_timeout_seconds,
            connect=2.0 if short_timeout else self.settings.connect_timeout_seconds,
        )
        return httpx.AsyncClient(
            base_url=self.settings.base_url.rstrip("/"),
            headers={"Authorization": f"Bearer {self.settings.api_key}"},
            timeout=timeout,
            trust_env=False,
        )

    async def is_ready(self) -> bool:
        try:
            async with self._client(short_timeout=True) as client:
                response = await client.get("/models")
                return response.is_success
        except httpx.HTTPError:
            return False

    async def stream_page(self, image_path: Path, max_tokens: int) -> AsyncIterator[str]:
        image_bytes = await asyncio.to_thread(image_path.read_bytes)
        encoded = base64.b64encode(image_bytes).decode("ascii")
        payload: dict[str, Any] = {
            "model": self.settings.model,
            "messages": [
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": "<image>document parsing."},
                        {
                            "type": "image_url",
                            "image_url": {"url": f"data:image/jpeg;base64,{encoded}"},
                        },
                    ],
                }
            ],
            "max_tokens": max_tokens,
            "temperature": 0.0,
            "stream": True,
            "skip_special_tokens": False,
            "vllm_xargs": {"ngram_size": 35, "window_size": 128},
        }
        try:
            async with self._client() as client:
                async with client.stream("POST", "/chat/completions", json=payload) as response:
                    if not response.is_success:
                        body = (await response.aread()).decode("utf-8", errors="replace")[-1000:]
                        raise OcrServiceError(
                            f"OCR-Dienst antwortet mit HTTP {response.status_code}: {body}"
                        )
                    async for line in response.aiter_lines():
                        if not line.startswith("data: "):
                            continue
                        data = line[6:]
                        if data == "[DONE]":
                            break
                        try:
                            event = json.loads(data)
                            delta = event["choices"][0].get("delta", {}).get("content") or ""
                        except (json.JSONDecodeError, KeyError, IndexError, TypeError) as exc:
                            raise OcrServiceError(
                                "Der OCR-Dienst hat einen ungültigen Stream geliefert."
                            ) from exc
                        if delta:
                            yield delta
        except httpx.TimeoutException as exc:
            raise OcrServiceError("Zeitüberschreitung beim OCR-Dienst.") from exc
        except httpx.HTTPError as exc:
            raise OcrServiceError(f"Verbindung zum OCR-Dienst fehlgeschlagen: {exc}") from exc
