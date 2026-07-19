# ADR 0006: Bildbereiche aus Modell-Grounding als lokale Assets

- Status: Angenommen
- Datum: 2026-07-19

## Kontext

Unlimited-OCR kann erkannte Abbildungen mit `<|ref|>image<|/ref|>` und einer nachfolgenden
`<|det|>`-Box markieren. Die Koordinaten liegen im offiziellen Format normiert im Bereich 0 bis
999. Baidus Visualisierung schneidet diese Bereiche aus dem Eingabebild aus und ersetzt die
Markierungen in der Ergebnisdatei durch Markdown-Bildlinks. Ohne diese Auswertung gingen Bilder in
der bisherigen reinen Textbereinigung verloren.

## Entscheidung

Der Server bewahrt die rohe Modellantwort separat auf und wertet ausschließlich syntaktisch
gültige `image`-Markierungen aus. Boxen werden mit `ast.literal_eval` statt ausführbarem Code
geparst, auf 0 bis 999 begrenzt und auf die Pixelmaße der bereits gerenderten Seite abgebildet.
Gültige Bereiche werden als JPEG in das auftragsspezifische `assets`-Verzeichnis geschrieben.

Rich-Markdown verweist auf die gleiche Herkunft unter `/api/jobs/{id}/assets/{name}`. Der Endpoint
liefert nur Dateinamen aus, die in den Seitenergebnissen registriert sind. Die Vorschau-Sanitization
erlaubt diese lokalen Links, blockiert aber externe Bildquellen. Ein Roh-Markdown-Export bleibt
modellnah; der vollständige ZIP-Export schreibt portable `assets/`-Links und packt alle Bilder mit
ein.

## Folgen

- Vom Modell markierte PDF-Abbildungen erscheinen in der Vorschau und in vollständigen ZIPs.
- Bilddaten verlassen weder Server noch lokales Netzwerk und werden nicht als Data-URLs in Events
  vervielfacht.
- Qualität und Vollständigkeit hängen vom Modell-Grounding ab; nicht markierte Bilder werden nicht
  durch eine zweite, heuristische Bilderkennung ergänzt.
- Die bereits gerenderte Seite ist die Bildquelle. Die effektive Auflösung hängt daher von der
  gewählten OCR-DPI-Einstellung ab.

