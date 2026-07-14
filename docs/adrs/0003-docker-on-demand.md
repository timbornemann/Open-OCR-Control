# ADR 0003: Optionale Docker-Socket-Steuerung

- Status: Angenommen
- Datum: 2026-07-14

## Kontext

Das GPU-Modell soll nur bei Bedarf laufen und direkt aus der Webanwendung startbar sein. Ein
Container kann keinen Geschwistercontainer ohne Docker-/Orchestratorzugriff steuern.

## Entscheidung

Im lokalen Standardbetrieb erhält die App den Docker-Socket und darf genau den benannten Container
`unlimited-ocr` mit festem Image, Kommando, Port, Volume, GPU-Zugriff und Netzwerk anlegen, starten
und stoppen. Beliebige Image-, Kommando- oder Containerparameter sind nicht über die HTTP-API
steuerbar. Für gehärtete Umgebungen ist `OCR_MANAGE_CONTAINER=false` ein vollständig unterstützter
Modus.

## Folgen

- Die gewünschte On-Demand-Bedienung funktioniert ohne Host-Hilfsdienst.
- Socketzugriff entspricht einer hoch privilegierten Host-Grenze und ist deutlich dokumentiert.
- Öffentliche Exposition ohne vorgeschaltete Authentifizierung ist unzulässig.
- Kubernetes/Podman benötigen später einen anderen `ContainerManager`.

