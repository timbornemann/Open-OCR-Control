# Beitragen und Engineering-Standards

## Arbeitsweise

1. Änderungen beginnen mit einem nachvollziehbaren Issue oder einer klaren Problemformulierung.
2. Verhalten und Risiken werden vor der Implementierung festgehalten; grundlegende Entscheidungen
   erhalten ein ADR unter `docs/adrs`.
3. Änderungen bleiben klein, reversibel und auf einen Zweck begrenzt.
4. Ein Pull Request ist erst fertig, wenn Code, Tests, Dokumentation und Containerpfad konsistent
   sind.

## Definition of Done

- Akzeptanzkriterien sind erfüllt und negative Pfade sind berücksichtigt.
- `ruff check app tests`, `mypy app`, `pytest`, `npm run check` und `npm test` laufen fehlerfrei.
- Das Produktionsimage baut und `/api/health` antwortet im Container.
- Neue Konfiguration besitzt einen sicheren Standardwert und ist in README/.env dokumentiert.
- Sicherheits-, Datenschutz- und Ressourcenfolgen wurden geprüft.
- API- oder Architekturänderungen sind dokumentiert; Breaking Changes stehen im Changelog.

## Python

- Python 3.11 ist das minimale Sprachziel; Typprüfung ist strikt.
- I/O bleibt asynchron. CPU-/Blocking-Arbeit läuft über `asyncio.to_thread`.
- Öffentliche Fehler enthalten handlungsorientierte Meldungen, keine Secrets oder vollständigen
  Upstream-Responses.
- Dateipfade entstehen serverseitig. Benutzerdateinamen dienen nur zur Anzeige.
- Abhängigkeiten sind exakt gepinnt und werden wöchentlich durch Dependabot geprüft.

## TypeScript/React

- TypeScript läuft im Strict-Modus; `any` wird vermieden.
- UI-Zustände bilden die Serverzustände explizit ab.
- Live-Daten müssen wiederholbar/reconnect-fähig sein.
- Semantische HTML-Elemente, Tastaturbedienung, Fokusdarstellung und `prefers-reduced-motion` sind
  Pflicht.
- Externe Fonts, Analytics und CDN-Ressourcen sind aus Datenschutzgründen nicht erlaubt.

## Tests

- Unit-Tests decken Parser, Exporte und Formatkonvertierung ab.
- Integrationsnahe Tests simulieren den vLLM-SSE-Stream und prüfen die verpflichtenden Parameter.
- GPU-End-to-End-Tests sind hardwareabhängig und werden vor einem Release manuell mit mindestens
  einem Bild sowie einer mehrseitigen PDF durchgeführt.
- Ein Bugfix enthält nach Möglichkeit zuerst einen reproduzierenden Regressionstest.

## Commits und Releases

- Commitnachrichten sind kurz und imperativ, beispielsweise `Add streamed page export`.
- Releases verwenden SemVer-Tags (`v1.2.3`).
- Der GitHub Release-Workflow veröffentlicht `linux/amd64` nach GHCR und erzeugt SBOM sowie
  Provenienz-Attestierung.

