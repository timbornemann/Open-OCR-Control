# Betriebshandbuch

## Start und Bereitschaft

`docker compose up -d app` startet nur die Webanwendung. Der erste Auftrag ruft den Docker-Daemon
auf, legt `unlimited-ocr` mit der dokumentierten Baidu/vLLM-Konfiguration an und pollt `/v1/models`
bis zu 900 Sekunden. Währenddessen zeigt die UI `starting` bzw. `waiting_for_ocr`.

Beim Stoppen entfernt die App ausschließlich einen von ihr selbst angelegten Modellcontainer. Das
benannte Cachevolume bleibt bestehen. So kann Compose sein Netzwerk ohne verwaiste Endpoints
freigeben. Ein über das `eager`-Profil angelegter Container bleibt unter Compose-Kontrolle.

Für deterministisches Vorladen dient das Compose-Profil `eager`:

```bash
docker compose --profile eager up -d
```

## Zugriff aus dem lokalen Netzwerk

Docker Compose bindet die Webanwendung standardmäßig an `0.0.0.0:3011`. Andere Rechner im selben
vertrauenswürdigen Netzwerk verwenden `http://<HOST-LAN-IP>:3011`. Die LAN-Adresse des Hosts kann
beispielsweise so ermittelt werden:

```powershell
Get-NetIPAddress -AddressFamily IPv4 | Where-Object IPAddress -NotLike '127.*'
```

Das eigene, vertrauenswürdige WLAN sollte in Windows als privates Netzwerk eingestuft sein. Ein
Administrator kann Profil und Portfreigabe gezielt setzen:

```powershell
Set-NetConnectionProfile -InterfaceAlias "WLAN" -NetworkCategory Private
New-NetFirewallRule -DisplayName "Open OCR Control" -Direction Inbound -Protocol TCP -LocalPort 3011 -Action Allow -Profile Private
```

Unter Linux ist entsprechend eine Regel für TCP 3011 aus dem eigenen LAN-Subnetz erforderlich.
Port 3111 bleibt auf Loopback bzw. im Docker-Netzwerk; entfernte Browser benötigen nur Port 3011.
Ohne Authentifizierung darf die Anwendung nicht per Router-Portforwarding oder auf einem
öffentlichen Interface außerhalb eines vertrauenswürdigen LANs exponiert werden.

Mit `APP_BIND=127.0.0.1` in `.env` und anschließendem `docker compose up -d --force-recreate app`
wird wieder ausschließlich lokaler Zugriff erlaubt.

## Docker-Socket und Berechtigungen

Die On-Demand-Funktion benötigt Schreibzugriff auf `/var/run/docker.sock`. Docker Desktop stellt
diesen Mount gewöhnlich transparent bereit. Auf Linux muss die numerische Socket-Gruppen-ID als
`DOCKER_GID` übergeben werden. Der App-Prozess bleibt UID 10001, erhält aber die Socket-Gruppe.

Der Socket ist die größte Vertrauensgrenze des Systems. Für einen gehärteten Serverbetrieb:

1. `unlimited-ocr` außerhalb der App starten.
2. Socket-Volume und `group_add` aus Compose entfernen.
3. `OCR_MANAGE_CONTAINER=false` setzen.
4. `OCR_BASE_URL` auf die intern erreichbare vLLM-URL setzen.

## Ressourcen

- VRAM: mindestens 8 GB laut offiziellem vLLM-Rezept; höhere Parallelität erhöht Spitzenbedarf.
- Shared Memory: 8 GB für den Modellcontainer.
- App-Temp: Compose stellt 1 GB `/tmp` bereit; große Office-Konvertierungen liegen unter
  `/data/jobs`.
- Disk: Das Modellvolume kann mehrere GB belegen. Jobs werden standardmäßig nach 24 Stunden beim
  Neustart bereinigt.

## Fehlerdiagnose

### Modell bleibt auf „wird geladen“

```bash
docker ps -a --filter name=unlimited-ocr
docker logs --tail 100 unlimited-ocr
nvidia-smi
curl http://localhost:3111/v1/models
```

Typische Ursachen: inkompatibler NVIDIA-Treiber/CUDA-Pfad, zu wenig VRAM, fehlendes NVIDIA
Container Toolkit oder ein noch laufender Modelldownload.

### App kann Docker nicht erreichen

Prüfe den Socket-Mount und unter Linux `DOCKER_GID`. Alternativ auf externe Verwaltung wechseln.

### Office-Datei schlägt fehl

Das Produktionsimage enthält Writer, Calc und Impress. Bei lokaler Python-Ausführung muss
LibreOffice im `PATH` liegen. Passwortgeschützte oder beschädigte Dateien werden abgelehnt.

### Ausgabe ist leer

Die App setzt die drei Upstream-Pflichtwerte automatisch: `<image>`-Prompt,
`skip_special_tokens=false` und den registrierten N-Gram-Prozessor. Prüfe, ob der vorhandene
`unlimited-ocr`-Container wirklich mit dem Compose-/README-Kommando erstellt wurde; ein alter,
anders konfigurierter Container sollte nach Sicherung des Caches entfernt und neu angelegt werden.

## Backup und Update

OCR-Aufträge sind temporär und kein Backup-Ziel. Nur `unlimited-ocr-cache` spart erneute
Modelldownloads. Vor einem Update:

```bash
docker compose pull
docker compose up -d
```

Release-Images sind über unveränderliche SemVer-Tags und Digests referenzierbar.
