# Open OCR Control

[English](../README.md) | **Deutsch**

Lokale, GPU-beschleunigte Dokumentenerkennung mit
[Baidu Unlimited-OCR](https://huggingface.co/baidu/Unlimited-OCR). Die Anwendung nimmt PDFs,
Bilder und gängige Office-Dateien entgegen, zeigt die Erkennung live im Browser und exportiert
das Ergebnis als Markdown, Klartext oder JSON.

![Open OCR Control beim Parsen einer PDF mit Live-Seitenfortschritt](images/parsing.gif)

Die Webanwendung wird standardmäßig auf allen Host-Interfaces über **Port 3011** bereitgestellt und
kann dadurch von anderen Geräten im vertrauenswürdigen lokalen Netzwerk genutzt werden. Der
vLLM-/Unlimited-OCR-Dienst bleibt lokal und intern auf **Port 3111**. Beide Komponenten sind
containerisiert; Dokumente und Modellausgaben verbleiben auf dem Host.

## Funktionen

- englische Standardoberfläche mit dauerhaft gespeicherter Umschaltung auf Deutsch
- Drag-and-drop für PDF, PNG, JPEG, WebP, BMP, TIFF, DOC(X), ODT, RTF, PPT(X), XLS(X) und ODS
- Live-Streaming pro Seite über Server-Sent Events
- parallele, geordnete Seitenverarbeitung mit einstellbarer Geschwindigkeit und Qualität
- bereinigte Rich-Preview für Markdown, HTML-/GFM-Tabellen und LaTeX-Formeln
- viewportfüllender Arbeitsbereich mit automatisch mitlaufender aktueller Seitenanzeige
- Kopieren sowie Export als `.md`, `.txt` und strukturiertes `.json`
- bedarfsgesteuertes Starten und Stoppen des festen Unlimited-OCR-Containers
- responsive, barrierearme Oberfläche in Schwarz-/Weiß-/Graustufen
- Upload-, Seiten-, Zeit-, Render- und Parallelitätsgrenzen gegen Fehlkonfiguration
- OCI-Image aus GitHub Releases inklusive SBOM und Build-Provenienz

## Oberfläche

### Upload-Arbeitsbereich

![Upload-Arbeitsbereich von Open OCR Control](images/startpage.png)

### Live-Erkennung Seite für Seite

<p>
  <img src="images/running-ocr.png" alt="Start eines OCR-Auftrags mit Live-Ausgabe der aktuellen Seite" width="49%">
  <img src="images/running-ocr-2.png" alt="OCR-Auftrag mit mehreren fertig verarbeiteten Seiten" width="49%">
</p>

## Voraussetzungen

- Docker Desktop oder Docker Engine mit Compose
- NVIDIA-GPU mit mindestens 8 GB VRAM
- aktueller NVIDIA-Treiber und funktionierendes NVIDIA Container Toolkit
- ungefähr 20 GB freier Speicher für Runtime-Image, Modell und Cache

Das Standardimage `vllm/vllm-openai:unlimited-ocr` nutzt CUDA 13.0. Für Hopper-GPUs mit CUDA 12.9
nennt Baidu alternativ `vllm/vllm-openai:unlimited-ocr-cu129`; setze dafür `OCR_DOCKER_IMAGE` beim
App-Container oder ändere das Image im Compose-Profil.

## Schnellstart

```bash
docker pull vllm/vllm-openai:unlimited-ocr
docker compose up -d --build app
```

Auf dem Docker-Host ist die Oberfläche unter [http://localhost:3011](http://localhost:3011), auf
anderen Rechnern im selben vertrauenswürdigen Netzwerk unter `http://<HOST-LAN-IP>:3011`
erreichbar. Beim
ersten OCR-Auftrag legt die App den Container `unlimited-ocr` an, stellt ihn über Port 3111 bereit
und wartet, bis vLLM bereit ist. Der erste Start kann wegen des Modelldownloads mehrere Minuten
dauern. Der Xet-High-Performance-Modus ist standardmäßig aktiv. Optional erhöht ein persönlicher
Hugging-Face-Token die Hub-Rate-Limits:

```bash
HF_TOKEN=hf_... docker compose up -d
```

Soll das Modell bereits beim Compose-Start geladen werden:

```bash
docker compose --profile eager up -d --build
```

Status und Logs:

```bash
docker compose ps
docker compose logs -f app
docker logs -f unlimited-ocr
```

Stoppen (Cache und Auftragsdateien bleiben erhalten; appverwaltete Modellcontainer werden sauber
entfernt):

```bash
docker compose down
```

### Veröffentlichtes App-Image

Bei jedem veröffentlichten GitHub Release baut der Workflow ein Image für `linux/amd64`:

```bash
docker pull ghcr.io/timbornemann/open-ocr-control:latest
```

Setze in `docker-compose.yml` für `app.image` dieses Image und entferne bei Bedarf den `build`-Block.
Das GPU-Modell bleibt absichtlich ein separates Upstream-Image.

## Verarbeitung

1. Die App speichert den Upload in einem isolierten Auftragsverzeichnis.
2. Office-Dateien werden headless mit LibreOffice in PDF konvertiert.
3. PDFs werden standardmäßig mit 200 DPI seitenweise als hochwertige JPEGs gerendert.
4. Zwei Seiten werden standardmäßig parallel an `/v1/chat/completions` gesendet.
5. Die Modellantwort wird live gestreamt. Grounding-Koordinaten werden entfernt, strukturierte
   Ausgabe bleibt erhalten.
6. Die Vorschau bereinigt eingebettetes HTML, rendert Tabellen und setzt unterstützte Formeln mit
   KaTeX.
7. Ergebnisse stehen bis zum Neustart in der UI; Arbeitsverzeichnisse werden nach 24 Stunden beim
   nächsten App-Start gelöscht.

Die seitenweise Strategie ist bei langen PDFs robuster als ein einziger Multi-Page-Request: jede
Seite erhält ihr eigenes Tokenbudget, Fortschritt wird sofort sichtbar und ein Fehler betrifft nur
eine Seite. Mehr Parallelität erhöht den Durchsatz, benötigt aber entsprechend mehr VRAM.

## Rich-Preview und Sicherheit

Unlimited-OCR kann GFM-Markdown, rohe HTML-Tabellen und verschiedene Mathematikdelimiter liefern.
Die Vorschau unterstützt `$…$`, `$$…$$`, `\(…\)`, `\[…\]` und OCR-typische mathematische Klammern,
wenn deren Inhalt eindeutig mathematische Syntax enthält. Roh-HTML wird in einen Syntaxbaum
übernommen und bereinigt, bevor React oder KaTeX es verarbeitet; Skripte, Event-Handler und vom
Modell gelieferte Styles werden entfernt.

Die Entscheidung ist in
[ADR 0005: Sichere Rich-Preview](adrs/0005-secure-rich-preview.md) dokumentiert.

## Konfiguration

Alle App-Variablen beginnen mit `OCR_`. Die wichtigsten Werte:

| Variable | Standard | Bedeutung |
|---|---:|---|
| `APP_BIND` | `0.0.0.0` | von Docker Compose für Port 3011 verwendetes Host-Interface |
| `OCR_BASE_URL` | `http://localhost:3111/v1` | OpenAI-kompatible vLLM-API |
| `OCR_MANAGE_CONTAINER` | `true` | Start/Stop über Docker Engine erlauben |
| `OCR_DOCKER_IMAGE` | `vllm/vllm-openai:unlimited-ocr` | Modell-Containerimage |
| `OCR_GPU_MEMORY_UTILIZATION` | `0.85` | vLLM-Anteil am GPU-Speicher |
| `OCR_HF_TOKEN` | leer | optionaler Hugging-Face-Token für höhere Rate-Limits |
| `OCR_HF_XET_HIGH_PERFORMANCE` | `true` | parallelen Modelldownload maximieren |
| `OCR_MAX_UPLOAD_MB` | `100` | maximales Uploadvolumen |
| `OCR_MAX_PAGES` | `200` | maximale Seitenzahl je Auftrag |
| `OCR_MAX_RENDER_MEGAPIXELS` | `50` | Dekompressions-/Renderlimit je Seite |
| `OCR_DEFAULT_DPI` | `200` | Standard-Renderqualität (150–300) |
| `OCR_DEFAULT_PAGE_CONCURRENCY` | `2` | parallele OCR-Seiten |
| `OCR_DEFAULT_MAX_TOKENS` | `8192` | Tokenbudget je Seite |
| `OCR_JOB_RETENTION_HOURS` | `24` | Aufbewahrung temporärer Arbeitsdateien |

Eine vollständige Vorlage steht in [../.env.example](../.env.example). Compose setzt intern
`OCR_BASE_URL=http://unlimited-ocr:8000/v1` und das feste Netzwerk `open-ocr-control`.

### Zugriff im lokalen Netzwerk

Für Clientrechner muss nur TCP-Port 3011 erreichbar sein. Port 3111 sollte weder freigegeben noch
über den Router weitergeleitet werden; die App erreicht Unlimited-OCR über das interne
Docker-Netzwerk. Blockiert die Host-Firewall den Zugriff, erlaube eingehendes TCP 3011 nur für das
private/LAN-Profil und stufe nur ein tatsächlich vertrauenswürdiges Netzwerk als privat ein. Da die
Anwendung keine Benutzeranmeldung besitzt, darf kein Router-Portforwarding
auf die Anwendung eingerichtet werden.

Für erneuten Zugriff ausschließlich vom Host setze `APP_BIND=127.0.0.1` in `.env` und erstelle den
App-Container neu.

### Betrieb ohne Docker-Socket

Der Docker-Socket verleiht dem App-Container weitreichende Rechte auf dem Host. Wer das Modell
selbst startet, sollte den Socket-Mount entfernen, `OCR_MANAGE_CONTAINER=false` setzen und als URL
beispielsweise `http://host.docker.internal:3111/v1` verwenden. Die UI kann das Modell dann nur
prüfen, nicht starten oder stoppen. Details stehen im
[Betriebshandbuch](operations.md#docker-socket-und-berechtigungen).

Unter Linux kann für den Socket die Docker-Gruppen-ID nötig sein:

```bash
DOCKER_GID=$(stat -c '%g' /var/run/docker.sock) docker compose up -d --build
```

## Entwicklung

Backend: Python 3.11–3.13, FastAPI, PyMuPDF, Pillow und Docker SDK. Frontend: React, TypeScript,
Vite sowie eine bereinigte unified-/KaTeX-Rendering-Pipeline.

```bash
python -m venv .venv
# Linux/macOS: source .venv/bin/activate
# Windows: .venv\Scripts\activate
python -m pip install -e ".[dev]"

cd frontend
npm ci
npm run build
cd ..

pytest
ruff check app tests
mypy app
python -m app
```

Für Frontend-Hot-Reload läuft `npm run dev` auf Port 5173 und leitet `/api` an Port 3011 weiter.
Die Qualitätsregeln stehen in [../CONTRIBUTING.md](../CONTRIBUTING.md), Architektur und Entscheidungen
in [architecture.md](architecture.md) sowie [adrs](adrs). Der konkrete Hardware-/End-to-End-Nachweis
steht in [verification.md](verification.md).

## API

OpenAPI/Swagger: [http://localhost:3011/api/docs](http://localhost:3011/api/docs)

| Methode | Pfad | Zweck |
|---|---|---|
| `GET` | `/api/health` | App-Liveness |
| `GET` | `/api/ocr/status` | Modell-/Containerstatus |
| `POST` | `/api/ocr/start` | Modell-Container starten |
| `POST` | `/api/ocr/stop` | Modell-Container stoppen |
| `POST` | `/api/jobs` | Dokument als Multipart-Upload annehmen |
| `GET` | `/api/jobs/{id}` | Auftragszustand und Ergebnisse |
| `GET` | `/api/jobs/{id}/events` | Live-SSE-Stream |
| `DELETE` | `/api/jobs/{id}` | Auftrag abbrechen |
| `GET` | `/api/jobs/{id}/export?format=markdown` | Ergebnis exportieren |

## Grenzen

- OCR-Ergebnisse können Erkennungsfehler enthalten und müssen bei kritischen Daten geprüft werden.
- Aufträge sind bewusst prozesslokal. Mehrere App-Replikate oder Neustart-Fortsetzung benötigen
  einen externen Job Store.
- Sehr komplexe Seiten können mehr als 8192 Ausgabetokens benötigen; das Limit ist in der UI
  anpassbar.
- Passwortgeschützte PDFs werden abgelehnt.
- Die App ist für vertrauenswürdige lokale Netze gedacht und bringt keine Benutzeranmeldung mit.

## Upstream-Vorgaben

Die Integration folgt dem offiziellen
[vLLM-Rezept für Unlimited-OCR](https://recipes.vllm.ai/baidu/Unlimited-OCR): Prompt mit literalem
`<image>`, `skip_special_tokens=false`, N-Gram-Prozessor mit Größe 35/Fenster 128 und deaktivierte
Prefix-/MM-Processor-Caches. Das
[Baidu Model Card](https://huggingface.co/baidu/Unlimited-OCR) bestätigt Markdown-Ausgabe, 32.768
Kontexttokens sowie die offiziellen Dockerimages.

## Lizenz

GPL-3.0-or-later, siehe [../LICENSE](../LICENSE) und [../NOTICE](../NOTICE). Baidu Unlimited-OCR und
vLLM sind separate Upstream-Projekte mit eigenen Lizenzen; ihre Images und Modellgewichte werden
nicht in diesem Repository weiterverteilt.
