from __future__ import annotations

import asyncio
from typing import Any, cast

import docker
from docker.errors import DockerException, ImageNotFound, NotFound
from docker.models.containers import Container

from app.config import Settings
from app.models import OcrStatus
from app.services.ocr_client import OcrClient


class ContainerManagementError(RuntimeError):
    pass


class DockerManager:
    def __init__(self, settings: Settings, ocr_client: OcrClient) -> None:
        self.settings = settings
        self.ocr_client = ocr_client
        self._operation_lock = asyncio.Lock()

    async def status(self) -> OcrStatus:
        if await self.ocr_client.is_ready():
            return OcrStatus(
                state="ready",
                ready=True,
                managed=self.settings.manage_container,
                message="OCR-Modell ist bereit",
                model=self.settings.model,
                container_status="running",
            )

        container_status: str | None = None
        if self.settings.manage_container:
            try:
                container_status = await asyncio.to_thread(self._container_status_sync)
            except ContainerManagementError as exc:
                return OcrStatus(
                    state="unavailable",
                    ready=False,
                    managed=True,
                    message=str(exc),
                    model=self.settings.model,
                )

        if container_status == "running":
            state, message = "starting", "OCR-Container läuft; das Modell wird noch geladen"
        elif container_status:
            state, message = "stopped", f"OCR-Container ist {container_status}"
        elif self.settings.manage_container:
            state, message = "stopped", "OCR-Container ist noch nicht angelegt"
        else:
            state, message = "unavailable", "OCR-Dienst ist nicht erreichbar (externe Verwaltung)"
        return OcrStatus(
            state=state,
            ready=False,
            managed=self.settings.manage_container,
            message=message,
            model=self.settings.model,
            container_status=container_status,
        )

    async def start(self) -> OcrStatus:
        if not self.settings.manage_container:
            raise ContainerManagementError("Containerverwaltung ist deaktiviert.")
        async with self._operation_lock:
            await asyncio.to_thread(self._start_sync)
        return await self.status()

    async def stop(self) -> OcrStatus:
        if not self.settings.manage_container:
            raise ContainerManagementError("Containerverwaltung ist deaktiviert.")
        async with self._operation_lock:
            await asyncio.to_thread(self._stop_sync)
        return await self.status()

    async def shutdown(self) -> None:
        """Remove only containers created by this app so Compose can release its network."""
        if not self.settings.manage_container:
            return
        try:
            await asyncio.to_thread(self._cleanup_managed_sync)
        except ContainerManagementError:
            # Shutdown must not keep the ASGI process alive when Docker is unavailable.
            return

    async def ensure_ready(self) -> None:
        if await self.ocr_client.is_ready():
            return
        if self.settings.manage_container:
            await self.start()

        loop = asyncio.get_running_loop()
        deadline = loop.time() + self.settings.start_timeout_seconds
        while loop.time() < deadline:
            if await self.ocr_client.is_ready():
                return
            if self.settings.manage_container:
                status = await asyncio.to_thread(self._container_status_sync)
                if status in {"exited", "dead"}:
                    logs = await asyncio.to_thread(self._container_logs_sync)
                    raise ContainerManagementError(
                        f"OCR-Container wurde unerwartet beendet. Letzte Ausgabe: {logs}"
                    )
            await asyncio.sleep(3)
        raise ContainerManagementError(
            f"Das OCR-Modell war nach {self.settings.start_timeout_seconds} Sekunden nicht bereit."
        )

    def _docker_client(self) -> Any:
        try:
            return docker.from_env(timeout=10)
        except DockerException as exc:
            raise ContainerManagementError(
                "Docker ist nicht erreichbar. Prüfe den Docker-Socket und OCR_MANAGE_CONTAINER."
            ) from exc

    def _get_container(self, client: Any) -> Container | None:
        try:
            return client.containers.get(self.settings.docker_container_name)
        except NotFound:
            return None
        except DockerException as exc:
            raise ContainerManagementError(
                f"Docker-Status konnte nicht gelesen werden: {exc}"
            ) from exc

    def _container_status_sync(self) -> str | None:
        client = self._docker_client()
        try:
            container = self._get_container(client)
            if container is None:
                return None
            container.reload()
            return str(container.status)
        finally:
            client.close()

    def _start_sync(self) -> None:
        client = self._docker_client()
        try:
            container = self._get_container(client)
            if container is not None:
                self._connect_network(client, container)
                container.reload()
                if container.status != "running":
                    container.start()
                return

            try:
                client.images.get(self.settings.docker_image)
            except ImageNotFound:
                client.images.pull(self.settings.docker_image)

            command = [
                self.settings.model,
                "--trust-remote-code",
                "--logits_processors",
                "vllm.model_executor.models.unlimited_ocr:NGramPerReqLogitsProcessor",
                "--no-enable-prefix-caching",
                "--mm-processor-cache-gb",
                "0",
                "--gpu-memory-utilization",
                str(self.settings.gpu_memory_utilization),
                "--max-model-len",
                str(self.settings.max_model_len),
            ]
            run_options: dict[str, Any] = {
                "image": self.settings.docker_image,
                "command": command,
                "name": self.settings.docker_container_name,
                "detach": True,
                "ports": {"8000/tcp": ("127.0.0.1", self.settings.docker_host_port)},
                "shm_size": self.settings.shm_size,
                "volumes": {
                    "unlimited-ocr-cache": {
                        "bind": "/root/.cache/huggingface",
                        "mode": "rw",
                    }
                },
                "device_requests": [docker.types.DeviceRequest(count=-1, capabilities=[["gpu"]])],
                "labels": {"io.open-ocr-control.managed": "true"},
                "environment": {
                    "HF_XET_HIGH_PERFORMANCE": (
                        "1" if self.settings.hf_xet_high_performance else "0"
                    ),
                    **({"HF_TOKEN": self.settings.hf_token} if self.settings.hf_token else {}),
                },
            }
            if self.settings.docker_network:
                run_options["network"] = self.settings.docker_network
            client.containers.run(**run_options)
        except DockerException as exc:
            raise ContainerManagementError(
                f"OCR-Container konnte nicht gestartet werden: {exc}"
            ) from exc
        finally:
            client.close()

    def _connect_network(self, client: Any, container: Container) -> None:
        network_name = self.settings.docker_network
        if not network_name:
            return
        container.reload()
        networks = container.attrs.get("NetworkSettings", {}).get("Networks", {})
        if network_name in networks:
            return
        try:
            client.networks.get(network_name).connect(container)
        except DockerException as exc:
            raise ContainerManagementError(
                f"OCR-Container konnte nicht mit Netzwerk {network_name} verbunden werden: {exc}"
            ) from exc

    def _stop_sync(self) -> None:
        client = self._docker_client()
        try:
            container = self._get_container(client)
            if container is not None:
                container.reload()
                if container.status == "running":
                    container.stop(timeout=20)
                if container.labels.get("io.open-ocr-control.managed") == "true":
                    container.remove()
        except DockerException as exc:
            raise ContainerManagementError(
                f"OCR-Container konnte nicht gestoppt werden: {exc}"
            ) from exc
        finally:
            client.close()

    def _cleanup_managed_sync(self) -> None:
        client = self._docker_client()
        try:
            container = self._get_container(client)
            if container is None or container.labels.get("io.open-ocr-control.managed") != "true":
                return
            container.reload()
            if container.status == "running":
                container.stop(timeout=20)
            container.remove()
        except DockerException as exc:
            raise ContainerManagementError(
                f"Verwalteter OCR-Container konnte nicht bereinigt werden: {exc}"
            ) from exc
        finally:
            client.close()

    def _container_logs_sync(self) -> str:
        client = self._docker_client()
        try:
            container = self._get_container(client)
            if container is None:
                return "Container nicht gefunden"
            raw_logs = cast(bytes, container.logs(tail=20))
            return raw_logs.decode("utf-8", errors="replace")[-2000:]
        except DockerException:
            return "Logs nicht verfügbar"
        finally:
            client.close()
