import json
from pathlib import Path

import httpx
import pytest

from app.config import Settings
from app.services.ocr_client import OcrClient


@pytest.mark.asyncio
async def test_stream_page_sends_required_recipe_and_cleans_output(tmp_path: Path) -> None:
    image = tmp_path / "page.jpg"
    image.write_bytes(b"fake-jpeg")
    captured: dict[str, object] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        payload = json.loads(request.content)
        captured.update(payload)
        stream = (
            'data: {"choices":[{"delta":{"content":"<|ref|>Hallo"}}]}\n\n'
            'data: {"choices":[{"delta":{"content":" Welt<|/ref|><|det|>[1,2]<|/det|>"}}]}\n\n'
            "data: [DONE]\n\n"
        )
        return httpx.Response(200, content=stream, headers={"content-type": "text/event-stream"})

    client = OcrClient(Settings(base_url="http://ocr.test/v1"))
    transport = httpx.MockTransport(handler)
    monkey_client = httpx.AsyncClient(
        base_url="http://ocr.test/v1",
        transport=transport,
        headers={"Authorization": "Bearer EMPTY"},
    )
    client._client = lambda **_kwargs: monkey_client  # type: ignore[method-assign]

    output = "".join([chunk async for chunk in client.stream_page(image, 4096)])

    assert output == "Hallo Welt"
    assert captured["skip_special_tokens"] is False
    assert captured["vllm_xargs"] == {"ngram_size": 35, "window_size": 128}
    messages = captured["messages"]
    assert isinstance(messages, list)
    assert messages[0]["content"][0]["text"].startswith("<image>")
