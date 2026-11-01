# VO₂max Training

Persönliche Trainings-Web-App für das iPhone. Sie bietet jeden Tag die passende Einheit aus einem 12-Wochen-Plan an (Kraft, Zone 2, Intervalle nach ärztlicher Freigabe) und speichert Gewichte, Zeiten, Puls und die morgendliche Erholungsampel.

- Pausen-Timer zwischen den Sätzen (60, 90 oder 120 s), startet beim Abhaken eines Satzes.
- Watt und Trittfrequenz an den Studiogeräten sowie Einbeinstand in Sekunden je Bein, jeweils mit dem letzten Wert zum Vergleich.
- Kopfschmerz-Protokoll mit Schmerzmitteln, Monatsübersicht und Bericht für den Arzt.
- Funktioniert nach dem ersten Laden komplett offline (Service Worker).
- Alle Einträge bleiben im Speicher des Geräts; Export als JSON (Backup) und CSV (Excel) über das Teilen-Menü.
- Installation: Seite in Safari öffnen → Teilen → „Zum Home-Bildschirm“.

Bei Änderungen an den Dateien in `sw.js` die Konstante `CACHE` hochzählen.
