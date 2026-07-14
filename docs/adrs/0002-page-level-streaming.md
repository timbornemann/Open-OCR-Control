# ADR 0002: Seitenweise OCR mit begrenzter Parallelität

- Status: Angenommen
- Datum: 2026-07-14

## Kontext

Unlimited-OCR unterstützt Multi-Page-Parsing in einem Request, besitzt aber maximal 32.768
Kontexttokens. Nutzer erwarten sichtbaren Fortschritt, schnelle Ergebnisse und robuste Verarbeitung
langer PDFs.

## Entscheidung

PDFs und mehrseitige Bilder werden in einzelne JPEG-Seiten zerlegt. Jede Seite erhält einen
Streaming-Request im vom Benutzer begrenzten Worker-Pool. Ergebnisse werden nach ursprünglicher
Seitennummer zusammengesetzt. Standard sind 200 DPI, zwei parallele Seiten und 8192 Tokens je Seite.

## Folgen

- Erste Ergebnisse erscheinen früh und einzelne Seitenfehler bleiben isoliert.
- Lange Dokumente konkurrieren nicht um ein gemeinsames Kontextfenster.
- Parallele Requests können GPU-Batching nutzen.
- Semantik über Seitengrenzen (z. B. fortgesetzte Tabellen) kann schlechter sein als beim
  Multi-Page-Modus. Eine spätere optionale Long-Document-Strategie bleibt möglich.

