# ADR 0007: Sequenzielle Dokumentverarbeitung in Batches

- Status: Angenommen
- Datum: 2026-07-19

## Kontext

Mehrfachuploads sollen gemeinsam gestartet, beobachtet und exportiert werden. Eine vollständig
parallele Verarbeitung mehrerer Dokumente würde zusätzlich zur bestehenden Seitenparallelität
unkontrolliert Render-RAM, VRAM und Modellqueue belasten.

## Entscheidung

Ein Batch erzeugt für jede Upload-Datei einen normalen Job, verarbeitet diese Jobs serverseitig
aber strikt in Uploadreihenfolge. Innerhalb des jeweils aktiven Dokuments gilt weiterhin die vom
Nutzer gewählte Seitenparallelität. Ein eigener SSE-Stream liefert Batchstatus und verschachtelte
Jobevents; die UI stellt Dokumente als Tabs dar.

Ein Gesamtexport erzeugt ein ZIP mit einem eindeutig benannten Verzeichnis pro Dokument. Jedes
Verzeichnis enthält portables Markdown, Klartext, JSON und erkannte Bild-Assets. Ein Manifest an
der ZIP-Wurzel beschreibt alle enthaltenen Ergebnisse und Fehler.

## Folgen

- Ressourcenbedarf und Laufzeit sind vorhersehbarer als bei parallelen Dokumenten.
- Fertige Dokumente können angesehen werden, während spätere noch warten oder laufen.
- Abbruch stoppt den aktiven Job und markiert noch nicht gestartete Jobs als abgebrochen.
- Batchzustand bleibt wie Einzeljobzustand prozesslokal; Neustart-Fortsetzung benötigt künftig eine
  externe Queue und persistente Metadaten.
