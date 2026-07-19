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

Der Browser speichert ausschließlich die aktive Job- oder Batch-ID und gegebenenfalls den
ausgewählten Dokument-Tab. Nach einem Seiten-Neuladen wird der aktuelle API-Snapshot geladen und
der SSE-Stream ab dessen letzter Event-ID fortgesetzt. Die eigentlichen Dokumentdaten und
Ergebnisse werden nicht in `localStorage` dupliziert.

## Folgen

- Keine Datenbank, schnelle Zustandsupdates und kleiner Betriebsumfang.
- Browser-Neuladen erhält laufende Verarbeitung, fertige Ergebnisse und Tab-Auswahl, solange der
  App-Prozess weiterläuft.
- Ein App-Neustart beendet die UI-Verfügbarkeit alter Ergebnisse, auch wenn Dateien bis zur
  Bereinigung noch existieren.
- Mehrprozess-/Mehrreplikabetrieb ist ausgeschlossen und wird dokumentiert.
- Persistente Historie kann später als opt-in Repository implementiert werden.
