# Sicherheitsrichtlinie

## Unterstützte Versionen

Sicherheitsupdates werden für das aktuelle Release und den `master`-Branch bereitgestellt.

## Meldung einer Schwachstelle

Bitte keine ausnutzbaren Details in einem öffentlichen Issue veröffentlichen. Verwende GitHubs
private Security-Advisory-Funktion des Repositorys. Beschreibe betroffene Version, Reproduktion,
Auswirkung und einen möglichen Fix. Eine erste Rückmeldung sollte innerhalb von sieben Tagen
erfolgen.

## Vertrauensgrenzen

- Die App ist für lokalen Einzelbenutzerbetrieb bzw. vertrauenswürdige LANs ohne öffentliche
  Exposition konzipiert. Compose bindet Port 3011 standardmäßig an alle Host-Interfaces; eine
  Host-Firewall muss den Zugriff deshalb auf das vertrauenswürdige LAN begrenzen. Router-
  Portforwarding ist ohne vorgeschaltete Authentifizierung ausdrücklich nicht vorgesehen.
- Der optionale Docker-Socket erlaubt Containerverwaltung und entspricht faktisch Host-Root-Rechten.
  Für stärker isolierte Umgebungen muss er entfernt und externe Modellverwaltung aktiviert werden.
- Uploads werden begrenzt, in zufälligen Serverpfaden gespeichert und nie an Cloud-Dienste gesendet.
- LibreOffice verarbeitet nicht vertrauenswürdige Dokumente im gehärteten App-Container ohne
  Linux-Capabilities. Vollständige Isolation erfordert trotzdem eine separate Sandbox/VM.
- OCR-Markdown und eingebettetes HTML werden vor der Darstellung gegen eine strikte Allowlist
  bereinigt; Skripte, Event-Handler und vom Modell gelieferte Styles werden entfernt. Die CSP
  erlaubt Inline-Styles nur, weil KaTeX nach dieser Bereinigung lokal erzeugte Layoutwerte nutzt,
  und blockiert weiterhin fremde Skripte und Ressourcen.

Abhängigkeiten werden gepinnt, durch Dependabot aktualisiert und in CI geprüft. Release-Images
enthalten SBOM und Build-Provenienz.
