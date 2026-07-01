# ShotgunBlackbox Moto Dashboard

Expo SDK 54 Dashboard fuer echte Live-Daten am Bike. Die App zeigt Map, Route, Speed, Lean/Pitch, Hoehenmeter, Wetter, editierbare Widgets und Diagramme pro Statistik.

## Features

1. Live Ride Dashboard:
   - GPS Route mit `react-native-maps`
   - Speed aus `coords.speed`, Fallback per GPS-Distanz/Zeit
   - Lean und Pitch aus `DeviceMotion` mit geglaetteten, kalibrierbaren Winkeln
   - Distanz, Top Speed, GPS Qualitaet, Heading und Ride Time
2. Hoehenmeter:
   - aktuelle GPS-Hoehe
   - Aufstieg und Abstieg aus Hoehendifferenzen
   - gespeicherte Start- und Endwerte pro beendetem Ride
3. Menue:
   - Darkmode: System, Hell, Dunkel
   - Widget Layout: 3 Spalten, 2 Spalten, Gross
   - Widgets ein-/ausblenden und sortieren
   - Kalibrier-Button fuer fest montiertes Handy am Bike
   - Wetter Refresh
4. Diagramme:
   - Verlaeufe fuer Speed, Lean, Pitch, Distanz, Hoehe, Hoehenmeter, Heading, GPS Genauigkeit, Temperatur und Wind
   - Diagramm-Reiter zeigt Live-Daten oder den zuletzt beendeten Ride
5. Wetter:
   - Open-Meteo API ohne API Key
   - Temperatur, gefuehlte Temperatur, Wind, Boeen und Wetterzustand
6. Persistenz:
   - Darkmode, Layout, Widget-Reihenfolge, versteckte Widgets, Kalibrierung und letzter Ride werden mit AsyncStorage gespeichert

## Expo SDK 54 Doku

Vor den Code-Aenderungen wurden die versionierten Expo-v54-Dokumente geprueft:

- `https://docs.expo.dev/versions/v54.0.0/`
- `https://docs.expo.dev/versions/v54.0.0/sdk/devicemotion/`
- `https://docs.expo.dev/versions/v54.0.0/sdk/location/`
- `https://docs.expo.dev/versions/v54.0.0/sdk/accelerometer/`
- `https://docs.expo.dev/versions/v54.0.0/sdk/gyroscope/`
- `https://docs.expo.dev/versions/v54.0.0/sdk/barometer/`
- `https://docs.expo.dev/versions/v54.0.0/sdk/async-storage/`

## Testen

```bash
npm start
```

Oder direkt mit dem aktuell gestarteten Metro-Server:

```text
http://localhost:8083
```

Auf dem iPhone mit Expo Go scannen, Standort- und Motion-Permissions erlauben und nach dem Einschnallen des Handys `Sensoren kalibrieren` druecken.

## Validierung

```bash
npx tsc --noEmit
```
