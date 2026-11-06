# VO₂max Training

Persönliche Trainings-Web-App für das iPhone. Sie bietet jeden Tag die passende Einheit aus einem 12-Wochen-Plan an (Kraft, Zone 2, Intervalle nach ärztlicher Freigabe) und speichert Gewichte, Zeiten, Puls und die morgendliche Erholungsampel.

- Pausen-Timer zwischen den Sätzen (60, 90 oder 120 s), startet beim Abhaken eines Satzes; am Ende Countdown-Ton 3-2-1, langer Schlusston und 3 Sekunden Blinken.
- Watt, Trittfrequenz und Widerstandsstufe an den Studiogeräten sowie Einbeinstand in Sekunden je Bein, jeweils mit dem letzten Wert zum Vergleich.
- Rudergerät: Zeit, Strecke und Schläge vom Endbildschirm eintragen – die App rechnet Ø /500 m, Ø-Watt und Ø-Schlagzahl aus; eigener Hinweis zu Schlagzahl und Watt für Zone 2.
- Kopfschmerz-Protokoll mit Schmerzmitteln, Nackenverspannung, Schlafposition, automatisch ergänztem Training am Vortag, Monatsübersicht und Bericht für den Arzt.
- Funktioniert nach dem ersten Laden komplett offline (Service Worker).
- Alle Einträge bleiben im Speicher des Geräts; Export als JSON (Backup) und CSV (Excel) über das Teilen-Menü.
- Installation: Seite in Safari öffnen → Teilen → „Zum Home-Bildschirm“.

Bei Änderungen an den Dateien in `sw.js` die Konstante `CACHE` hochzählen.
