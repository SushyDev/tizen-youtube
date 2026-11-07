# Tube Starter: erster Alltagsstart für Tizen 5.0

Stand: 7. November 2026. Zielgerät: Samsung QE55LS03RAUXZG, Tizen 5.0,
Service-Laufzeit Node.js 4.4.3. Diese Version ersetzt die manuelle Bedienfolge der
beiden bisherigen PoCs. Die Dateinamen und getrennten Icons bleiben erhalten.

## Pakete und Installation

| Anwendung | WGT unter `release/` | App-ID | Paket-ID |
| --- | --- | --- | --- |
| Tube Starter (blau, Play/Zahnrad) | `tube-tizen-5.0-start-poc.wgt` | `tUb3Xq7L50.Tube` | `tUb3Xq7L50` |
| Tube Cobalt (rot, Play/Rechtspfeil) | `tube-tizen-5.0-cobalt-handoff-poc.wgt` | `tUb3Xq7LCb.TubeCobalt` | `tUb3Xq7LCb` |

Die erzeugten WGTs sind **unsigniert**. Beide mit dem bisherigen Samsung-Partner-
Zertifikat signieren und auf dem TV aktualisieren; die Bereinigung benötigt
`http://tizen.org/privilege/appmanager.kill`. Zum täglichen Start ausschließlich
**Tube Starter** öffnen. Das rote Handoff muss installiert sein, wird aber vom
Starter selbst aufgerufen. Kein zusätzlicher Rechner ist zur Laufzeit nötig.

Die Starter-ID ersetzt weiterhin das bisherige Tizen-5.0-Tube-Paket, nicht Samsungs
originale YouTube-App. Die Service-ID bleibt `tUb3Xq7L50.TubeService`.

## Ablauf eines Startvorgangs

1. Nur bei sichtbarer Starter-Seite beginnen. Eigene App- und Paket-ID prüfen.
2. `GET http://127.0.0.2:8099/__tube/ping` abfragen. Nur HTTP 204 gilt als bereit.
   **Fall A:** Bei Erfolg bestehenden Service nutzen und keinen Service-Launch senden.
   **Fall B:** Andernfalls den eigenen Service einmal mit `tizen.application.launch()`
   starten, seinen Erfolgscallback abwarten und anschließend HTTP 204 bestätigen.
   Ein fehlgeschlagener Ping allein gibt keine Bereinigung frei. Auch ein akzeptierter
   Launch beweist keinen neuen Service-Prozess; protokolliert wird nur die belegte
   API-Anforderung samt anschließender Bereitschaft in diesem Aufruf.
3. Nach akzeptiertem Service-Start Ping abfragen, mit 1,5 s Request-Timeout und
   500 ms Pause zwischen Fehlversuchen. Die Bereitschaftsphase endet nach spätestens
   20 s ab Startvorgang; ein ausbleibender API-Callback fällt unter die Gesamtfrist.
4. Installierte Handoff-Paket-ID und alle drei Cobalt-Metadaten prüfen, bevor eine
   automatische Bereinigung infrage kommt. Fehlt das Handoff, bleibt der Starter
   für den isolierten Diensttest nutzbar; keine Bereinigung auslösen.
5. **Fall A:** Keine automatische Bereinigung. Kontexte mit App-/Context-IDs
   protokollieren und normal zum Handoff gehen, auch wenn Cobalt bereits läuft.
6. **Fall B:** Nach bestätigter Bereitschaft Kontexte abfragen. Bei genau einer
   gültigen Instanz von `com.samsung.tv.cobalt-yt` unmittelbar vor dem Kill die
   gesamte Liste erneut lesen und dieselbe Context-ID prüfen. Ausschließlich diesen
   Kontext einmal beenden, auch wenn er zur originalen YouTube-Sitzung gehört.
   Erfolgscallback allein reicht nicht: sofort und nach 1,2 s Kontexte lesen.
   Erst bei verschwundener Ziel-ID zum Handoff gehen. Fehler, ausbleibender Callback
   oder weiterhin vorhandene Ziel-ID stoppen den Start ohne weiteren Kill/Handoff.
