# VO₂max Training

Persönliche Trainings-Web-App für das iPhone. Sie bietet jeden Tag die passende Einheit aus einem 12-Wochen-Plan an (Kraft, Zone 2, Intervalle nach ärztlicher Freigabe) und speichert Gewichte, Zeiten, Puls und die morgendliche Erholungsampel.

- Pausen-Timer zwischen den Sätzen (60, 90 oder 120 s), startet beim Abhaken eines Satzes; am Ende Countdown-Ton 3-2-1, langer Schlusston und 3 Sekunden Blinken.
- Watt, Trittfrequenz und Widerstandsstufe an den Studiogeräten sowie Einbeinstand in Sekunden je Bein, jeweils mit dem letzten Wert zum Vergleich.
- Monatlicher 30-Sekunden-Aufstehtest im Balance-Block am Sonntag; Bulgarian Split Squats je Bein getrennt erfasst (seit 1.7).
- Sonntag auch zuhause: „Zuhause Claude“ (Zone-2-Zirkel mit Band und Hanteln) oder „Zuhause Mark“ (Mark-Lauren-Videos der Reihe nach, dazu Balance, Griff und Stretch), seit 1.8.
- Farben je Bereich (seit 1.9): Aufwärmen gelb, Kraft orange, Ausdauer blau, Intervalle rot, Balance violett, Beweglichkeit pink; jeder Baustein als farbige Kachel, Tage in der Wochenansicht mit Farbstreifen.
- Schneller Satz (⚡) bei jeder Kraftübung wählbar: Gewicht etwa 55 %, 8 Wdh.; zählt nicht für den Fortschrittsvorschlag.
- Rudergerät: Zeit, Strecke und Schläge vom Endbildschirm eintragen – die App rechnet Ø /500 m, Ø-Watt und Ø-Schlagzahl aus; eigener Hinweis zu Schlagzahl und Watt für Zone 2.
- Kopfschmerz-Protokoll mit Schmerzmitteln, Nackenverspannung, Schlafposition, automatisch ergänztem Training am Vortag, Monatsübersicht und Bericht für den Arzt.
- Funktioniert nach dem ersten Laden komplett offline (Service Worker).
- Alle Einträge bleiben im Speicher des Geräts; Export als JSON (Backup) und CSV (Excel) über das Teilen-Menü.
- Installation: Seite in Safari öffnen → Teilen → „Zum Home-Bildschirm“.

Bei Änderungen an den Dateien in `sw.js` die Konstante `CACHE` hochzählen.
