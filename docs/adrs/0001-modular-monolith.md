# ADR 0001: Modularer Monolith für App und Weboberfläche

- Status: Angenommen
- Datum: 2026-07-14

## Kontext

Die Anwendung benötigt Upload, Konvertierung, Jobsteuerung, Live-Streaming und eine UI, wird aber
lokal auf einem Rechner betrieben. Zusätzliche Infrastruktur würde Installation und Betrieb
erschweren.

## Entscheidung

FastAPI, Job-Orchestrierung und die gebaute React-App werden als ein App-Image und ein Prozess
ausgeliefert. Unlimited-OCR bleibt wegen GPU-Runtime, Modellgröße und Upstream-Releasezyklus ein
separater Container. Backendmodule haben klare Verantwortungsgrenzen und können später extrahiert
werden.

## Folgen

- Ein Kommando stellt die UI bereit; keine CORS-/Authentifizierungsgrenze zwischen UI und API.
- Auftragszustand kann zunächst im Prozess liegen.
- App-Replikation ist nicht vorgesehen. Horizontale Skalierung benötigt Queue und externen Store.
- Das große GPU-Image wird nicht in das wesentlich kleinere App-Image eingebettet.

