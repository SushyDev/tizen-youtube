# Tube Starter: laufenden Cobalt-Kontext untersuchen

> Historischer PoC-Stand. Aktueller automatischer Ablauf und TV-Test: [Alltagsstart für Tizen 5.0](DAILY-START-TIZEN5.md).


## Befunde vor der Änderung

Der Nutzer bestätigt auf dem Samsung QE55LS03RAUXZG mit Tizen 5.0:
Service-Start im eigenen Paket und HTTP 204 funktionieren. Das eigene native
Handoff funktioniert, nachdem Samsung-YouTube einmal geöffnet und vollständig
beendet wurde. Ohne diesen Schritt meldet der bisherige PoC selbst nach Kaltstart
einen vorhandenen Cobalt-Kontext.

Die bisherige Prüfung in `tools/poc/start.js` verwendete nur
`contexts.some(context => context.appId === config.nativeId)`. Das ist eine
Prozess-/Kontextprüfung, kein Nachweis einer sichtbaren Oberfläche oder laufender
Wiedergabe. Welche Context-ID am TV tatsächlich vorhanden ist, war damit bisher
nicht dokumentiert. Ob ein vorgeladener, suspendierter oder anderweitig gestarteter
Kontext vorliegt, bleibt eine Hypothese, bis das neue Protokoll vom TV vorliegt.

Die unverändert belassenen Service-Funktionen liefern zwei unterschiedliche Vorbilder:

- `service/lib/cobaltLaunch.js:35`: `launchOver()` startet die eigene App, prüft
  nach 3000 ms auf einen Cobalt-Kontext und startet einmal erneut, wenn keiner da ist.
  Die Funktion wertet keinen Oberflächenstatus aus. Eine fehlgeschlagene Kontextabfrage
  gilt vorsichtshalber als „läuft“, damit kein weiterer Start entsteht.
- `service/lib/cobalt.js:57`: `relaunch()` sucht die eigene UI und den Cobalt-Kontext,
  beendet die gefundenen Kontexte und startet die eigene UI nach 1200 ms. Kill-Erfolg
  und Kill-Fehler werden dort gleich behandelt; der Zähler `killed` beweist also keine
  erfolgreichen Beendigungen. Diese Funktion wird hier nicht aufgerufen oder verändert.

Der PoC startet weiterhin ausschließlich das eigene Handoff
`tUb3Xq7LCb.TubeCobalt`, dessen Metadaten zu `com.samsung.tv.cobalt-yt` führen.
Service-ID, Paket-IDs und alle nativen Startparameter bleiben gleich.

## Bewusst getrennte Tests auf dem TV

Die normalen Cobalt-Aktionen sind erst nach Service-Launch und HTTP 204 verfügbar.
Links/Rechts wählt eine Schaltfläche, OK löst aus, Auf/Ab scrollt, Zurück beendet
die Starter-UI und verwirft wartende Aktionen. Gedrückt gehaltenes OK bestätigt
keinen Kill durch `keydown.repeat`.

1. **Cobalt testen**: bisheriger vorsichtiger Test. Er protokolliert jetzt die gesamte
   Kontextliste mit genauer `appId` und `id`. Ist Cobalt bereits vorhanden, startet er
   nichts und verweist auf den getrennten Test.
2. **Start über Cobalt (max. 2)**: bewusstes Starten des Handoffs trotz vorhandener
   Cobalt-Instanz. Nach Erfolgscallback werden sofort und nach drei Sekunden Kontexte
   protokolliert. Alte verschwundene IDs werden gesondert ausgegeben. Nur wenn zuvor
   Cobalt vorhanden war und anschließend gar kein Cobalt-Kontext mehr existiert,
   wird nach weiteren 1,2 Sekunden genau ein Folgeversuch vorbereitet. Vorher prüft
   der PoC erneut die Kontexte und HTTP 204. Ein inzwischen vorhandener neuer Kontext,
   ein API-Fehler, ein fehlender Callback oder ein fehlgeschlagener Ping verhindert
   diesen Folgeversuch. Nach Versuch 2 gibt es keine weitere Wiederholung.
