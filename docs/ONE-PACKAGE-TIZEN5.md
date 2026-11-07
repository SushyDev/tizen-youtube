# Ein-Paket-Architektur unter Tizen 5.0: Untersuchung

Stand: 7. November 2026. Getrennt vom fertig gebauten Starter-/Handoff-Paar.
**Keine dritte WGT erzeugt.** Für eine zuverlässig parametrierte Cobalt-Übergabe
innerhalb eines einzigen WGT ist noch kein ausreichend belegter Weg gefunden.
Das ist keine Behauptung, jede proprietäre Samsung-Erweiterung sei ausgeschlossen.
Die aktuelle Zwei-Paket-Version wird durch diese Untersuchung nicht verändert.

## Paket, App-ID und Symbol sind unterschiedliche Dinge

| Begriff | Bedeutung im vorhandenen Aufbau |
| --- | --- |
| WGT/Paket-ID | Installations-, Aktualisierungs- und Deinstallationseinheit. Derzeit zwei WGTs mit unterschiedlichen Paket-IDs. |
| App-ID | Startbare Komponente. Schon Starter und eigener Service im selben WGT haben unterschiedliche App-IDs. Cobalt selbst ist eine zusätzliche, vom TV bereitgestellte System-App. |
| Sichtbares Symbol | Eintrag im Smart Hub. Ein Dienst braucht kein Symbol. Die Anzahl sichtbarer Symbole beweist weder die Anzahl WGTs noch die Anzahl App-IDs. |

Ein WGT mit einer sichtbaren Starter-Oberfläche und eigenem TubeService funktioniert
bereits. „Eine App-ID für alles“ ist nicht dasselbe Ziel: Der Service bleibt eine
separat adressierbare Komponente, auch bei einem einzigen sichtbaren Symbol.
Die native Samsung-Engine würde weiterhin unter ihrer System-App-ID laufen.

## Belegte Grenzen des dokumentierten WGT-Modells

