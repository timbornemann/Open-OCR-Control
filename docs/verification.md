# Verifikationsnachweis

Stand: 2026-07-19

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
ruff format --check app tests       21 Dateien formatiert
ruff check app tests                keine Befunde
mypy app                            keine Befunde (strict)
pytest                              12 Tests erfolgreich
npm run check                       TypeScript erfolgreich
npm test                            21 Tests erfolgreich
npm run build                       Vite-Produktionsbuild erfolgreich
pip-audit --local --skip-editable   keine bekannte Schwachstelle
npm audit --audit-level=high        keine bekannte Schwachstelle
docker compose config --quiet       erfolgreich
docker build                        erfolgreich
```

Die Tests decken Grounding-Token-Streaming über Chunkgrenzen, sichere Bildbox-Auswertung und
-Zuschnitte, PDF-/Bildrendering, vLLM-Payload/SSE, parallele Seiten, sequenzielle Dokument-Batches,
Roh-/Rich-Markdown und portable ZIP-Exporte ab.
Frontend-Tests prüfen zusätzlich die Wiederherstellung eines laufenden Jobs ab der letzten Event-ID
sowie eines fertigen Batches mit ausgewähltem Dokument-Tab. Ein Regressionstest deckt explizite
OCR-LaTeX-Blöcke mit Markdown-Sonderzeichen, tief verschachtelten Brüchen und getrennt gesetzten
Indizes ab. Ein weiterer Test stellt sicher, dass einzelne OCR-Zeilenumbrüche in
Inhaltsverzeichnissen und Literaturangaben als sichtbare Umbrüche erhalten bleiben.
Der Batch-Race-Test prüft außerdem den Wechsel auf das nächste aktive Dokument und stellt sicher,
dass verspätete Seitenereignisse eines bereits abgeschlossenen Dokuments die aktuelle
Dokumentauswahl und Seitenanzeige nicht zurücksetzen.

## Container-Smoke-Test

Das Produktionsimage wurde read-only, mit `tmpfs`, persistentem Jobvolume und als UID/GID 10001
gestartet. Ein lokaler vLLM-kompatibler Mock bestätigte über die echten HTTP-Wege:

- App-Liveness und CSP-Sicherheitsheader
- Office→PDF→JPEG-Konvertierung
- Multipart-Upload, Auftragspolling und SSE-Replay
- Live-Grounding-Bereinigung und Markdown-Tabelle
- lokale Bild-Assets aus normierten `image`-Grounding-Boxen
- Roh-Markdown, vollständiges Einzel-ZIP und verzeichnisstrukturiertes Batch-ZIP
- zwei sequenziell verarbeitete Dokumente mit wechselbaren Ergebnistabs
- keine Browserwarnungen/-fehler
- Desktop- und 375-Pixel-Mobile-Layout ohne Seiten- oder horizontalen Überlauf; nur der
  Ergebnisbereich scrollt

Zusätzlich wurde die Sitzungswiederherstellung im echten Browser geprüft: Ein laufender Auftrag
blieb nach einem vollständigen Seiten-Neuladen sichtbar, wurde über SSE ohne Textduplikate
fortgesetzt und anschließend erfolgreich abgeschlossen. Ein zweiter Reload stellte auch das
fertige Ergebnis samt Vorschau, eingebettetem Bild und Exportlinks wieder her.

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

Nach der Korrektur der Batch-Seitenanzeige wurde zusätzlich ein realer Zwei-Bilder-Batch im
Browser verarbeitet. Beim Übergang auf die zweite Datei wechselten Dokument-Tab, Überschrift und
Seitenanzeige gemeinsam auf den neuen aktiven Job und blieben dort bis zum erfolgreichen
Batch-Abschluss; die bereits fertige erste Datei setzte den Index nicht zurück.

Am 19. Juli 2026 wurde zusätzlich ein Batch aus zwei synthetischen Einseiten-PDFs über die reale
GPU-Pipeline verarbeitet. Beide Jobs liefen in Uploadreihenfolge und endeten erfolgreich; die
gemessenen OCR-Seitenzeiten betrugen 3,39 s und 1,43 s. Das Gesamt-ZIP enthielt pro Dokument
`document.md`, `document.txt`, `result.json` sowie ein Wurzelmanifest. Das Modell klassifizierte die
einfachen Vektorbalken in diesem Test nicht als `image`; der separate vLLM-kompatible Grounding-Test
bestätigte deshalb den vollständigen Bildpfad mit geladenem Vorschau-JPEG (851 × 991 Pixel),
portablem `assets/`-Link und je einem Bild pro Dokumentverzeichnis.

Anschließend wurden Stop und Start über `/api/ocr/stop` und `/api/ocr/start` geprüft. Auch das
vollständige Neuerstellen des Modellcontainers durch die App funktionierte mit GPU-Zugriff, Port
3111, `HF_XET_HIGH_PERFORMANCE=1` und dem gemeinsamen Volume `unlimited-ocr-cache`. Zum Abschluss
wurde das Modell gestoppt, um VRAM freizugeben; die App blieb gesund auf Port 3011 erreichbar.
