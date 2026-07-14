from app.services.output_filter import GroundingTokenFilter, clean_markdown, markdown_to_text


def test_clean_markdown_removes_grounding_coordinates() -> None:
    raw = "# Titel\n<|ref|>Hallo Welt<|/ref|><|det|>[[12, 4, 99, 31]]<|/det|>\nEnde"
    assert clean_markdown(raw) == "# Titel\nHallo Welt\nEnde"


def test_incremental_filter_handles_split_tags() -> None:
    cleaner = GroundingTokenFilter()
    chunks = ["vor<|re", "f|>Text<|/ref|><|d", "et|>[1,2]", "<|/det|>nach"]
    result = "".join(cleaner.feed(chunk) for chunk in chunks) + cleaner.finish()
    assert result == "vorTextnach"


def test_markdown_to_text_keeps_readable_content() -> None:
    markdown = "# Titel\n\nEin **wichtiger** [Link](https://example.com)."
    assert markdown_to_text(markdown) == "Titel\n\nEin wichtiger Link."
