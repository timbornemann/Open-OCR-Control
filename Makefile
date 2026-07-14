.PHONY: install test lint build run

install:
	python -m pip install -e ".[dev]"
	cd frontend && npm ci

test:
	pytest
	cd frontend && npm test

lint:
	ruff check app tests
	mypy app
	cd frontend && npm run check

build:
	docker build -t open-ocr-control:local .

run:
	docker compose up -d --build