7. **Fall B ohne eindeutiges Ziel:** Bei keinem Kontext direkt zum Handoff gehen.
   Bei mehreren, ungültigen, inzwischen geänderten oder mit anderen Apps kollidierenden
   IDs keine automatische Bereinigung; stattdessen normalen Handoff wie in Fall A
   versuchen und den Grund protokollieren. Kein fremder Prozess wird beendet.
8. Unmittelbar vor jedem Handoff HTTP 204 erneut prüfen. Nach dessen Startcallback
   sofort und nach 3 s Kontexte abfragen, auch bei Fehlercallback.
9. Nur wenn unmittelbar vor Versuch 1 Cobalt vorhanden war und nach 3 s **kein**
   Cobalt-Kontext mehr existiert: 1,2 s warten und Kontexte erneut prüfen. Falls
   Cobalt weiterhin fehlt, nach frischem Ping genau einen zweiten Handoff senden.
   Ein neuer Kontext verhindert den Folgeversuch. Nach Versuch 2 immer stoppen.
10. Bei anhaltender Blockade manuelle Bereinigung anbieten, sofern das gemeinsame
    Kill-Budget noch frei ist. Bei verbrauchtem Budget für einen neuen, bewussten
    Benutzeraufruf „YouTube erneut starten“ wählen; kein automatisches Zurücksetzen.

Pro Benutzeraufruf höchstens **ein Kill-Versuch insgesamt** (automatisch oder manuell)
und **zwei Handoff-Aufrufe**, eine absolute Gesamtfrist von
30 s, keine periodische Überwachung nach Abschluss. Ein suspendierter, später
wieder ausgeführter Callback darf nach Fristende keinen Start auslösen. Ausblenden
vor dem Handoff bricht den Start ab; nach einem bewussten Handoff darf dessen
begrenzte Beobachtung im Hintergrund weiterlaufen (`background-support="enable"`).
Nach deren Abschluss schließt sich der ausgeblendete Starter selbst, damit der
nächste Smart-Hub-Aufruf einen frischen Startvorgang erhält. Die native Cobalt-App
und der Service werden dabei nicht per Kill beendet. Ob der Service auf der
konkreten Firmware nach dem Schließen des Starters weiterläuft, gehört zum TV-Test.
Ein bloßes Sichtbarwerden derselben noch geladenen Seite startet keine Wiederholung.

Der native Einstieg bleibt im eigenen Handoff-Paket und verwendet unverändert:

```text
pkgid:          com.samsung.tv.cobalt
nativeID:       com.samsung.tv.cobalt-yt
native.userdata: --base_url=http://127.0.0.2:8099/tv --dial_name=Tube --use_eden
```

## Bereinigung und Diagnose mit der Fernbedienung

Wenn der Starter nach einem Handoff einen Cobalt-Kontext findet, bleibt dessen
Herkunft zunächst unklar. Wenn YouTube sichtbar korrekt läuft, keine Bereinigung
ausführen. Nur bei tatsächlicher Blockade:

1. **Blockierenden Cobalt-Kontext bereinigen** wählen.
2. Angezeigte App-ID und Context-ID prüfen. Der Hinweis erklärt, dass auch eine
   laufende YouTube-Wiedergabe beendet würde. Erst ein weiterer OK auf
   **Beenden bestätigen (OK)** autorisiert einen einzigen Kill.
3. Nur bei noch freiem Kill-Budget ist der Button aktiv. Vor dem Kill wird die Liste erneut abgefragt. Nur genau ein Kontext von exakt
   `com.samsung.tv.cobalt-yt` mit derselben nichtleeren Context-ID ist zulässig.
   Geänderte, mehrdeutige oder von anderen Apps mitbenutzte IDs sperren den Kill.
4. Erfolg/Fehler sowie Kontexte sofort und nach erfolgreichem Kill zusätzlich nach
   1,2 s protokollieren. Es folgt kein automatischer Start und kein erneuter Kill.
   Auch ein fehlgeschlagener Kill verbraucht das Budget. Bei verschwundenem Ziel
   **YouTube erneut starten** wählen. Das ist ein neuer,
   bewusst ausgelöster Startvorgang mit eigener Obergrenze von zwei Handoffs.

