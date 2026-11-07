# Tizen 5.0: expliziter Service-Start beim Öffnen

> Historischer PoC-Stand. Aktueller automatischer Ablauf und TV-Test: [Alltagsstart für Tizen 5.0](DAILY-START-TIZEN5.md).


Referenzgerät: Samsung QE55LS03RAUXZG (2019), Tizen 5.0, Service-Runtime Node 4.4.3.
Die Legacy-Exportkorrektur bleibt enthalten. Dieser PoC ändert keinen Service-Code,
keine Original-YouTube-App und keine Systemeinstellungen.

Aktuelle Erweiterung mit Kontextdiagnose, begrenztem Start über laufendem Cobalt,
separatem bestätigtem Kill-Test und neuen Icons: [COBALT-CONTEXT-POC.md](COBALT-CONTEXT-POC.md).
Die unten aufgeführten Prüfsummen gehören zum ersten PoC-Build, nicht zu den neuen Paketen.

## Befund und Grenze der Cobalt-Übergabe

Das reguläre `app/config.xml:18–20` ordnet die Web-App über `pkgid` und `nativeID`
Samsungs nativer Engine zu. `tools/package.js:168–179` setzt für das Legacy-Paket:

```text
pkgid = com.samsung.tv.cobalt
nativeID = com.samsung.tv.cobalt-yt
native.userdata = --base_url=http://127.0.0.2:8099/tv --dial_name=Tube --use_eden
```

