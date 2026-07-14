# ADR 0004: Flüchtiger Auftragszustand mit zeitlich begrenzten Arbeitsdateien

- Status: Angenommen
- Datum: 2026-07-14

## Kontext

Die Anwendung ist ein lokales Interaktionswerkzeug, kein Dokumentenarchiv. Eine Datenbank erhöht
Migrationen, Datenschutzfläche und Betriebsaufwand.

## Entscheidung

Jobstatus, Ergebnisse und SSE-Historie liegen im Arbeitsspeicher eines Prozesses. Uploads und
gerenderte Seiten liegen in zufälligen Verzeichnissen eines Docker-Volumes. Abgelaufene
Verzeichnisse werden beim Start gelöscht; Standardretention ist 24 Stunden. Nutzer exportieren
dauerhafte Ergebnisse explizit.

## Folgen

- Keine Datenbank, schnelle Zustandsupdates und kleiner Betriebsumfang.
- Ein App-Neustart beendet die UI-Verfügbarkeit alter Ergebnisse, auch wenn Dateien bis zur
  Bereinigung noch existieren.
- Mehrprozess-/Mehrreplikabetrieb ist ausgeschlossen und wird dokumentiert.
- Persistente Historie kann später als opt-in Repository implementiert werden.
