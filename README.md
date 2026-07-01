# ShotgunBlackbox Moto Dashboard

Diese App ist ein Expo SDK 54 Test-Dashboard fuer echte Live-Daten vom iPhone. Sie zeigt eine echte Map, zeichnet die GPS-Route auf und berechnet Motorrad-nahe Telemetrie wie Lean Angle, Speed, Distanz, Heading und Ride Time.

## Umgesetzte Schritte

1. Expo SDK 54 Doku geprueft:
   - `https://docs.expo.dev/versions/v54.0.0/sdk/devicemotion/`
   - `https://docs.expo.dev/versions/v54.0.0/sdk/location/`
   - `https://docs.expo.dev/versions/v54.0.0/sdk/map-view/`
2. SDK-passende Pakete installiert:
   - `expo-sensors` fuer `DeviceMotion`
   - `expo-location` fuer GPS, Speed, Position und Heading
   - `react-native-maps` fuer die echte Live-Map in Expo Go
3. `app.json` erweitert:
   - `expo-location` Permission-Text fuer Standortzugriff
   - `expo-sensors` Permission-Text fuer Motion-Zugriff
4. `App.tsx` von Platzhalterdaten auf Live-Daten umgebaut:
   - keine ScrollView mehr, fixiertes Dashboard-Layout
   - echte Map statt Fake-Map
   - `watchPositionAsync` fuer fortlaufende GPS-Updates
   - `watchHeadingAsync` fuer Kompass-Heading
   - `DeviceMotion.addListener` fuer iPhone Motion-Daten
   - Live-Route als `Polyline`
   - Live-Marker an der aktuellen Position
5. Berechnungen eingebaut:
   - Speed direkt aus GPS `coords.speed`
   - Speed-Fallback aus GPS-Distanz pro Zeit
   - Distanz per Haversine-Formel
   - Lean Angle aus `DeviceMotion.rotation.gamma`
   - Lean-Fallback aus Beschleunigung inklusive Gravitation
   - Max Lean, Last Corner Lean, Top Speed und Ride Time
6. Controls eingebaut:
   - `Calibrate lean` setzt die aktuelle iPhone-Montageposition als 0 Grad
   - `Reset ride` setzt Route, Distanz, Max-Werte und Timer zurueck
7. Validierung:
   - `npx tsc --noEmit`

## Live-Daten

Die App verwendet keine festen Fahrwerte mehr. Wenn GPS oder Motion noch nicht verfuegbar sind, zeigt die UI `--` oder den aktuellen Stream-Status. Reale Werte erscheinen erst nach iPhone-Permissions und Sensorupdates.

## Testen auf dem iPhone

1. Expo starten:
   ```bash
   npm start
   ```
2. QR-Code mit Expo Go auf dem iPhone 13 scannen.
3. Standort- und Motion-Permissions erlauben.
4. Vor dem Fahren `Calibrate lean` druecken, wenn das iPhone fest montiert ist.

## Hinweise

- `coords.speed` ist der bevorzugte Speed-Wert, weil er direkt vom GPS kommt.
- Wenn `coords.speed` kurz nicht geliefert wird, berechnet die App Speed aus der Distanz zwischen zwei GPS-Punkten und der Zeitdifferenz.
- Hintergrundtracking ist nicht aktiv. Die App misst live, solange sie im Vordergrund laeuft.
- Fuer App-Store-Builds sind die Permission-Texte bereits in `app.json` vorbereitet.