**Nur Diagnose anzeigen** hält den Start an und lässt das Protokoll sichtbar.
**Nur Dienst prüfen/starten** erhält den isolierten Service-PoC: nach dem Anhalten
kann der eigene Dienst unabhängig vom installierten Handoff geprüft oder gestartet
werden, ohne Cobalt-Start und ohne Kill.
Die Diagnose-Taste ist sofort fokussiert; zum Lesen eines vorherigen erfolgreichen Starts
Tube Starter öffnen und zügig OK drücken. Bereits akzeptierte API-Aufrufe können
nicht zurückgenommen werden; ihre verspäteten Callbacks lösen keine Folgeaktion aus.
Links/Rechts wählen, OK ausführen, Auf/Ab scrollen, Zurück schließt den Starter.
Gedrückthalten von OK darf die zweite Bereinigungsbestätigung nicht ersetzen.
Ausblenden oder ein neuer Start entwaffnen eine vorbereitete Bereinigung.

Das lokale Protokoll enthält neue Aufrufmarkierungen mit Datum, UTC-Zeiten,
Startnummern, Ping-Ergebnisse, Metadaten, komplette Kontextlisten und sämtliche
Start-/Kill-Erfolgs- und Fehlercallbacks einschließlich Fehlername, Text und Code.
Es bleibt auf 24000 Zeichen begrenzt und wird, soweit verfügbar, in Web-Storage
aufbewahrt. Gespeicherte Logs, User-Agent-Werte oder alte Bootmeldungen steuern
keine Entscheidung. Ein Erfolgscallback bedeutet „Startaufruf akzeptiert“, ein
Cobalt-Kontext bedeutet „Prozess beobachtet“. Beides beweist noch keine funktionierende
modifizierte Sitzung. Eine frische Seitenrückmeldung mit Sitzungskennung ist
entsprechend der Vorgabe ausdrücklich nicht implementiert.

## Bootverhalten und bekannte Grenze

Beide erzeugten Manifeste deaktivieren `prelaunch.support`. Beim Starter sind
Service-`on-boot` und `auto-restart` weiterhin `false`; es gibt keinen Boot-Handler.
Die Hintergrund-Vorladung löst auch bei versehentlicher Ausführung einer unsichtbaren
Seite weder Requests noch Start- oder Kill-Aufrufe aus.

**TV-Voraussetzung: „Letzte App automatisch ausführen“ ausschalten.** Je nach
Firmware unter Einstellungen → Allgemein → Smart-Funktionen. Ein sichtbares
Wiederherstellen durch die TV-eigene Autorun-Funktion lässt sich mit den bisher
belegten APIs nicht verlässlich von einem bewussten Öffnen unterscheiden. Ohne
diese Einstellung ist „niemals Aktivierung beim Einschalten“ nicht zugesichert.
Das gilt auch für eine vom TV selbst wiederhergestellte native Cobalt-App.
Die App verstellt keine TV-Systemeinstellungen.

