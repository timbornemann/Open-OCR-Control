# syntax=docker/dockerfile:1.7

FROM node:22-bookworm-slim AS web-builder
WORKDIR /build/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci
COPY frontend/ ./
RUN npm run build

FROM python:3.12-slim-bookworm AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    HOME=/tmp \
    OCR_DATA_DIR=/data/jobs \
    OCR_STATIC_DIR=/opt/open-ocr-control/app/static

RUN apt-get update \
    && apt-get install --no-install-recommends -y \
        curl \
        fonts-dejavu-core \
        fonts-liberation \
        libreoffice-calc \
        libreoffice-impress \
        libreoffice-writer \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --gid 10001 app \
    && useradd --uid 10001 --gid 10001 --no-create-home --shell /usr/sbin/nologin app \
    && mkdir -p /data/jobs \
    && chown app:app /data/jobs

WORKDIR /opt/open-ocr-control
COPY pyproject.toml README.md LICENSE NOTICE ./
RUN --mount=type=cache,target=/root/.cache/pip mkdir app \
    && touch app/__init__.py \
    && python -m pip install --upgrade pip==26.1.2 \
    && pip install . \
    && rm -rf app
COPY --chown=10001:10001 app ./app
COPY --chown=10001:10001 --from=web-builder /build/app/static ./app/static

USER 10001:10001
EXPOSE 3011
VOLUME ["/data/jobs"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD curl --fail --silent http://127.0.0.1:3011/api/health >/dev/null || exit 1

CMD ["python", "-m", "app"]
