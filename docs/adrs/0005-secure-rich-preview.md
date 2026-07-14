# ADR 0005: Sichere Rich-Preview für HTML und Mathematik

- Status: Angenommen
- Datum: 2026-07-14

## Kontext

Unlimited-OCR liefert neben Markdown auch HTML-Tabellen und mathematische Ausdrücke. Dabei kommen
sowohl Standarddelimiter (`$…$`) als auch LaTeX-Delimiter (`\(…\)`, `\[…\]`) und vereinfachte
OCR-Formen wie `( w(e) )` vor. Roh-HTML direkt in React einzubetten würde eine XSS-Grenze öffnen.

## Entscheidung

Die Vorschau nutzt eine einheitliche AST-Pipeline: GFM und Mathematik werden geparst, eingebettetes
HTML wird in den Syntaxbaum übernommen und anschließend mit dem GitHub-orientierten
`rehype-sanitize`-Schema bereinigt. Erst nach dieser Bereinigung markiert ein lokales Plugin die
zusätzlichen OCR-Mathematikdelimiter. KaTeX erzeugt daraus die finale Darstellung. Modell-Styles,
Skripte und Event-Handler erreichen KaTeX oder React nicht.

KaTeX benötigt für präzises Layout selbst erzeugte Inline-Styles. Deshalb erlaubt die CSP
`style-src 'unsafe-inline'`, während `script-src`, externe Ressourcen, Frames und Objekte weiterhin
auf dieselbe Herkunft beschränkt bzw. gesperrt bleiben.

## Folgen

- HTML-Tabellen, GFM-Tabellen und Formeln erscheinen in derselben Vorschau korrekt.
- Die Anwendung verwendet kein `dangerouslySetInnerHTML` für Modellinhalt.
- Heuristisch erkannte Klammerformeln müssen mathematische Merkmale enthalten, damit normale
  Klammertexte nicht versehentlich umgewandelt werden.
- Rendering- und Sanitizing-Tests sind Teil der Frontend-Testreihe.
