from __future__ import annotations

import re

GROUNDING_TAGS = ("<|ref|>", "<|/ref|>", "<|det|>", "<|/det|>")


class GroundingTokenFilter:
    """Incrementally removes Unlimited-OCR grounding tags and coordinates."""

    def __init__(self) -> None:
        self._buffer = ""
        self._inside_detection = False

    def feed(self, chunk: str) -> str:
        self._buffer += chunk
        output: list[str] = []

        while self._buffer:
            if self._inside_detection:
                closing = "<|/det|>"
                index = self._buffer.find(closing)
                if index >= 0:
                    self._buffer = self._buffer[index + len(closing) :]
                    self._inside_detection = False
                    continue
                self._buffer = self._possible_token_suffix(self._buffer, (closing,))
                break

            matched = False
            for marker in GROUNDING_TAGS:
                if self._buffer.startswith(marker):
                    self._buffer = self._buffer[len(marker) :]
                    self._inside_detection = marker == "<|det|>"
                    matched = True
                    break
            if matched:
                continue

            if any(token.startswith(self._buffer) for token in GROUNDING_TAGS):
                break

            output.append(self._buffer[0])
            self._buffer = self._buffer[1:]

        return "".join(output)

    def finish(self) -> str:
        if self._inside_detection:
            self._buffer = ""
            return ""
        remainder = self._buffer
        self._buffer = ""
        for token in GROUNDING_TAGS:
            remainder = remainder.replace(token, "")
        return remainder

    @staticmethod
    def _possible_token_suffix(value: str, tokens: tuple[str, ...]) -> str:
        for length in range(min(max(map(len, tokens)), len(value)), 0, -1):
            suffix = value[-length:]
            if any(token.startswith(suffix) for token in tokens):
                return suffix
        return ""


def clean_markdown(raw: str) -> str:
    cleaner = GroundingTokenFilter()
    return (cleaner.feed(raw) + cleaner.finish()).strip()


def markdown_to_text(markdown: str) -> str:
    text = re.sub(r"```[^\n]*\n?", "", markdown)
    text = text.replace("```", "")
    text = re.sub(r"!\[([^]]*)]\([^)]+\)", r"\1", text)
    text = re.sub(r"\[([^]]+)]\([^)]+\)", r"\1", text)
    text = re.sub(r"^\s{0,3}#{1,6}\s+", "", text, flags=re.MULTILINE)
    text = re.sub(r"^\s*>\s?", "", text, flags=re.MULTILINE)
    text = re.sub(r"[*_~`]", "", text)
    return re.sub(r"\n{3,}", "\n\n", text).strip()