Die [Tizen-Konfigurationsreferenz](https://raw.githubusercontent.com/Samsung/tizen-docs/master/docs/application/web/reference/config-xml.md)
fordert genau ein `<tizen:application>`-Element. Sie erlaubt mehrere
`<tizen:service>`-Elemente mit eigenem JavaScript-Einstieg sowie Metadaten unter
einem Service. Das ist keine Definition einer zweiten Web-UI innerhalb desselben
Widgets. Die [Web-Service-Dokumentation](https://raw.githubusercontent.com/Samsung/tizen-docs/master/docs/application/web/guides/applications/service-app.md)
beschreibt entsprechend eine Web-Oberfläche plus mehrere Dienste mit gemeinsamer
Paket-ID und verschiedenen App-IDs; Dienste erscheinen nicht als Menü-Symbole.

Auch der [dokumentierte Hybrid-Paketaufbau](https://raw.githubusercontent.com/Samsung/tizen-docs/master/docs/application/web/guides/development/index.md#hybrid)
kombiniert eine Web-UI mit nativen Diensten. Seine Kombinationstabelle erlaubt
bei einer Web-UI als Hauptprojekt keine weitere UI als Unterprojekt. „Hybrid“
belegt deshalb nicht, dass zwei Web-UI-Pakete einfach in eine WGT gelegt werden
können. Die Cobalt-Engine ist außerdem bereits im TV installiert; ein fremdes
Samsung-Systembinary wird hier nicht neu verpackt.

Versionsgrenze der Recherche: Die genannten gepflegten Referenzdateien beschreiben
das allgemeine Tizen-Modell, keine lokal ausgeführte Tizen-5.0-Installerprüfung.
Ein versionsgenaues Samsung-TV-5.0-Manifest-Schema und der proprietäre Cobalt-
Launcher liegen hier nicht vor. Aus dem dokumentierten Modell folgt eine konkrete
Grenze für den **gewöhnlichen Zwei-Web-UI-Aufbau**, keine bewiesene Aussage über
alle intern möglichen Samsung-Spezialkonstruktionen.

## Antworten für den konkreten Cobalt-Start

| Frage | Befund |
| --- | --- |
| Web-Starter + TubeService in einer WGT? | Ja: genau das macht das aktuelle Starter-Paket, am TV war der explizite Service-Start bereits erfolgreich. |
| Zusätzlich ein zweiter normaler Web-UI-Handoff im selben WGT? | Im dokumentierten Modell nicht vorgesehen. Zwei `<tizen:application>`-Einträge bzw. zwei verschachtelte WGTs erzeugen keine belegte gültige Installation. |
| Native Parameter pro Einstieg zuweisen? | Das bestehende Handoff trägt die drei Samsung-Metadaten im Widget-Manifest. Für zwei frei wählbare UI-Einstiege innerhalb desselben Widgets gibt es hier keinen belegten Zuordnungsmechanismus. |
| Starter startet eine interne Komponente? | Die [Tizen-5.0-Application-API](https://raw.githubusercontent.com/Samsung/tizen-docs/master/docs/application/web/api/5.0/device_api/tv/tizen/application.html) kann registrierte App-IDs starten. Das beweist nicht die Registrierung einer weiteren Cobalt-UI oder deren Parameterübernahme. Der eigene Service ist ein bereits belegter Spezialfall. |
| Web-Seite erhalten und trotzdem Root-`nativeID` setzen? | Das ursprüngliche native Pairing umgeht gerade die Web-Seite. Dieselben Pairing-Metadaten wieder am Starter zu setzen würde dessen Dienstprüfung nicht verlässlich davor schalten. |
| Ein sichtbares Symbol mit mehreren Komponenten? | Für UI + Service ja. Für zusätzlichen Cobalt-Einstieg besteht noch die beschriebene Zuordnungsfrage. Ein verstecktes separates Handoff ist eine andere Architektur mit weiter zwei WGTs. |

Repository-Fundstellen: `app/config.xml:18`–`:20` bindet das native Pairing;
`tools/package-start-poc.js:26`–`:35` prüft alle drei Metadaten und die unveränderten
Legacy-Argumente. `tools/package-start-poc.js:44` entfernt die beiden Pairing-Schlüssel
nur am Web-Starter; ab `:61` entsteht das getrennte Handoff mit eigenen IDs.
`tools/poc/start.js:116` prüft das installierte Ziel und dessen Metadaten zur Laufzeit.
Keine Datei wurde für eine unbewiesene Ein-Paket-Lösung umgeschrieben.

Der [Upstream-Bericht zum Cobalt-Pairing](https://github.com/SushyDev/tizen-youtube/pull/26)
beschreibt die Übernahme der Argumente über `read.metadata.from.hybrid.webapp` und
einen erfolglosen Versuch ohne `nativeID`. Dies ist ein Bericht des Projektautors,
keine offizielle Spezifikation der Samsung-Implementierung auf diesem 2019er TV.
Er erklärt, warum ein bloßes `launch('com.samsung.tv.cobalt-yt')` oder zusätzliche
frei erfundene AppControl-Daten kein gleichwertiger Ersatz für das getestete
Handoff sind. Ein erfolgreicher API-Callback allein würde dafür nicht ausreichen.

## Noch offene, getrennt zu prüfende Ansätze

1. **Direkter nativer AppControl-Start:** Eine WGT mit Starter und TubeService,
   anschließend direkter Aufruf der vorhandenen System-Cobalt-App. Voraussetzung
   wäre ein belegter Weg, genau `--base_url=http://127.0.0.2:8099/tv --dial_name=Tube
   --use_eden` zu übergeben, ohne die Web-Seite vorab umzuleiten. Die öffentliche
   API bietet Operation/URI/MIME/Extra-Daten, aber keine generische Zusicherung,
   dass beliebige Extra-Daten zu Cobalt-Kommandozeilenargumenten werden.
2. **Service als interner Pairing-Alias:** Die Referenz erlaubt Service-Metadaten.
   Daraus folgt noch nicht, dass Samsung `nativeID`, `pkgid` und `native.userdata`
   auf einer Service-App genauso interpretiert wie auf der Web-UI. Unbekannt sind
   der Startpfad, die Parameterübernahme und die Behandlung als Nicht-UI-App.
   Das darf weder mit einem zweiten HTTP-Prozess noch mit erfundenen UI-Attributen
   kaschiert werden. Es ist eine Hypothese, kein ausreichend belegter Ersatz.
3. **Native Verpackung:** Ein allgemeines Multi-App-TPK ist keine einzelne Web-WGT.
   Dass native Frameworks mehrere Komponenten unterstützen, erlaubt nicht
   automatisch eine zweite Samsung-Cobalt-Zuordnung im Web-Installer.

Erst eine dokumentierte Launcher-Schnittstelle oder ein isolierter TV-Nachweis
zur tatsächlichen Parameterübernahme würde einen separaten Ein-Paket-PoC mit
**eigener Paket-ID** rechtfertigen. Vor einer solchen WGT müsste auch geklärt
sein, dass sie nicht den Port 8099 eines weiterlaufenden Rückfall-Services doppelt
belegt. Die beiden funktionierenden Pakete dürfen dabei nicht überschrieben werden.
Eine erfolgreiche lokale ZIP-Erzeugung wäre kein Machbarkeitsnachweis.

## Alternative mit nur einem sichtbaren Startsymbol

Am geringsten greift ein weiterhin separates Handoff ein, dessen Smart-Hub-Eintrag
verborgen wird. Samsung nennt im
[TV-Seller-Office-Handbuch](https://developer.samsung.com/tv-seller-office/guides/applications/registering-application.html)
`nodisplay` als Partner-Funktion; in der TPK-Spalte wird auch `display.hidden`
erwähnt. Das liefert einen konkreten Ansatz, aber noch keine bestätigte Syntax,
Verfügbarkeit oder Freigabe für das Tizen-5.0-WGT auf diesem TV. Ein vorhandenes
Partner-Zertifikat beweist nicht automatisch die Freigabe jeder Partner-Funktion.

Möglicher separater Test: ausschließlich das Handoff in einer eigenen Variante
mit belegter Hidden-/NoDisplay-Konfiguration verbergen; Starter startet es weiterhin
über seine App-ID. **Zwei WGTs, mehrere App-IDs, ein sichtbares Symbol**. Die aktuellen
beiden Diagnose-Icons bleiben bis dahin erhalten. Ohne Nutzung einer unbestätigten
Partner-Erweiterung kann der Benutzer als praktische Zwischenlösung nur Tube Starter
an die Smart-Hub-Startleiste anheften und das Handoff daraus entfernen; das zweite
Paket bleibt in der vollständigen App-Liste sichtbar. Das ist ausdrücklich kein
Nachweis eines einzigen installierten Symbols oder einer einzigen WGT.