Samsung beschreibt [Prelaunch als Laden im Hintergrund beim Einschalten](https://developer.samsung.com/smarttv/develop/guides/fundamentals/prelaunching-applications.html)
und [Autorun der letzten App als eigene TV-Funktion](https://www.samsung.com/ae/support/tv-audio-video/use-autorun-start-screen-options-on-your-samsung-tv/).
Die genaue Menüposition und das Verhalten bei Art Mode/Kaltstart sind am 2019er
The Frame zu prüfen. Ohne Gerätezugriff wäre eine weitergehende Garantie unbelegt.

## Lokale Prüfung

Ausgeführt: `npm run build`, `npm test`, `npm run package:start-poc`.
Für einen vollständig neuen Checkout zunächst nach dem Build mit `npm run package`
das reguläre Legacy-WGT als Eingang erzeugen. Der PoC-Packager verweigert ein
Legacy-WGT, dessen Service nicht dem aktuellen Build entspricht. In diesem Lauf
konnte das unveränderte reguläre WGT weiterverwendet werden.

- Lint und Typecheck ohne Fehler.
- Userscript: 299/299, Service: 256/256, Starter: 61/61 Prüfungen erfolgreich.
- Starter-Tests führen die tatsächlich in das WGT serialisierte Seite mit Tizen-
  API- und Uhr-Stubs aus: automatischer Ablauf, HTTP-204-Pflicht, Zeitgrenzen,
  Kontextwechsel, genau ein Folgeversuch, verspätete/doppelte Callbacks,
  automatische Bereinigung ausschließlich nach eigenem Service-Launch + HTTP 204,
  erneute Zielprüfung, gemeinsames Kill-Budget, explizite Bereinigung, fremde Apps,
  Berechtigungsfehler und Fernbedienung.
- Beide ZIPs per CRC vollständig lesbar; alle Manifest-Dateiverweise vorhanden.
  Legacy-Service und beide Assets im Starter sind bytegleich mit regulärem
  Tizen-5.0-WGT und aktuellem Legacy-Build. Kein neuer Service-Endpunkt, keine
  Änderungen am Service, Cobalt-Bibliotheken oder an Samsungs App.
- Beide Icons sind weiterhin unterschiedliche PNGs mit 117×117 Pixeln.
  Das Handoff enthält genau Manifest, Platzhalter-HTML und eigenes Icon; keinen
  Service. Die drei nativen Metadaten bleiben unverändert.

Zusätzlich die tatsächlich aus dem neuen WGT extrahierte HTML-Seite in lokalem
Chromium bei 1920×1080 getestet (Tizen-APIs und Ping simuliert):

- Dienst zunächst offline ohne Cobalt → ein Service-Start, danach ein Handoff.
- Dienst zunächst offline mit einem Cobalt-Kontext → ein gezielter Kill, überprüftes
  Verschwinden, ein Handoff; fremde App bleibt erhalten, weiterer Kill gesperrt.
- Bestehender Kontext bleibt → ein Handoff; manuelle Doppelbestätigung beendet nur
  die angezeigte Instanz, eine fremde App bleibt erhalten; neuer Start funktioniert.
- Bisheriger Kontext verschwindet → genau zwei Handoffs insgesamt.

Alle vier Browser-Szenarien ohne JavaScript-Seitenfehler.
Der letzte vollständige `npm test`-Lauf erfolgte nach Sandbox-`EPERM`-Fehlern
für lokale Testports/Unterprozesse außerhalb der Sandbox erfolgreich. Alle Bedienelemente liegen
im sichtbaren Bild; die Simulation bestätigt keine Tizen-API- oder Cobalt-Funktion
auf der TV-Firmware. Hintergrundbeobachtung und Selbstbeenden sind zusätzlich in
der isolierten Starter-Suite geprüft.

Erzeugte Dateien vor Signierung (diese ändert Größe und Prüfsumme):

| WGT | Bytes | SHA-256 |
| --- | ---: | --- |
| `tube-tizen-5.0-start-poc.wgt` | 532068 | `d4e3cabe498691800cb424df7ac2e65064eebd471bb205fdff736e0397053428` |
| `tube-tizen-5.0-cobalt-handoff-poc.wgt` | 7177 | `e117ecd15aadc45aa1dc0c0afa1636b7978ff3c0df6565b38455edea5343a1b2` |

Kein Fernseher ist an diese Umgebung angebunden. Die vorhandenen Live-YouTube-
E2E- und Docker-Cobalt-Tests ersetzen keinen Tizen-Launcher-Test und wurden für
unveränderte Wiedergabe-/Userscript-Logik nicht zusätzlich gestartet. Auch ein
separater Node-4.4.3-Prozess steht hier nicht zur Verfügung; der Build prüft den
Legacy-Syntax-Floor, die Legacy-Tests prüfen unter anderem die Lifecycle-Exporte.
Die Laufzeitkompatibilität beruht zusätzlich auf dem bereits erfolgreichen
Service-PoC am Gerät, nicht auf einem neuen TV-Test dieser Version.

## Praxistest am Fernseher

1. Beide aktualisierten, signierten Pakete installieren. Icons/Namen unterscheiden.
   TV-Autorun deaktivieren. Weder die Original-YouTube-App noch das rote Handoff
   vorab öffnen. TV vollständig neu starten; ohne App-Aufruf darf YouTube nicht
   erscheinen. Dasselbe aus Standby und aus Art Mode prüfen.
2. Einmal **Tube Starter** öffnen. Erwartet: aktueller Ping, falls nötig einmal
   Service-Launch, HTTP 204, automatisches Handoff, native Oberfläche und funktionierende
   Wiedergabe einschließlich Werbeblocker. Nicht bloß einen alten Bootlog bewerten.
3. Nach mindestens 30 s weiter abspielen: Service muss trotz geschlossenem
   Hintergrund-Starter weiter funktionieren. Originale YouTube-App unverändert.
4. YouTube normal verlassen, Starter wieder öffnen. Erwartet: bei HTTP 204 kein
   Service-Launch. Nach erfolgreicher Hintergrundbeobachtung soll der Starter beim
   nächsten Hub-Aufruf frisch beginnen. Mehrmals mit Standby/Art Mode wiederholen.
5. Falls ein vorhandener Kontext den Start blockiert: Diagnose ansehen. Erwartet:
   bei bereits bereitem Service erster Handoff ohne Kill; bei verschwundenem alten Kontext höchstens ein zweiter
   nach erneuter Prüfung. Bleibt Cobalt bestehen, kein automatischer Kill/Neustart.
6. Fall B gesondert prüfen: TV kalt starten, danach Starter öffnen. Wenn der Service
   erfolgreich gestartet wurde und HTTP 204 liefert, darf ein eindeutiger Cobalt-
   Kontext einmal automatisch beendet werden. Im Log gleiche ID vor Kill und
   verschwundene ID danach prüfen; erst danach Handoff. Bei noch nicht bereitem
   Service, Kill-Fehler oder weiter bestehendem Ziel darf kein Handoff folgen.
7. In Fall A bei tatsächlicher Blockade Bereinigung zweimal bewusst bestätigen. App-ID und
   Context-ID festhalten. Erwartet: genau ein Kill dieser Instanz, danach Kontext
   verschwunden, unbekannte Apps unberührt. Der Kill-Button ist anschließend
   gesperrt; danach einmal erneut starten. Mehrere native Kontexte dürfen keinen
   automatischen Kill auslösen. Eine geänderte Ziel-ID unmittelbar vor Kill ebenso wenig.
8. Fehlerfälle: Handoff vorübergehend nicht installiert → sichtbarer Fehler ohne
   native Ausweichstarts; Zurück während des Starts → keine späten Folgestarts;
   Diagnoseansicht → stoppt die Folgeaktionen; gehaltenes OK bestätigt keinen Kill.
9. Pro Fall Datum, Startnummer, vorherige/nachherige Context-IDs, Callbackfehler,
   Anzahl Handoffs und tatsächliche Wiedergabe notieren. Hintergrund-Timer,
   Partner-Kill-Freigabe und Service-Fortbestand nach Starter-Ende sind Firmware-
   Eigenschaften und müssen in diesem neuen Ablauf ausdrücklich bestätigt werden.

Sicherung des unmittelbar vorherigen lokalen WGT-Paars:
`release/archive/before-service-dependent-cleanup-2026-11-07/`. Dieses Paar ist die
vorangegangene lokale Alltagsversion und wurde nicht als TV-getestet ausgegeben.
Die vom Benutzer früher erfolgreich getesteten signierten PoCs ebenfalls aufbewahren.

Für die Ein-Paket-Untersuchung werden die beiden aktuellen PoCs nicht verändert.
Ergebnis separat: [Ein-Paket-Architektur](ONE-PACKAGE-TIZEN5.md).

Rückbau: vorheriges signiertes Starter-/Handoff-Paar wieder installieren; alternativ
reguläres signiertes Tizen-5.0-WGT verwenden. Dessen Service benötigt auf dem
betroffenen TV weiterhin den bisher bekannten manuellen Start. Es wurden weder
Systemdateien noch die originale Samsung-YouTube-App verändert.