Die eigene `index.html` wird bei diesem Startpfad übersprungen. Im ursprünglichen
[Implementierungsbericht, PR 26](https://github.com/SushyDev/tizen-youtube/pull/26)
steht, dass der native Slot `read.metadata.from.hybrid.webapp` verwendet: Ohne
Zuordnung zur Web-App kamen deren Parameter beim damaligen Versuch nicht an.
Dies ist ein Bericht des Projektautors, kein neuer Versuch auf dem Referenzgerät.

Die [offizielle Tizen-5.0-TV-API](https://raw.githubusercontent.com/Samsung/tizen-docs/master/docs/application/web/api/5.0/device_api/tv/tizen/application.html)
beschreibt `tizen.application.launch()` und die Einschränkung für Service-Starts
aus fremden Paketen. Sie dokumentiert keinen Cobalt-spezifischen Schlüssel, der
`native.userdata` bei einem direkten `launchAppControl()` ersetzt. Ein bloßes
`launch('com.samsung.tv.cobalt-yt')` beweist daher keine Übernahme unserer Parameter.

Der ausdrücklich gewählte PoC benutzt deshalb zwei eigene Widgets:

| Widget | App-ID | Aufgabe |
| --- | --- | --- |
| Web-PoC | `tUb3Xq7L50.Tube` | Startet seinen eigenen `tUb3Xq7L50.TubeService`, prüft Ping, zeigt Diagnose |
| Optionales Handoff | `tUb3Xq7LCb.TubeCobalt` | Enthält nur die native Zuordnung und die bisherigen Parameter; keinen Service |

Die paketübergreifende Service-Beschränkung wird nicht umgangen: Der Service bleibt
im Paket `tUb3Xq7L50` und wird ausschließlich von dessen eigener Web-App gestartet.
Nur der spätere UI-Start des eigenen Handoff-Widgets erfolgt paketübergreifend.
Die Engine wird weiterhin von Samsung über deren bisherigen Metadatenpfad gestartet.
Ob die Firmware das Handoff korrekt registriert und zuordnet, bleibt ein TV-Test.

## Erzeugung und Reversibilität

```sh
npm run build
npm test
# Falls das reguläre Legacy-WGT noch fehlt oder nicht zum Service-Build passt:
npm run package
npm run package:start-poc
```

`package:start-poc` liest das reguläre `release/tube-tizen-5.0.wgt` und schreibt:

- `release/tube-tizen-5.0-start-poc.wgt`
- `release/tube-tizen-5.0-cobalt-handoff-poc.wgt`

Beide sind unsigniert und müssen vor Installation wie bisher mit einem geeigneten
Samsung-Partner-Zertifikat signiert werden. Die regulären WGTs werden nicht verändert.
Der Builder prüft die normalen Legacy-IDs, die exakten Cobalt-Parameter und den
bytegleichen aktuellen Service-Build. Fremde oder abweichende Profile werden abgelehnt.

Nur im erzeugten Web-PoC werden `pkgid` und `nativeID` entfernt, sodass die eigene
HTML-Seite laufen kann. `native.userdata` bleibt dort als Konfiguration für den
unveränderten Service erhalten: `service/lib/origin.js` liest daraus die Loopback-Adresse.
Das optionale Handoff behält alle drei nativen Metadaten mit den bisherigen Werten.

Nur im Web-PoC werden `on-boot` und `auto-restart` auf `false` gesetzt. Das isoliert
den expliziten Start und verhindert eine Verwechslung mit dem Boot-/Wiederanlaufpfad.
Die Quelldatei `app/config.xml` und die normalen Release-Flags bleiben unverändert.
Der erzeugte Web-PoC deklariert außerdem die Web-API-Version 5.0 passend zum Zielgerät;
der reguläre Legacy-Container hatte hier noch den geerbten Wert 5.5.
Ein verstecktes Prelaunch startet keinen Test; ein Sichtbarkeitswechsel zurück zum
bereits geöffneten PoC startet Cobalt ebenfalls nicht.

Der Web-PoC ersetzt bei Installation die bisherige eigene Tube-App, weil seine IDs
absichtlich gleich bleiben. Für ein Update denselben Autor/Signierweg verwenden.
Rollback: das normale Legacy-WGT erneut installieren und das eigene Paket
`tUb3Xq7LCb` entfernen. Keine fremde YouTube-App deinstallieren oder umkonfigurieren.

## Test 1: Nur den eigenen Dienst starten

1. Zunächst ausschließlich das Web-PoC-WGT installieren. Das Handoff ist dafür nicht nötig.
2. Den TV vollständig neu starten. Nicht vorab `sdb execute` oder einen anderen Starter verwenden.
3. Mit der Fernbedienung **Tube Starter** öffnen. Sichtbare Diagnose statt YouTube erwarten.
4. Der PoC prüft seine eigene App-/Paket-ID und macht einen Ping vor dem Startaufruf.
   Danach ruft er genau `tizen.application.launch('tUb3Xq7L50.TubeService', ...)` auf.
5. Erwartet: Erfolgscallback und anschließend HTTP **204** von
   `http://127.0.0.2:8099/__tube/ping`. Erst beides schaltet **Cobalt testen** frei.
6. Den sichtbaren Status und die Logzeilen einschließlich Fehlername/-text festhalten.
   Vorher bereits erfolgreicher Ping wird als **kein Kaltstartnachweis** ausgewiesen.

Ein Launch-Callback allein ist kein Bereitschaftsnachweis. HTTP 200 ist ebenfalls
kein Erfolg, da der tatsächliche Ping-Endpunkt HTTP 204 liefert. XHR hat 1,5 s Timeout;
nach fehlgeschlagenem Ping wird alle 0,5 s erneut versucht, insgesamt höchstens 30 s.
Fehlender Callback, geworfene Exception und API-Ablehnung bleiben sichtbar. Eine
fehlgeschlagene Web-XHR kann auch eine Loopback-/Web-Sicherheitsgrenze sein; sie
beweist ohne weitere TV-Diagnose nicht, dass der Service-Prozess nicht läuft.

## Test 2: Optionale native Übergabe

Erst nach erfolgreichem Test 1 das Handoff-WGT installieren. Beide Widgets und
Video laufen auf dem TV; es wird kein externer Rechner im Betrieb benötigt.

1. Andere YouTube-/Cobalt-Oberflächen regulär schließen und den PoC öffnen.
2. Nach **SCHRITT 1 OK** mit Links/Rechts **Cobalt testen** auswählen und OK drücken.
3. Der PoC prüft die installierte Handoff-Paket-ID und alle drei nativen Metadaten.
   Ein bereits laufender `com.samsung.tv.cobalt-yt` blockiert den Versuch. Kein Prozess wird beendet.
4. Er prüft einen frischen Ping und startet erst danach `tUb3Xq7LCb.TubeCobalt`.
   Es gibt keinen direkten parameterlosen Start der System-YouTube-App und keinen Web-Playback-Fallback.
5. Am Fernseher prüfen: native YouTube-Oberfläche, Video mit Ton, Mod-Einstellungen
   und Werbeblocker. Optional `/diag` und `/__tube/log` vom TV-Service lesen: neue
   Cobalt-/YouTube-Anfragen und Userscript-Beacons sind zusätzliche Hinweise.
6. Mindestens 15–30 Minuten abspielen: Bleibt der Dienst nach Ausblenden der Web-UI
   aktiv? Anschließend Standby/Art Mode, Kaltstart und erneutes bewusstes Öffnen testen.

Das erfolgreiche Handoff-Launch-Callback bestätigt nur die Annahme des Startaufrufs.
Es beweist weder die laufende native Engine noch deren tatsächliche Parameter oder Wiedergabe.
Der PoC bleibt bei Fehlern auf der Diagnose und beendet sich nicht automatisch.

Bedienung: Links/Rechts wählt die verfügbaren Schaltflächen, OK führt aus, Auf/Ab
scrollt das Protokoll, Zurück beendet ausschließlich die Web-PoC-App.

## Verifizierbarkeit

Lokal prüfbar und automatisiert getestet: abgeleitete Manifestinhalte, unveränderte
Service-Bytes, Entfernung alter Signaturen, ES2017-Syntax der erzeugten Seite,
Aufrufreihenfolge, Paketidentität, HTTP-204-Schranke, Fehler/Timeout, verstecktes
Prelaunch, Abbruch beim Ausblenden, Fernbedienungscodes und Handoff-Sperren.
Die Laufzeittests führen die tatsächlich in das Widget serialisierte Seite mit
simulierten Tizen-/XHR-Antworten aus. Sie ersetzen keinen Tizen-Test.

Nur auf dem TV prüfbar: Web-Einstieg nach Entfernung der Zuordnung, echter
Service-Start im selben Paket, tatsächliche Loopback-Erreichbarkeit, Registrierung
des neuen Handoff-Widgets, Parameterübernahme durch Samsung, native Wiedergabe,
Adblock, Hintergrund-Lebensdauer und Kaltstart-/Standby-Verhalten.

Beim ersten lokalen Prüflauf war kein TV angeschlossen. Inzwischen hat der Nutzer
den expliziten Service-Start mit HTTP 204 und das native Handoff auf dem Referenzgerät
bestätigt. Das Handoff gelang bisher nach Öffnen und vollständigem Beenden der
Samsung-YouTube-App. Die neue Kontext-/Kill-Erweiterung ist noch nicht am TV getestet.
Der PoC startet YouTube nie selbstständig beim Einschalten.

## Erster lokaler Prüflauf am 7. November 2026 (historischer Build)

- `npm run build`: erfolgreich; moderner und Legacy-Service inklusive Syntaxprüfung gebaut.
- `npm test`: Lint und Typprüfung erfolgreich, Userscript 299/299,
  Service 256/256, Start-PoC 20/20 Prüfungen bestanden.
- `npm run package:start-poc`: beide PoC-Archive erfolgreich erzeugt.
- Beide erzeugten Manifestdateien mit einem XML-Parser geprüft. IDs, Boot-Flags,
  unveränderte native Parameter und Abwesenheit eines Services im Handoff bestätigt.
- Service im fertigen Web-PoC bytegleich zum normalen Legacy-WGT und aktuellen Legacy-Build.
- Erzeugte HTML-Seite in lokalem Chromium bei 1920×1080 geprüft und visuell betrachtet.
  Tizen-API und HTTP 204 wurden simuliert: zuerst ausschließlich Service-Aufruf,
  danach per Links/OK ausschließlich der eigene Handoff-Aufruf, keine JavaScript-Seitenfehler.
  Das ist ein Browser-/Bedienungstest, kein Samsung-Laufzeitnachweis.
- `git diff --check`: erfolgreich. Reguläre Manifestdatei, Service-Startlogik und
  regulärer Packager wurden durch den PoC nicht verändert.
- Beide regulären WGTs sind anhand ihrer SHA-256-Prüfsummen vor/nach dem PoC-Lauf unverändert.

| Erzeugtes Archiv | Bytes | SHA-256 |
| --- | ---: | --- |
| `tube-tizen-5.0-start-poc.wgt` | 783756 | `336bfdb22d4689ff2ee1b105e37b08cc7cd686cf38dc7e1fb69a5f844c0b7ad8` |
| `tube-tizen-5.0-cobalt-handoff-poc.wgt` | 263924 | `0fd84b2c4a7f83ade1290ca09a9535218708c8a5d0d4385cdc36451b9ee7bf2f` |

Reguläres `tube-tizen-5.0.wgt`: unverändert
`29a3332eb83f20f54cd22bc526e3dbc6915b19431dd84777953fad2b731609a4`.
Reguläres `tube-tizen-5.5.wgt`: unverändert
`5cf7ff36495f249d87ddf391221e42d6952330a44704ed5dbab786fc1dd1ba70`.
