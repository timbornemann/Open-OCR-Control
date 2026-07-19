from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_prefix="OCR_",
        case_sensitive=False,
        extra="ignore",
    )

    app_name: str = "Open OCR Control"
    app_version: str = "0.1.0"
    host: str = "0.0.0.0"  # noqa: S104 - container service must listen externally
    port: int = 3011
    data_dir: Path = Path("/data/jobs")
    static_dir: Path = Path(__file__).parent / "static"

    base_url: str = "http://localhost:3111/v1"
    model: str = "baidu/Unlimited-OCR"
    api_key: str = "EMPTY"
    hf_token: str | None = None
    request_timeout_seconds: float = 1800
    connect_timeout_seconds: float = 10
    start_timeout_seconds: int = 900

    manage_container: bool = True
    docker_image: str = "vllm/vllm-openai:unlimited-ocr"
    docker_container_name: str = "unlimited-ocr"
    docker_network: str | None = None
    docker_host_port: int = 3111
    gpu_memory_utilization: float = 0.85
    max_model_len: int = 32768
    shm_size: str = "8g"
    hf_xet_high_performance: bool = True

    max_upload_mb: int = 100
    max_batch_files: int = 25
    max_batch_upload_mb: int = 500
    max_pages: int = 200
    max_render_megapixels: int = 50
    default_dpi: int = 200
    default_page_concurrency: int = 2
    max_page_concurrency: int = 4
    default_max_tokens: int = 8192
    max_output_tokens: int = 32768
    office_timeout_seconds: int = 180
    job_retention_hours: int = 24
    event_history_limit: int = 10_000

    allowed_origins: list[str] = Field(default_factory=list)

    @property
    def max_upload_bytes(self) -> int:
        return self.max_upload_mb * 1024 * 1024

    @property
    def max_batch_upload_bytes(self) -> int:
        return self.max_batch_upload_mb * 1024 * 1024

    @property
    def ocr_root_url(self) -> str:
        return self.base_url.removesuffix("/v1").rstrip("/")


@lru_cache
def get_settings() -> Settings:
    return Settings()