3. **Cobalt gezielt beenden**: erster OK zeigt die konkrete App-ID und Context-ID an.
   Erst ein zweiter OK auf **Beenden bestätigen** darf einen einzigen `kill(contextId)`
   senden. Davor wird dieselbe Instanz erneut abgefragt. Nur genau eine gültige Instanz
   von exakt `com.samsung.tv.cobalt-yt` ist zulässig. Geänderte, fehlende, mehrdeutige
   oder fremden Apps zugeordnete IDs werden nicht beendet. Erfolg und Fehler inklusive
   Fehlername, Text und Code werden separat protokolliert; nach Erfolg gibt es sofort
   und nach 1,2 Sekunden weitere Kontextlisten. Es folgt weder ein automatischer Start
   noch ein weiterer Kill. Handoff anschließend separat per OK testen.

Die [Tizen-5.0-TV-Referenz für `kill`](https://raw.githubusercontent.com/Samsung/tizen-docs/master/docs/application/web/api/5.0/device_api/tv/tizen/application.html)
nennt `http://tizen.org/privilege/appmanager.kill` als Partner-Berechtigung und
verlangt eine Context-ID, keine App-ID. Nur das erzeugte Starter-Manifest bekommt
diese Berechtigung. Beide Pakete müssen vor Installation wieder signiert werden;
die tatsächliche Freigabe auf dieser Firmware bleibt zu testen. `SecurityError`,
`NotFoundError` oder andere Fehler werden nicht durch privilegierte Hilfsmittel umgangen.

## Ausblenden, Grenzen und Protokoll

Das Handoff kann die Starter-UI ausblenden. Der vorherige PoC brach dabei alle
Beobachtungen ab; das wäre für den neuen Folgeversuch ungeeignet. Nur ein bereits
per OK angeforderter Handoff darf seine kurze Beobachtung im Hintergrund fortsetzen.
Das erzeugte Starter-Manifest hat dafür `background-support="enable"`.

Jeder Versuch hat zusätzlich zur Timer-Grenze eine absolute 30-s-Frist. Nach
Suspendieren/Resume dürfen veraltete Callbacks keinen verspäteten Start auslösen.
Ob Samsungs Firmware die kurzen Hintergrund-Timer tatsächlich ausführt, ist ein
Hardware-Test. Bei Fehlern oder ausbleibenden Callbacks werden keine weiteren
Start-/Kill-Aufrufe ausgelöst. Die Service-Boot-Flags bleiben im PoC auf `false`.
Beim TV-Start wird weder Cobalt gestartet noch beendet.

Kontextlisten stehen vor und nach Service-, Handoff- und Kill-Versuchen im Log.
Das Log enthält UTC-Zeitstempel und bleibt, soweit Web-Storage verfügbar ist,
begrenzt auf die letzten 24000 Zeichen nach erneutem Öffnen lesbar. Jeder neue
Aufruf ist markiert. Aus gespeicherten Einträgen werden keine Aktionen rekonstruiert;
insbesondere wird kein gespeichertes Kill-Ziel verwendet.

## Namen und Icons

| Anwendung | App-ID | Eigenes Paket-Icon |
| --- | --- | --- |
| Tube Starter | `tUb3Xq7L50.Tube` | `icon-starter.png`, blau, weißes Play und Zahnrad, „Tube Starter“ |
| Tube Cobalt | `tUb3Xq7LCb.TubeCobalt` | `icon-cobalt.png`, rot, weißes Play und Rechtspfeil, „Tube Cobalt“ |

Beide Icons sind 117×117 Pixel, 8-Bit-RGBA-PNG mit 72-DPI-Metadaten, unter 300 KB.
Das entspricht dem installierten Test-App-Icon aus der
[Samsung-Design-FAQ](https://developer.samsung.com/smarttv/design/smart-tv-application-design-qa.html).
Die getrennten Seller-Office-Storegrafiken sind für diesen sideloadbaren PoC nicht
erforderlich. Beide Manifeste referenzieren ihren eigenen Dateinamen einschließlich
117×117-Abmessungen. Das geerbte `icon.png` wird aus beiden PoC-Archiven entfernt;
jedes WGT enthält nur sein eigenes Icon. Die normalen Release-Icons bleiben unverändert.
Die tatsächliche Darstellung und ein möglicher Smart-Hub-Iconcache sind am TV zu prüfen.

## Erzeugung und Rückkehr zur normalen App

```sh
npm run build
npm test
npm run package:start-poc
```

Der PoC-Packager verwendet das passende reguläre Legacy-WGT als unveränderte Basis.
Falls es noch fehlt oder nicht zum Service-Build passt, zuerst `npm run package` ausführen.
Erzeugte Pakete:

- `release/tube-tizen-5.0-start-poc.wgt`
- `release/tube-tizen-5.0-cobalt-handoff-poc.wgt`

Beide ersetzen bei Update jeweils nur die bisherigen eigenen PoCs. Den bisherigen
Autor-/Signierweg beibehalten. Rollback: normales Legacy-WGT installieren und das
eigene Handoff-Paket `tUb3Xq7LCb` entfernen. Keine System-YouTube-App deinstallieren.

## Evidenzgrenzen

Der ursprüngliche Service-Start und das Handoff unter der genannten Vorbedingung
sind durch den Nutzer auf dem TV bestätigt. Die neue Kontext-/Wiederholungs-/Kill-
Logik wird lokal mit simulierten Tizen-Kontexten geprüft. Die Archive werden zusätzlich
auf Berechtigungen, unveränderte native Parameter, Namen und PNG-Inhalte geprüft.
Diese Erweiterung wurde während der Implementierung nicht auf dem TV ausgeführt.
Insbesondere erfolgreicher Kill, Verhalten nach Start über Cobalt und native
Wiedergabe ohne vorheriges Öffnen von Samsung-YouTube bleiben ausstehende TV-Tests.

## Lokaler Prüflauf dieser Erweiterung

- `npm run build`: erfolgreich, einschließlich Node-4.4.3-Syntaxprüfung.
- `npm test`: Lint/Typprüfung erfolgreich; Userscript 299/299, Service 256/256,
  Start-PoC 34/34 Prüfungen bestanden.
- Im ersten vollständigen Lauf scheiterte der unveränderte Test
  `service/test/bootScreen.js:192`: Er erwartet exakt „page written 0s ago“, obwohl
  die Zeit zwischen HTML-Erzeugung und Prüfung real vergeht. Isolierter Lauf 48/48
  und anschließender vollständiger Wiederholungslauf erfolgreich. Keine Änderung
  am Test oder an der Service-Logik vorgenommen.
- `npm run package:start-poc`: beide WGTs erfolgreich erzeugt.
- Fertige WGTs mit XML-Parser und PNG-Decoder geprüft: Namen, IDs, eigener Iconpfad,
  117×117 RGBA, Kill-Berechtigung ausschließlich im Starter, Hintergrundoption,
  unveränderte native Argumente und unveränderte Service-Bytes bestätigt.
- Erzeugte Seite in Chromium mit simuliertem alten/neuen Cobalt-Kontext geprüft:
  normaler Test blockiert, expliziter Überstart ruft das Handoff genau zweimal auf,
  Kill benötigt erneutes OK, beendet nur die gewählte neue Instanz und lässt die
  simulierte fremde App unberührt. Keine JavaScript-Seitenfehler. Bildschirmansicht
  bei 1920×1080 sowie beide Icons visuell geprüft.
- `git diff --check`: erfolgreich. Die normalen WGTs sind anhand ihrer bisherigen
  SHA-256-Prüfsummen unverändert; die beiden Service-Cobalt-Dateien sind unverändert.

| Archiv | Bytes | SHA-256 |
| --- | ---: | --- |
| `tube-tizen-5.0-start-poc.wgt` | 530959 | `928d8bf3a843aaec5367e9465e4a97962ea5127de6c481273e3b79dfdc894f6e` |
| `tube-tizen-5.0-cobalt-handoff-poc.wgt` | 7172 | `b2bfec2f534ca7eec8ca75db3c22848eb79af47047cbb2b396c432624dcad213` |
