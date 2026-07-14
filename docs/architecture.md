# Architektur

## Kontext

Open OCR Control ist ein lokales Control Plane vor einem separaten, GPU-beschleunigten
Unlimited-OCR/vLLM-Container. Das App-Image enthält HTTP-API, Job-Orchestrierung,
Dokumentkonvertierung und die gebaute React-Oberfläche. Modellgewichte bleiben im benannten
Hugging-Face-Volume.

```mermaid
flowchart LR
    B["Browser :3011"] -->|"Upload / SSE / Export"| A["FastAPI + React\nApp-Container :3011"]
    A -->|"Docker Engine API\noptional"| D["Docker-Socket"]
    D -->|"Start / Stop"| O["Unlimited-OCR\nvLLM :3111"]
    A -->|"OpenAI Chat Completions\nSSE"| O
    A --> T["Temporäre Jobs\nVolume"]
    O --> H["Hugging Face Cache\nVolume"]
```

## Komponenten

| Komponente | Verantwortung |
|---|---|
| `app/api.py` | stabile HTTP-, SSE- und Exportgrenze |
| `JobManager` | Lebenszyklus, Fortschritt, Reihenfolge, Abbruch und Event-Historie |
| `DocumentProcessor` | Validierung, Office→PDF, PDF/Bild→JPEG-Seiten |
| `OcrClient` | vorgeschriebener vLLM-Payload, SSE-Parsing, Grounding-Filter |
| `DockerManager` | genau einen fest konfigurierten Modellcontainer starten/stoppen |
| React-App | Upload, Status, Live-Vorschau, Kopieren und Export |

## Auftragszustände

```mermaid
stateDiagram-v2
    [*] --> queued
    queued --> preparing
    preparing --> waiting_for_ocr
    waiting_for_ocr --> processing
    processing --> completed
    queued --> cancelled
    preparing --> cancelled
    waiting_for_ocr --> cancelled
    processing --> cancelled
    preparing --> failed
    waiting_for_ocr --> failed
    processing --> failed
    completed --> [*]
    failed --> [*]
    cancelled --> [*]
```

Jede Seite besitzt zusätzlich `pending`, `processing`, `completed`, `failed` oder `cancelled`.
Seitenfehler werden isoliert; der Auftrag ist erfolgreich, sobald mindestens eine Seite erkannt
wurde. Exporte behalten die Seitenreihenfolge unabhängig von paralleler Fertigstellung bei.

## Live-Protokoll

`GET /api/jobs/{id}/events` verwendet benannte SSE-Events mit monotoner ID. EventSource sendet bei
Reconnect `Last-Event-ID`; der Server liefert die begrenzte In-Memory-Historie nach. Delta-Events
werden in Blöcken gesammelt, um Browser- und Speicherlast zu reduzieren. Alle 15 Sekunden hält ein
Kommentar die Verbindung offen.

## Performance

- PDF-Rendering und Office-Konvertierung blockieren nicht den Event Loop.
- JPEG bei 200 DPI reduziert Uploadgröße zur lokalen vLLM-API gegenüber 300-DPI-PNG deutlich.
- Standardparallelität 2 nutzt GPU-Batching, ohne kleine GPUs direkt zu überlasten.
- Jede Seite erhält 8192 Tokens; Nutzer können Qualität, Parallelität und Budget anpassen.
- Prefix- und MM-Processor-Caches sind gemäß Upstream-Rezept deaktiviert.

## Persistenz

Auftragsmetadaten und Event-Historie liegen absichtlich im Arbeitsspeicher. Quelldatei und gerenderte
Seiten liegen im Volume und werden nach Ablauf der Retention beim App-Start entfernt. Diese
Ausführung ist auf einen App-Prozess beschränkt. Eine spätere horizontale Skalierung benötigt einen
externen Queue-/State-Store und Object Storage.

