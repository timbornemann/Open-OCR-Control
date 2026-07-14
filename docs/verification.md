# Verifikationsnachweis

Stand: 2026-07-14

## Testumgebung

| Komponente | Wert |
|---|---|
| GPU | NVIDIA GeForce RTX 5070 Ti, 16.303 MiB VRAM |
| NVIDIA-Treiber | 591.86 |
| Docker | 29.2.1 |
| Docker Compose | 5.0.2 |
| Modellimage | `vllm/vllm-openai:unlimited-ocr` |
| Modell | `baidu/Unlimited-OCR`, BF16, Kontext 32.768 |
| App-Runtime | Python 3.12, Nicht-root UID/GID 10001 |

## Automatisierte Gates

Folgende Prüfungen liefen nach dem finalen Dependency-Update erfolgreich:

```text
ruff format --check app tests       19 Dateien formatiert
ruff check app tests                keine Befunde
mypy app                            keine Befunde (strict)
pytest                              8 Tests erfolgreich
npm run check                       TypeScript erfolgreich
npm test                            2 Tests erfolgreich
npm run build                       Vite-Produktionsbuild erfolgreich
pip-audit --local --skip-editable   keine bekannte Schwachstelle
npm audit --audit-level=high        keine bekannte Schwachstelle
docker compose config --quiet       erfolgreich
docker build                        erfolgreich
```

Die Tests decken Grounding-Token-Streaming über Chunkgrenzen, Klartextbereinigung, PDF- und
Bildrendering, vLLM-Payload/SSE, parallelen Joblebenszyklus sowie Markdown/Text/JSON-Export ab.

## Container-Smoke-Test

Das Produktionsimage wurde read-only, mit `tmpfs`, persistentem Jobvolume und als UID/GID 10001
gestartet. Ein lokaler vLLM-kompatibler Mock bestätigte über die echten HTTP-Wege:

- App-Liveness und CSP-Sicherheitsheader
- Office→PDF→JPEG-Konvertierung
- Multipart-Upload, Auftragspolling und SSE-Replay
- Live-Grounding-Bereinigung und Markdown-Tabelle
- Markdown- und JSON-Export
- keine Browserwarnungen/-fehler
- Desktop- und 375-Pixel-Mobile-Layout ohne horizontalen Überlauf

## Reales Unlimited-OCR-End-to-End

Der echte GPU-Container wurde mit den Repository-Argumenten gestartet. vLLM meldete die erwarteten
Werte: `UnlimitedOCRForCausalLM`, BF16, FlexAttention/R-SWA, 32.768 Kontexttokens, deaktiviertes
Prefix-Caching und registrierter `NGramPerReqLogitsProcessor`. Der Checkpoint belegt 6,21 GiB; das
vollständige gemeinsame Cachevolume belegt rund 7,96 GB.

Eine RTF-Testdatei wurde über die laufende Web-API hochgeladen. Ergebnis:

```text
Status: completed
Seiten: 1/1
OCR-Zeit nach Warmup: 2,09 s
Erkannt: "Open OCR Control / Dieser lokale Test prueft die Office-Konvertierung."
Grounding-Tokens im Export: keine
vLLM HTTP-Status: 200
```

Der Wert ist ein Funktionsnachweis für eine sehr einfache Seite, kein allgemeiner Benchmark.
Komplexität, Auflösung, Tokenzahl, Parallelität und GPU beeinflussen die Laufzeit erheblich.

Anschließend wurden Stop und Start über `/api/ocr/stop` und `/api/ocr/start` geprüft. Auch das
vollständige Neuerstellen des Modellcontainers durch die App funktionierte mit GPU-Zugriff, Port
3111, `HF_XET_HIGH_PERFORMANCE=1` und dem gemeinsamen Volume `unlimited-ocr-cache`. Zum Abschluss
wurde das Modell gestoppt, um VRAM freizugeben; die App blieb gesund auf Port 3011 erreichbar.

