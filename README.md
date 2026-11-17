# PSL-Prototyp (Browser)

Parallelslalom auf der echten Piste, Steuerung durch Kippen des Handys. Zweck: klären, ob sich die
Steuerung gut anfühlt. Keine Konten, kein Server, kein Mehrspieler.

Geodaten: Bayerische Vermessungsverwaltung, geodaten.bayern.de, CC BY 4.0 (steht auch im Spiel unten links).
Kurs = Planungsstand, Fahrphysik nicht kalibriert.

## Starten am Rechner
    python3 -m http.server 8765 --directory game      # dann http://localhost:8765
Pfeiltasten (oder WASD): links/rechts = Kante, hoch/runter = Gewicht vorn/hinten. Leertaste = Start,
V = Ansicht (Verfolger/Ego), R = Neustart. Ohne Tastatur: Finger oder Maus auf dem Bild ziehen.
Direkt als Datei geöffnet (file://) lädt die Seite nicht, der Browser braucht http(s).

## Auf dem iPhone (Safari)
1. Seite über **https** öffnen (GitHub Pages). Ohne https gibt iOS keine Sensordaten.
2. Handy quer drehen, „Start“ antippen, die Frage „Zugriff auf Bewegung und Ausrichtung“ mit **Erlauben** beantworten.
   Abgelehnt? Safari: „aA“ bzw. Seitenmenü → Website-Einstellungen, oder Tab schließen und Seite neu öffnen.
3. Während des Countdowns das Handy ruhig in der Grundstellung halten: am Ende wird die Nullstellung genommen.
4. Links/rechts kippen (wie ein Lenkrad) lenkt, Oberkante weg vom Körper = Gewicht nach vorn.
5. Unten links steht die gemessene Sensor-Rate (Hz) und die Winkel gegen die Nullstellung.
6. ⚙: Lenk- und Gewichtsbereich in Grad (kleiner = empfindlicher), Lenkung/Gewicht umkehren, Bestzeit löschen.

## Regeln im Spiel
Am Stubby außen vorbei (Seite ohne lange Stange). Torfehler, Verlassen der Piste (oranges Netz = Korridor aus
den Kursdaten) oder Ziel verfehlt = sofort ausgeschieden, keine Zeit.
Der beste gültige Lauf fährt beim nächsten Lauf als Geist mit (auf seiner Spur; mit „Spur“ fährt man daneben).
Gewicht vorn: mehr Grip, etwas langsamer. Gewicht hinten: schneller, weniger Grip. Zu viel Kante rutscht und bremst.

## Dateien
- `physics.js` Fahrphysik: feste Schritte (120 Hz), nur aus den zwei Eingaben, keine Uhr. Alle Stellwerte in `P`.
- `input.js` Sensor, Tastatur, Finger -> zwei Werte.
- `main.js` Darstellung (three.js vom CDN), Ablauf, Aufzeichnung, Geist.
- `autopilot.js`, `selftest.mjs` Selbsttest ohne Browser: `node game/selftest.mjs`
- `tracks/<site>_<variante>.json` aus `python3 tools/export_game.py <site> <variante>`; im Spiel mit `?track=<site>_<variante>`.
