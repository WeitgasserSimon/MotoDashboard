import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
  useColorScheme,
} from 'react-native';
import * as Location from 'expo-location';
import { DeviceMotion, type DeviceMotionMeasurement } from 'expo-sensors';
import { StatusBar } from 'expo-status-bar';
import MapView, { Marker, Polyline, type LatLng, type Region } from 'react-native-maps';

type StreamState = 'starting' | 'live' | 'denied' | 'unavailable' | 'error';
type ActivePanel = 'ride' | 'charts' | 'menu';
type ThemeMode = 'system' | 'light' | 'dark';
type WidgetLayout = 'compact' | 'balanced' | 'large';
type WeatherStatus = 'idle' | 'loading' | 'live' | 'error';

type WidgetKey =
  | 'lean'
  | 'pitch'
  | 'speed'
  | 'distance'
  | 'altitude'
  | 'elevationGain'
  | 'topSpeed'
  | 'heading'
  | 'gps'
  | 'weather'
  | 'wind'
  | 'duration'
  | 'lastCorner';

type SensorCalibration = {
  lean: number;
  pitch: number;
  heading: number | null;
  altitude: number | null;
  createdAt: number | null;
};

type WeatherState = {
  status: WeatherStatus;
  temperatureC: number | null;
  apparentC: number | null;
  windKmh: number | null;
  gustKmh: number | null;
  precipitationMm: number | null;
  code: number | null;
  description: string;
  updatedAt: number | null;
  error: string | null;
};

type RideSample = {
  timestamp: number;
  elapsedSeconds: number;
  leanDeg: number | null;
  pitchDeg: number | null;
  speedKmh: number | null;
  distanceKm: number;
  altitudeMeters: number | null;
  elevationGainMeters: number;
  headingDeg: number | null;
  temperatureC: number | null;
  windKmh: number | null;
  gpsAccuracyMeters: number | null;
};

type RideSnapshot = {
  timestamp: number;
  coordinate: LatLng | null;
  speedKmh: number | null;
  leanDeg: number | null;
  pitchDeg: number | null;
  headingDeg: number | null;
  altitudeMeters: number | null;
  distanceKm: number;
  elevationGainMeters: number;
  weather: {
    temperatureC: number | null;
    windKmh: number | null;
    description: string;
  } | null;
};

type CompletedRide = {
  id: string;
  startedAt: number;
  endedAt: number;
  durationMs: number;
  distanceMeters: number;
  topSpeedKmh: number;
  maxLean: number;
  maxPitch: number;
  lastCornerLean: number | null;
  elevationGainMeters: number;
  elevationLossMeters: number;
  start: RideSnapshot | null;
  end: RideSnapshot | null;
  samples: RideSample[];
};

type WidgetConfig = {
  key: WidgetKey;
  label: string;
  value: string;
  detail: string;
  tone: string;
};

type Palette = {
  background: string;
  mapWaiting: string;
  sheet: string;
  card: string;
  mutedCard: string;
  text: string;
  mutedText: string;
  subtleText: string;
  border: string;
  handle: string;
  primary: string;
  primarySoft: string;
  accent: string;
  danger: string;
  recordingBg: string;
  recordingText: string;
  liveBadgeBg: string;
  liveBadgeText: string;
  setupBadgeBg: string;
  setupBadgeText: string;
  chartTrack: string;
};

const MAX_LEAN_DEGREES = 60;
const ROUTE_POINT_LIMIT = 600;
const MIN_ROUTE_DISTANCE_METERS = 1;
const MIN_ELEVATION_DELTA_METERS = 1.2;
const RIDE_SAMPLE_LIMIT = 360;
const CHART_SAMPLE_LIMIT = 80;
const WEATHER_REFRESH_MS = 10 * 60 * 1000;
const DASHBOARD_STORAGE_KEY = 'shotgunblackbox.dashboard.v2';

const DEFAULT_CALIBRATION: SensorCalibration = {
  lean: 0,
  pitch: 0,
  heading: null,
  altitude: null,
  createdAt: null,
};

const DEFAULT_WEATHER: WeatherState = {
  status: 'idle',
  temperatureC: null,
  apparentC: null,
  windKmh: null,
  gustKmh: null,
  precipitationMm: null,
  code: null,
  description: 'Wetter',
  updatedAt: null,
  error: null,
};

const DEFAULT_WIDGET_ORDER: WidgetKey[] = [
  'lean',
  'speed',
  'distance',
  'altitude',
  'elevationGain',
  'topSpeed',
  'pitch',
  'heading',
  'gps',
  'weather',
  'wind',
  'duration',
  'lastCorner',
];

const LIGHT_PALETTE: Palette = {
  background: '#dbe7df',
  mapWaiting: '#dbe7df',
  sheet: '#f8fafc',
  card: '#ffffff',
  mutedCard: '#eef2f7',
  text: '#0f172a',
  mutedText: '#475569',
  subtleText: '#64748b',
  border: '#dbe3ef',
  handle: '#cbd5e1',
  primary: '#2563eb',
  primarySoft: '#dbeafe',
  accent: '#f97316',
  danger: '#b91c1c',
  recordingBg: '#111827',
  recordingText: '#f8fafc',
  liveBadgeBg: '#dcfce7',
  liveBadgeText: '#166534',
  setupBadgeBg: '#e2e8f0',
  setupBadgeText: '#475569',
  chartTrack: '#e2e8f0',
};

const DARK_PALETTE: Palette = {
  background: '#12151b',
  mapWaiting: '#171b22',
  sheet: '#151922',
  card: '#202632',
  mutedCard: '#242b38',
  text: '#f8fafc',
  mutedText: '#cbd5e1',
  subtleText: '#94a3b8',
  border: '#334155',
  handle: '#475569',
  primary: '#60a5fa',
  primarySoft: '#172554',
  accent: '#fb923c',
  danger: '#fca5a5',
  recordingBg: '#f8fafc',
  recordingText: '#111827',
  liveBadgeBg: '#064e3b',
  liveBadgeText: '#bbf7d0',
  setupBadgeBg: '#334155',
  setupBadgeText: '#cbd5e1',
  chartTrack: '#2f3745',
};

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function degrees(radians: number) {
  return radians * (180 / Math.PI);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function formatDuration(milliseconds: number) {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }

  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function formatMaybeNumber(value: number | null, suffix: string, decimals = 0) {
  if (value === null || !Number.isFinite(value)) {
    return '--';
  }

  return `${value.toFixed(decimals)} ${suffix}`;
}

function formatSignedMaybeNumber(value: number | null, suffix: string, decimals = 0) {
  if (value === null || !Number.isFinite(value)) {
    return '--';
  }

  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(decimals)} ${suffix}`;
}

function metersToKilometers(meters: number) {
  return meters / 1000;
}

function metersPerSecondToKilometersPerHour(metersPerSecond: number) {
  return metersPerSecond * 3.6;
}

function getCoordinate(location: Location.LocationObject): LatLng {
  return {
    latitude: location.coords.latitude,
    longitude: location.coords.longitude,
  };
}

function getDistanceMeters(from: LatLng, to: LatLng) {
  const earthRadiusMeters = 6371000;
  const latitudeDelta = ((to.latitude - from.latitude) * Math.PI) / 180;
  const longitudeDelta = ((to.longitude - from.longitude) * Math.PI) / 180;
  const fromLatitude = (from.latitude * Math.PI) / 180;
  const toLatitude = (to.latitude * Math.PI) / 180;

  const a =
    Math.sin(latitudeDelta / 2) * Math.sin(latitudeDelta / 2) +
    Math.cos(fromLatitude) *
      Math.cos(toLatitude) *
      Math.sin(longitudeDelta / 2) *
      Math.sin(longitudeDelta / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return earthRadiusMeters * c;
}

function getRawMotionAngles(motion: DeviceMotionMeasurement | null) {
  if (!motion) {
    return { lean: null, pitch: null };
  }

  const gravity = motion.accelerationIncludingGravity;

  if (gravity && isFiniteNumber(gravity.x) && isFiniteNumber(gravity.y) && isFiniteNumber(gravity.z)) {
    let lateralGravity = gravity.x;
    let forwardGravity = gravity.y;
    const verticalGravity = gravity.z;

    if (motion.orientation === 90) {
      lateralGravity = -gravity.y;
      forwardGravity = gravity.x;
    } else if (motion.orientation === -90) {
      lateralGravity = gravity.y;
      forwardGravity = -gravity.x;
    } else if (motion.orientation === 180) {
      lateralGravity = -gravity.x;
      forwardGravity = -gravity.y;
    }

    const leanRadians = Math.atan2(
      lateralGravity,
      Math.sqrt(forwardGravity * forwardGravity + verticalGravity * verticalGravity),
    );
    const pitchRadians = Math.atan2(
      -forwardGravity,
      Math.sqrt(lateralGravity * lateralGravity + verticalGravity * verticalGravity),
    );

    return {
      lean: clamp(degrees(leanRadians), -89, 89),
      pitch: clamp(degrees(pitchRadians), -89, 89),
    };
  }

  return {
    lean: isFiniteNumber(motion.rotation?.gamma) ? clamp(motion.rotation.gamma, -89, 89) : null,
    pitch: isFiniteNumber(motion.rotation?.beta) ? clamp(motion.rotation.beta, -89, 89) : null,
  };
}

function getGpsQuality(accuracy: number | null) {
  if (accuracy === null) {
    return 'GPS';
  }

  if (accuracy <= 8) {
    return 'Precise';
  }

  if (accuracy <= 25) {
    return 'Good';
  }

  return 'Weak';
}

function getWeatherDescription(code: number | null) {
  if (code === null) {
    return 'Wetter';
  }

  if (code === 0) {
    return 'Klar';
  }

  if ([1, 2, 3].includes(code)) {
    return 'Wolkig';
  }

  if ([45, 48].includes(code)) {
    return 'Nebel';
  }

  if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) {
    return 'Regen';
  }

  if (code >= 71 && code <= 77) {
    return 'Schnee';
  }

  if (code >= 95) {
    return 'Gewitter';
  }

  return 'Wetter';
}

function normalizeWidgetOrder(value: unknown) {
  if (!Array.isArray(value)) {
    return DEFAULT_WIDGET_ORDER;
  }

  const knownKeys = new Set(DEFAULT_WIDGET_ORDER);
  const restored = value.filter((item): item is WidgetKey => knownKeys.has(item));

  return [...new Set([...restored, ...DEFAULT_WIDGET_ORDER])];
}

function normalizeHiddenWidgets(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  const knownKeys = new Set(DEFAULT_WIDGET_ORDER);
  return value.filter((item): item is WidgetKey => knownKeys.has(item));
}

function isThemeMode(value: unknown): value is ThemeMode {
  return value === 'system' || value === 'light' || value === 'dark';
}

function isWidgetLayout(value: unknown): value is WidgetLayout {
  return value === 'compact' || value === 'balanced' || value === 'large';
}

function safeDateTime(timestamp: number | null) {
  if (!timestamp) {
    return '--';
  }

  return new Date(timestamp).toLocaleString();
}

function createEmptySnapshot(): RideSnapshot {
  return {
    timestamp: Date.now(),
    coordinate: null,
    speedKmh: null,
    leanDeg: null,
    pitchDeg: null,
    headingDeg: null,
    altitudeMeters: null,
    distanceKm: 0,
    elevationGainMeters: 0,
    weather: null,
  };
}

function SegmentButton({
  active,
  label,
  onPress,
  palette,
}: {
  active: boolean;
  label: string;
  onPress: () => void;
  palette: Palette;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.segmentButton,
        {
          backgroundColor: active ? palette.primary : palette.mutedCard,
          borderColor: active ? palette.primary : palette.border,
          opacity: pressed ? 0.82 : 1,
        },
      ]}
    >
      <Text selectable style={[styles.segmentButtonText, { color: active ? '#ffffff' : palette.text }]}>
        {label}
      </Text>
    </Pressable>
  );
}

function WidgetCard({
  item,
  palette,
  width,
  valueSize,
}: {
  item: WidgetConfig;
  palette: Palette;
  width: `${number}%`;
  valueSize: number;
}) {
  return (
    <View style={[styles.widgetCard, { width, backgroundColor: palette.card, borderColor: palette.border }]}>
      <View style={[styles.widgetIndicator, { backgroundColor: item.tone }]} />
      <Text selectable style={[styles.widgetLabel, { color: palette.subtleText }]}>
        {item.label}
      </Text>
      <Text selectable numberOfLines={1} adjustsFontSizeToFit style={[styles.widgetValue, { color: palette.text, fontSize: valueSize }]}>
        {item.value}
      </Text>
      <Text selectable numberOfLines={2} style={[styles.widgetDetail, { color: palette.subtleText }]}>
        {item.detail}
      </Text>
    </View>
  );
}

function ChartCard({
  label,
  values,
  suffix,
  tone,
  palette,
}: {
  label: string;
  values: Array<number | null>;
  suffix: string;
  tone: string;
  palette: Palette;
}) {
  const visibleValues = values.slice(-CHART_SAMPLE_LIMIT);
  const numericValues = visibleValues.filter(isFiniteNumber);
  const min = numericValues.length > 0 ? Math.min(...numericValues) : 0;
  const max = numericValues.length > 0 ? Math.max(...numericValues) : 1;
  const latest = numericValues.at(-1) ?? null;
  const range = Math.max(max - min, 1);

  return (
    <View style={[styles.chartCard, { backgroundColor: palette.card, borderColor: palette.border }]}>
      <View style={styles.chartHeader}>
        <View>
          <Text selectable style={[styles.chartTitle, { color: palette.text }]}>
            {label}
          </Text>
          <Text selectable style={[styles.chartSubtitle, { color: palette.subtleText }]}>
            {formatMaybeNumber(latest, suffix, suffix === 'km' ? 2 : 0)}
          </Text>
        </View>
        <Text selectable style={[styles.chartRange, { color: palette.subtleText }]}>
          {numericValues.length} pts
        </Text>
      </View>
      <View style={[styles.chartTrack, { backgroundColor: palette.chartTrack }]}>
        {visibleValues.map((value, index) => {
          const normalizedValue = isFiniteNumber(value) ? (value - min) / range : 0;
          const height = 8 + clamp(normalizedValue, 0, 1) * 58;

          return (
            <View
              key={`${label}-${index}`}
              style={[
                styles.chartBar,
                {
                  height,
                  backgroundColor: tone,
                  opacity: isFiniteNumber(value) ? 0.95 : 0.18,
                },
              ]}
            />
          );
        })}
      </View>
      <View style={styles.chartFooter}>
        <Text selectable style={[styles.chartRange, { color: palette.subtleText }]}>
          Min {formatMaybeNumber(numericValues.length ? min : null, suffix, suffix === 'km' ? 2 : 0)}
        </Text>
        <Text selectable style={[styles.chartRange, { color: palette.subtleText }]}>
          Max {formatMaybeNumber(numericValues.length ? max : null, suffix, suffix === 'km' ? 2 : 0)}
        </Text>
      </View>
    </View>
  );
}

function SettingSection({
  title,
  children,
  palette,
}: {
  title: string;
  children: React.ReactNode;
  palette: Palette;
}) {
  return (
    <View style={styles.settingSection}>
      <Text selectable style={[styles.settingTitle, { color: palette.text }]}>
        {title}
      </Text>
      {children}
    </View>
  );
}

export default function App() {
  const systemColorScheme = useColorScheme();
  const [locationStatus, setLocationStatus] = useState<StreamState>('starting');
  const [motionStatus, setMotionStatus] = useState<StreamState>('starting');
  const [locationError, setLocationError] = useState<string | null>(null);
  const [motionError, setMotionError] = useState<string | null>(null);
  const [location, setLocation] = useState<Location.LocationObject | null>(null);
  const [heading, setHeading] = useState<Location.LocationHeadingObject | null>(null);
  const [motion, setMotion] = useState<DeviceMotionMeasurement | null>(null);
  const [route, setRoute] = useState<LatLng[]>([]);
  const [rideStartedAt, setRideStartedAt] = useState(() => Date.now());
  const [now, setNow] = useState(() => Date.now());
  const [distanceMeters, setDistanceMeters] = useState(0);
  const [calculatedSpeedMps, setCalculatedSpeedMps] = useState<number | null>(null);
  const [topSpeedKmh, setTopSpeedKmh] = useState(0);
  const [maxLean, setMaxLean] = useState(0);
  const [maxPitch, setMaxPitch] = useState(0);
  const [lastCornerLean, setLastCornerLean] = useState<number | null>(null);
  const [elevationGainMeters, setElevationGainMeters] = useState(0);
  const [elevationLossMeters, setElevationLossMeters] = useState(0);
  const [smoothedAngles, setSmoothedAngles] = useState<{ lean: number | null; pitch: number | null }>({
    lean: null,
    pitch: null,
  });
  const [calibration, setCalibration] = useState<SensorCalibration>(DEFAULT_CALIBRATION);
  const [activePanel, setActivePanel] = useState<ActivePanel>('ride');
  const [themeMode, setThemeMode] = useState<ThemeMode>('system');
  const [widgetLayout, setWidgetLayout] = useState<WidgetLayout>('balanced');
  const [widgetOrder, setWidgetOrder] = useState<WidgetKey[]>(DEFAULT_WIDGET_ORDER);
  const [hiddenWidgets, setHiddenWidgets] = useState<WidgetKey[]>([]);
  const [rideActive, setRideActive] = useState(true);
  const [rideSamples, setRideSamples] = useState<RideSample[]>([]);
  const [rideStartSnapshot, setRideStartSnapshot] = useState<RideSnapshot | null>(null);
  const [lastCompletedRide, setLastCompletedRide] = useState<CompletedRide | null>(null);
  const [weather, setWeather] = useState<WeatherState>(DEFAULT_WEATHER);
  const [weatherRefreshNonce, setWeatherRefreshNonce] = useState(0);
  const [storageLoaded, setStorageLoaded] = useState(false);

  const lastLocationRef = useRef<Location.LocationObject | null>(null);
  const lastSampleAtRef = useRef(0);
  const lastWeatherFetchRef = useRef<{ key: string; timestamp: number } | null>(null);

  const isDark = themeMode === 'system' ? systemColorScheme === 'dark' : themeMode === 'dark';
  const palette = isDark ? DARK_PALETTE : LIGHT_PALETTE;

  const currentCoordinate = location ? getCoordinate(location) : null;
  const gpsSpeedMps =
    location?.coords.speed !== null && location?.coords.speed !== undefined && location.coords.speed >= 0
      ? location.coords.speed
      : null;
  const activeSpeedMps = gpsSpeedMps ?? calculatedSpeedMps;
  const speedKmh = activeSpeedMps === null ? null : metersPerSecondToKilometersPerHour(activeSpeedMps);
  const speedSource = gpsSpeedMps !== null ? 'GPS speed' : calculatedSpeedMps !== null ? 'GPS delta' : 'Waiting';
  const altitudeMeters = location?.coords.altitude ?? null;
  const calibratedAltitudeMeters =
    altitudeMeters === null || calibration.altitude === null ? altitudeMeters : altitudeMeters - calibration.altitude;
  const gpsAccuracy = location?.coords.accuracy ?? null;
  const gpsAgeSeconds = location ? Math.max(0, Math.round((now - location.timestamp) / 1000)) : null;
  const rideTime = formatDuration(rideActive ? now - rideStartedAt : (lastCompletedRide?.durationMs ?? now - rideStartedAt));
  const rawAngles = useMemo(() => getRawMotionAngles(motion), [motion]);
  const leanAngle =
    smoothedAngles.lean === null ? null : clamp(smoothedAngles.lean - calibration.lean, -89, 89);
  const pitchAngle =
    smoothedAngles.pitch === null ? null : clamp(smoothedAngles.pitch - calibration.pitch, -89, 89);
  const absLeanAngle = leanAngle === null ? null : Math.abs(leanAngle);
  const absPitchAngle = pitchAngle === null ? null : Math.abs(pitchAngle);
  const headingDegrees =
    location?.coords.heading !== null && location?.coords.heading !== undefined && location.coords.heading >= 0
      ? location.coords.heading
      : heading?.trueHeading !== undefined && heading.trueHeading >= 0
        ? heading.trueHeading
        : heading?.magHeading ?? null;
  const relativeHeadingDegrees =
    headingDegrees === null || calibration.heading === null
      ? headingDegrees
      : (headingDegrees - calibration.heading + 360) % 360;
  const mapRegion: Region | undefined = currentCoordinate
    ? {
        ...currentCoordinate,
        latitudeDelta: 0.006,
        longitudeDelta: 0.006,
      }
    : undefined;
  const leanPercent = absLeanAngle === null ? 0 : clamp(absLeanAngle / MAX_LEAN_DEGREES, 0, 1) * 50;
  const leanFillWidth = `${leanPercent}%` as `${number}%`;
  const leanNeedleLeft = `${50 + clamp((leanAngle ?? 0) / MAX_LEAN_DEGREES, -1, 1) * 50}%` as `${number}%`;
  const isLeaningRight = (leanAngle ?? 0) >= 0;
  const liveStatus = locationStatus === 'live' && motionStatus === 'live' ? 'Live' : 'Setup';
  const sheetHeight = activePanel === 'ride' ? 454 : '72%';
  const mapPaddingBottom = activePanel === 'ride' ? 470 : 610;
  const weatherCoordinateKey = currentCoordinate
    ? `${currentCoordinate.latitude.toFixed(2)},${currentCoordinate.longitude.toFixed(2)}`
    : null;

  const buildSnapshot = useCallback(
    (timestamp = Date.now()): RideSnapshot => ({
      timestamp,
      coordinate: currentCoordinate,
      speedKmh,
      leanDeg: absLeanAngle,
      pitchDeg: absPitchAngle,
      headingDeg: relativeHeadingDegrees,
      altitudeMeters,
      distanceKm: metersToKilometers(distanceMeters),
      elevationGainMeters,
      weather:
        weather.status === 'live'
          ? {
              temperatureC: weather.temperatureC,
              windKmh: weather.windKmh,
              description: weather.description,
            }
          : null,
    }),
    [
      absLeanAngle,
      absPitchAngle,
      altitudeMeters,
      currentCoordinate,
      distanceMeters,
      elevationGainMeters,
      relativeHeadingDegrees,
      speedKmh,
      weather.description,
      weather.status,
      weather.temperatureC,
      weather.windKmh,
    ],
  );

  const applyLocationUpdate = useCallback(
    (nextLocation: Location.LocationObject) => {
      const nextCoordinate = getCoordinate(nextLocation);
      const previousLocation = lastLocationRef.current;
      let measuredSpeedMps: number | null = null;

      setLocation(nextLocation);

      if (!rideActive) {
        lastLocationRef.current = nextLocation;
        return;
      }

      if (previousLocation) {
        const previousCoordinate = getCoordinate(previousLocation);
        const segmentDistance = getDistanceMeters(previousCoordinate, nextCoordinate);
        const segmentSeconds = Math.max((nextLocation.timestamp - previousLocation.timestamp) / 1000, 0);

        if (segmentDistance >= MIN_ROUTE_DISTANCE_METERS) {
          setDistanceMeters((currentDistance) => currentDistance + segmentDistance);
        }

        if (segmentSeconds > 0 && segmentDistance >= MIN_ROUTE_DISTANCE_METERS) {
          measuredSpeedMps = segmentDistance / segmentSeconds;
          setCalculatedSpeedMps(measuredSpeedMps);
        }

        const previousAltitude = previousLocation.coords.altitude;
        const nextAltitude = nextLocation.coords.altitude;

        if (isFiniteNumber(previousAltitude) && isFiniteNumber(nextAltitude)) {
          const altitudeDelta = nextAltitude - previousAltitude;

          if (Math.abs(altitudeDelta) >= MIN_ELEVATION_DELTA_METERS) {
            if (altitudeDelta > 0) {
              setElevationGainMeters((currentGain) => currentGain + altitudeDelta);
            } else {
              setElevationLossMeters((currentLoss) => currentLoss + Math.abs(altitudeDelta));
            }
          }
        }
      }

      const nextGpsSpeedMps =
        nextLocation.coords.speed !== null && nextLocation.coords.speed >= 0 ? nextLocation.coords.speed : null;
      const nextActiveSpeedMps = nextGpsSpeedMps ?? measuredSpeedMps;

      if (nextActiveSpeedMps !== null && Number.isFinite(nextActiveSpeedMps)) {
        setTopSpeedKmh((currentTopSpeed) =>
          Math.max(currentTopSpeed, metersPerSecondToKilometersPerHour(nextActiveSpeedMps)),
        );
      }

      setRoute((currentRoute) => {
        const lastCoordinate = currentRoute.at(-1);

        if (lastCoordinate && getDistanceMeters(lastCoordinate, nextCoordinate) < MIN_ROUTE_DISTANCE_METERS) {
          return currentRoute;
        }

        return [...currentRoute, nextCoordinate].slice(-ROUTE_POINT_LIMIT);
      });

      lastLocationRef.current = nextLocation;
    },
    [rideActive],
  );

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);

    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    async function restoreDashboard() {
      try {
        const rawState = await AsyncStorage.getItem(DASHBOARD_STORAGE_KEY);

        if (!rawState) {
          return;
        }

        const parsedState = JSON.parse(rawState) as {
          themeMode?: unknown;
          widgetLayout?: unknown;
          widgetOrder?: unknown;
          hiddenWidgets?: unknown;
          calibration?: Partial<SensorCalibration>;
          lastCompletedRide?: CompletedRide | null;
        };

        if (isThemeMode(parsedState.themeMode)) {
          setThemeMode(parsedState.themeMode);
        }

        if (isWidgetLayout(parsedState.widgetLayout)) {
          setWidgetLayout(parsedState.widgetLayout);
        }

        setWidgetOrder(normalizeWidgetOrder(parsedState.widgetOrder));
        setHiddenWidgets(normalizeHiddenWidgets(parsedState.hiddenWidgets));

        if (parsedState.calibration) {
          setCalibration({
            lean: isFiniteNumber(parsedState.calibration.lean) ? parsedState.calibration.lean : 0,
            pitch: isFiniteNumber(parsedState.calibration.pitch) ? parsedState.calibration.pitch : 0,
            heading: isFiniteNumber(parsedState.calibration.heading) ? parsedState.calibration.heading : null,
            altitude: isFiniteNumber(parsedState.calibration.altitude) ? parsedState.calibration.altitude : null,
            createdAt: isFiniteNumber(parsedState.calibration.createdAt) ? parsedState.calibration.createdAt : null,
          });
        }

        if (parsedState.lastCompletedRide) {
          setLastCompletedRide(parsedState.lastCompletedRide);
        }
      } catch (error) {
        console.warn('Could not restore dashboard settings', error);
      } finally {
        setStorageLoaded(true);
      }
    }

    restoreDashboard();
  }, []);

  useEffect(() => {
    if (!storageLoaded) {
      return;
    }

    const nextState = {
      themeMode,
      widgetLayout,
      widgetOrder,
      hiddenWidgets,
      calibration,
      lastCompletedRide,
    };

    AsyncStorage.setItem(DASHBOARD_STORAGE_KEY, JSON.stringify(nextState)).catch((error) => {
      console.warn('Could not persist dashboard settings', error);
    });
  }, [calibration, hiddenWidgets, lastCompletedRide, storageLoaded, themeMode, widgetLayout, widgetOrder]);

  useEffect(() => {
    if (rawAngles.lean === null && rawAngles.pitch === null) {
      return;
    }

    setSmoothedAngles((currentAngles) => ({
      lean:
        rawAngles.lean === null
          ? currentAngles.lean
          : currentAngles.lean === null
            ? rawAngles.lean
            : currentAngles.lean * 0.72 + rawAngles.lean * 0.28,
      pitch:
        rawAngles.pitch === null
          ? currentAngles.pitch
          : currentAngles.pitch === null
            ? rawAngles.pitch
            : currentAngles.pitch * 0.72 + rawAngles.pitch * 0.28,
    }));
  }, [rawAngles.lean, rawAngles.pitch]);

  useEffect(() => {
    let locationSubscription: Location.LocationSubscription | null = null;
    let headingSubscription: Location.LocationSubscription | null = null;
    let isMounted = true;

    async function startLocation() {
      try {
        setLocationStatus('starting');
        setLocationError(null);

        const servicesEnabled = await Location.hasServicesEnabledAsync();

        if (!servicesEnabled) {
          if (isMounted) {
            setLocationStatus('unavailable');
            setLocationError('Location services are disabled on this iPhone.');
          }
          return;
        }

        const permission = await Location.requestForegroundPermissionsAsync();

        if (!isMounted) {
          return;
        }

        if (permission.status !== 'granted') {
          setLocationStatus('denied');
          setLocationError('Location permission was denied.');
          return;
        }

        const lastKnownLocation = await Location.getLastKnownPositionAsync({
          maxAge: 10000,
          requiredAccuracy: 80,
        });

        if (isMounted && lastKnownLocation) {
          applyLocationUpdate(lastKnownLocation);
        }

        headingSubscription = await Location.watchHeadingAsync(
          (nextHeading) => {
            if (isMounted) {
              setHeading(nextHeading);
            }
          },
          (reason) => {
            if (isMounted) {
              setLocationError(reason);
            }
          },
        );

        locationSubscription = await Location.watchPositionAsync(
          {
            accuracy: Location.Accuracy.BestForNavigation,
            distanceInterval: 1,
            timeInterval: 1000,
          },
          (nextLocation) => {
            if (isMounted) {
              applyLocationUpdate(nextLocation);
              setLocationStatus('live');
            }
          },
          (reason) => {
            if (isMounted) {
              setLocationStatus('error');
              setLocationError(reason);
            }
          },
        );

        if (isMounted) {
          setLocationStatus('live');
        }
      } catch (error) {
        if (isMounted) {
          setLocationStatus('error');
          setLocationError(error instanceof Error ? error.message : 'Location stream failed.');
        }
      }
    }

    startLocation();

    return () => {
      isMounted = false;
      locationSubscription?.remove();
      headingSubscription?.remove();
    };
  }, [applyLocationUpdate]);

  useEffect(() => {
    let motionSubscription: { remove: () => void } | null = null;
    let isMounted = true;

    async function startMotion() {
      try {
        setMotionStatus('starting');
        setMotionError(null);

        const available = await DeviceMotion.isAvailableAsync();

        if (!available) {
          if (isMounted) {
            setMotionStatus('unavailable');
            setMotionError('Device motion is not available on this device.');
          }
          return;
        }

        const permission = await DeviceMotion.requestPermissionsAsync();

        if (!isMounted) {
          return;
        }

        if (permission.status !== 'granted') {
          setMotionStatus('denied');
          setMotionError('Motion permission was denied.');
          return;
        }

        DeviceMotion.setUpdateInterval(100);
        motionSubscription = DeviceMotion.addListener((nextMotion) => {
          if (isMounted) {
            setMotion(nextMotion);
            setMotionStatus('live');
          }
        });
      } catch (error) {
        if (isMounted) {
          setMotionStatus('error');
          setMotionError(error instanceof Error ? error.message : 'Motion stream failed.');
        }
      }
    }

    startMotion();

    return () => {
      isMounted = false;
      motionSubscription?.remove();
    };
  }, []);

  useEffect(() => {
    if (!weatherCoordinateKey || !currentCoordinate) {
      return;
    }

    const lastFetch = lastWeatherFetchRef.current;

    if (lastFetch?.key === weatherCoordinateKey && Date.now() - lastFetch.timestamp < WEATHER_REFRESH_MS) {
      return;
    }

    const controller = new AbortController();
    const weatherKey = weatherCoordinateKey;
    const weatherCoordinate = currentCoordinate;

    async function loadWeather() {
      try {
        lastWeatherFetchRef.current = {
          key: weatherKey,
          timestamp: Date.now(),
        };
        setWeather((currentWeather) => ({ ...currentWeather, status: 'loading', error: null }));

        const url = new URL('https://api.open-meteo.com/v1/forecast');
        url.searchParams.set('latitude', String(weatherCoordinate.latitude));
        url.searchParams.set('longitude', String(weatherCoordinate.longitude));
        url.searchParams.set(
          'current',
          'temperature_2m,apparent_temperature,precipitation,rain,weather_code,wind_speed_10m,wind_gusts_10m',
        );
        url.searchParams.set('wind_speed_unit', 'kmh');
        url.searchParams.set('timezone', 'auto');

        const response = await fetch(url.toString(), { signal: controller.signal });

        if (!response.ok) {
          throw new Error(`Weather API HTTP ${response.status}`);
        }

        const payload = (await response.json()) as {
          current?: {
            temperature_2m?: number;
            apparent_temperature?: number;
            precipitation?: number;
            rain?: number;
            weather_code?: number;
            wind_speed_10m?: number;
            wind_gusts_10m?: number;
          };
        };
        const currentWeather = payload.current ?? {};
        const weatherCode = isFiniteNumber(currentWeather.weather_code) ? currentWeather.weather_code : null;

        setWeather({
          status: 'live',
          temperatureC: isFiniteNumber(currentWeather.temperature_2m) ? currentWeather.temperature_2m : null,
          apparentC: isFiniteNumber(currentWeather.apparent_temperature) ? currentWeather.apparent_temperature : null,
          windKmh: isFiniteNumber(currentWeather.wind_speed_10m) ? currentWeather.wind_speed_10m : null,
          gustKmh: isFiniteNumber(currentWeather.wind_gusts_10m) ? currentWeather.wind_gusts_10m : null,
          precipitationMm: isFiniteNumber(currentWeather.precipitation)
            ? currentWeather.precipitation
            : isFiniteNumber(currentWeather.rain)
              ? currentWeather.rain
              : null,
          code: weatherCode,
          description: getWeatherDescription(weatherCode),
          updatedAt: Date.now(),
          error: null,
        });
      } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') {
          return;
        }

        setWeather((currentWeather) => ({
          ...currentWeather,
          status: 'error',
          error: error instanceof Error ? error.message : 'Weather API failed.',
        }));
      }
    }

    loadWeather();

    return () => controller.abort();
  }, [currentCoordinate, weatherCoordinateKey, weatherRefreshNonce]);

  useEffect(() => {
    if (absLeanAngle === null) {
      return;
    }

    setMaxLean((currentMaxLean) => Math.max(currentMaxLean, absLeanAngle));

    if (absLeanAngle >= 20) {
      setLastCornerLean(absLeanAngle);
    }
  }, [absLeanAngle]);

  useEffect(() => {
    if (absPitchAngle === null) {
      return;
    }

    setMaxPitch((currentMaxPitch) => Math.max(currentMaxPitch, absPitchAngle));
  }, [absPitchAngle]);

  useEffect(() => {
    if (!rideActive || rideStartSnapshot !== null) {
      return;
    }

    if (currentCoordinate || absLeanAngle !== null || speedKmh !== null) {
      setRideStartSnapshot(buildSnapshot(rideStartedAt));
    }
  }, [absLeanAngle, buildSnapshot, currentCoordinate, rideActive, rideStartSnapshot, rideStartedAt, speedKmh]);

  useEffect(() => {
    if (!rideActive) {
      return;
    }

    if (now - lastSampleAtRef.current < 1000) {
      return;
    }

    if (!currentCoordinate && speedKmh === null && absLeanAngle === null && altitudeMeters === null) {
      return;
    }

    lastSampleAtRef.current = now;

    const nextSample: RideSample = {
      timestamp: now,
      elapsedSeconds: Math.max(0, Math.round((now - rideStartedAt) / 1000)),
      leanDeg: absLeanAngle,
      pitchDeg: absPitchAngle,
      speedKmh,
      distanceKm: metersToKilometers(distanceMeters),
      altitudeMeters,
      elevationGainMeters,
      headingDeg: relativeHeadingDegrees,
      temperatureC: weather.temperatureC,
      windKmh: weather.windKmh,
      gpsAccuracyMeters: gpsAccuracy,
    };

    setRideSamples((currentSamples) => [...currentSamples, nextSample].slice(-RIDE_SAMPLE_LIMIT));
  }, [
    absLeanAngle,
    absPitchAngle,
    altitudeMeters,
    currentCoordinate,
    distanceMeters,
    elevationGainMeters,
    gpsAccuracy,
    now,
    relativeHeadingDegrees,
    rideActive,
    rideStartedAt,
    speedKmh,
    weather.temperatureC,
    weather.windKmh,
  ]);

  const calibrateSensors = useCallback(() => {
    setCalibration({
      lean: smoothedAngles.lean ?? 0,
      pitch: smoothedAngles.pitch ?? 0,
      heading: headingDegrees,
      altitude: altitudeMeters,
      createdAt: Date.now(),
    });
    setMaxLean(0);
    setMaxPitch(0);
    setLastCornerLean(null);
  }, [altitudeMeters, headingDegrees, smoothedAngles.lean, smoothedAngles.pitch]);

  const resetRide = useCallback(() => {
    const startedAt = Date.now();
    setDistanceMeters(0);
    setCalculatedSpeedMps(null);
    setTopSpeedKmh(0);
    setMaxLean(0);
    setMaxPitch(0);
    setLastCornerLean(null);
    setElevationGainMeters(0);
    setElevationLossMeters(0);
    setRideStartedAt(startedAt);
    setRideActive(true);
    setRideSamples([]);
    setRideStartSnapshot(buildSnapshot(startedAt));
    setRoute(currentCoordinate ? [currentCoordinate] : []);
    lastLocationRef.current = location;
    lastSampleAtRef.current = 0;
  }, [buildSnapshot, currentCoordinate, location]);

  const finishRide = useCallback(() => {
    const endedAt = Date.now();
    const summary: CompletedRide = {
      id: String(endedAt),
      startedAt: rideStartedAt,
      endedAt,
      durationMs: endedAt - rideStartedAt,
      distanceMeters,
      topSpeedKmh,
      maxLean,
      maxPitch,
      lastCornerLean,
      elevationGainMeters,
      elevationLossMeters,
      start: rideStartSnapshot ?? createEmptySnapshot(),
      end: buildSnapshot(endedAt),
      samples: rideSamples,
    };

    setLastCompletedRide(summary);
    setRideActive(false);
    setActivePanel('charts');
  }, [
    buildSnapshot,
    distanceMeters,
    elevationGainMeters,
    elevationLossMeters,
    lastCornerLean,
    maxLean,
    maxPitch,
    rideSamples,
    rideStartSnapshot,
    rideStartedAt,
    topSpeedKmh,
  ]);

  const toggleWidgetVisible = useCallback(
    (key: WidgetKey) => {
      setHiddenWidgets((currentHiddenWidgets) => {
        const isHidden = currentHiddenWidgets.includes(key);
        const visibleCount = DEFAULT_WIDGET_ORDER.length - currentHiddenWidgets.length;

        if (!isHidden && visibleCount <= 1) {
          return currentHiddenWidgets;
        }

        return isHidden
          ? currentHiddenWidgets.filter((hiddenWidget) => hiddenWidget !== key)
          : [...currentHiddenWidgets, key];
      });
    },
    [],
  );

  const moveWidget = useCallback((key: WidgetKey, direction: -1 | 1) => {
    setWidgetOrder((currentOrder) => {
      const nextOrder = normalizeWidgetOrder(currentOrder);
      const index = nextOrder.indexOf(key);
      const targetIndex = index + direction;

      if (index < 0 || targetIndex < 0 || targetIndex >= nextOrder.length) {
        return nextOrder;
      }

      const swappedOrder = [...nextOrder];
      const targetWidget = swappedOrder[targetIndex];
      swappedOrder[targetIndex] = key;
      swappedOrder[index] = targetWidget;

      return swappedOrder;
    });
  }, []);

  const refreshWeather = useCallback(() => {
    lastWeatherFetchRef.current = null;
    setWeatherRefreshNonce((currentNonce) => currentNonce + 1);
  }, []);

  const widgetWidth = widgetLayout === 'compact' ? '31.6%' : widgetLayout === 'balanced' ? '48.3%' : '100%';
  const widgetValueSize = widgetLayout === 'compact' ? 15 : widgetLayout === 'balanced' ? 18 : 23;
  const widgetConfigs = useMemo<WidgetConfig[]>(
    () => [
      {
        key: 'lean',
        label: 'Lean',
        value: formatMaybeNumber(absLeanAngle, 'deg', 1),
        detail: leanAngle === null ? 'Waiting' : leanAngle < -1 ? 'Left' : leanAngle > 1 ? 'Right' : 'Centered',
        tone: '#f97316',
      },
      {
        key: 'pitch',
        label: 'Pitch',
        value: formatSignedMaybeNumber(pitchAngle, 'deg', 1),
        detail: absPitchAngle === null ? 'Waiting' : `Max ${formatMaybeNumber(maxPitch, 'deg', 1)}`,
        tone: '#a855f7',
      },
      {
        key: 'speed',
        label: 'Speed',
        value: formatMaybeNumber(speedKmh, 'km/h'),
        detail: speedSource,
        tone: '#2563eb',
      },
      {
        key: 'distance',
        label: 'Distance',
        value: `${metersToKilometers(distanceMeters).toFixed(2)} km`,
        detail: rideActive ? 'Current ride' : 'Ride stopped',
        tone: '#0891b2',
      },
      {
        key: 'altitude',
        label: 'Altitude',
        value: formatMaybeNumber(altitudeMeters, 'm'),
        detail:
          calibration.altitude === null
            ? 'GPS altitude'
            : `Rel ${formatSignedMaybeNumber(calibratedAltitudeMeters, 'm')}`,
        tone: '#65a30d',
      },
      {
        key: 'elevationGain',
        label: 'Hoehenmeter',
        value: formatMaybeNumber(elevationGainMeters, 'm'),
        detail: `Down ${formatMaybeNumber(elevationLossMeters, 'm')}`,
        tone: '#16a34a',
      },
      {
        key: 'topSpeed',
        label: 'Top speed',
        value: `${topSpeedKmh.toFixed(0)} km/h`,
        detail: 'Ride max',
        tone: '#0ea5e9',
      },
      {
        key: 'heading',
        label: 'Heading',
        value: formatMaybeNumber(relativeHeadingDegrees, 'deg'),
        detail: calibration.heading === null ? 'Compass' : 'Calibrated',
        tone: '#64748b',
      },
      {
        key: 'gps',
        label: 'GPS',
        value: location ? getGpsQuality(gpsAccuracy) : '--',
        detail: gpsAccuracy === null ? 'Waiting' : `${Math.round(gpsAccuracy)} m | ${gpsAgeSeconds ?? '--'} s`,
        tone: '#22c55e',
      },
      {
        key: 'weather',
        label: 'Weather',
        value: formatMaybeNumber(weather.temperatureC, 'C'),
        detail:
          weather.status === 'loading'
            ? 'Loading'
            : weather.status === 'error'
              ? 'API error'
              : `${weather.description} | feels ${formatMaybeNumber(weather.apparentC, 'C')}`,
        tone: '#eab308',
      },
      {
        key: 'wind',
        label: 'Wind',
        value: formatMaybeNumber(weather.windKmh, 'km/h'),
        detail: `Gust ${formatMaybeNumber(weather.gustKmh, 'km/h')}`,
        tone: '#38bdf8',
      },
      {
        key: 'duration',
        label: 'Ride time',
        value: rideTime,
        detail: rideActive ? 'Recording' : 'Finished',
        tone: '#ef4444',
      },
      {
        key: 'lastCorner',
        label: 'Last corner',
        value: formatMaybeNumber(lastCornerLean, 'deg', 1),
        detail: `Max ${formatMaybeNumber(maxLean, 'deg', 1)}`,
        tone: '#f43f5e',
      },
    ],
    [
      absLeanAngle,
      absPitchAngle,
      altitudeMeters,
      calibratedAltitudeMeters,
      calibration.altitude,
      calibration.heading,
      distanceMeters,
      elevationGainMeters,
      elevationLossMeters,
      gpsAccuracy,
      gpsAgeSeconds,
      lastCornerLean,
      leanAngle,
      location,
      maxLean,
      maxPitch,
      pitchAngle,
      relativeHeadingDegrees,
      rideActive,
      rideTime,
      speedKmh,
      speedSource,
      topSpeedKmh,
      weather.apparentC,
      weather.description,
      weather.gustKmh,
      weather.status,
      weather.temperatureC,
      weather.windKmh,
    ],
  );
  const widgetConfigByKey = useMemo(
    () => new Map(widgetConfigs.map((widgetConfig) => [widgetConfig.key, widgetConfig])),
    [widgetConfigs],
  );
  const orderedWidgets = useMemo(
    () =>
      normalizeWidgetOrder(widgetOrder)
        .filter((key) => !hiddenWidgets.includes(key))
        .map((key) => widgetConfigByKey.get(key))
        .filter((item): item is WidgetConfig => Boolean(item)),
    [hiddenWidgets, widgetConfigByKey, widgetOrder],
  );
  const chartSamples =
    rideActive || !lastCompletedRide ? rideSamples : lastCompletedRide.samples.length ? lastCompletedRide.samples : rideSamples;
  const chartDefinitions = useMemo(
    () => [
      {
        label: 'Speed',
        values: chartSamples.map((sample) => sample.speedKmh),
        suffix: 'km/h',
        tone: '#2563eb',
      },
      {
        label: 'Lean',
        values: chartSamples.map((sample) => sample.leanDeg),
        suffix: 'deg',
        tone: '#f97316',
      },
      {
        label: 'Pitch',
        values: chartSamples.map((sample) => sample.pitchDeg),
        suffix: 'deg',
        tone: '#a855f7',
      },
      {
        label: 'Distance',
        values: chartSamples.map((sample) => sample.distanceKm),
        suffix: 'km',
        tone: '#0891b2',
      },
      {
        label: 'Altitude',
        values: chartSamples.map((sample) => sample.altitudeMeters),
        suffix: 'm',
        tone: '#65a30d',
      },
      {
        label: 'Hoehenmeter',
        values: chartSamples.map((sample) => sample.elevationGainMeters),
        suffix: 'm',
        tone: '#16a34a',
      },
      {
        label: 'Heading',
        values: chartSamples.map((sample) => sample.headingDeg),
        suffix: 'deg',
        tone: '#64748b',
      },
      {
        label: 'GPS accuracy',
        values: chartSamples.map((sample) => sample.gpsAccuracyMeters),
        suffix: 'm',
        tone: '#22c55e',
      },
      {
        label: 'Temperature',
        values: chartSamples.map((sample) => sample.temperatureC),
        suffix: 'C',
        tone: '#eab308',
      },
      {
        label: 'Wind',
        values: chartSamples.map((sample) => sample.windKmh),
        suffix: 'km/h',
        tone: '#38bdf8',
      },
    ],
    [chartSamples],
  );

  const rideStats = [
    { label: 'Start altitude', value: formatMaybeNumber(rideStartSnapshot?.altitudeMeters ?? null, 'm') },
    { label: 'Current altitude', value: formatMaybeNumber(altitudeMeters, 'm') },
    { label: 'Ascent', value: formatMaybeNumber(elevationGainMeters, 'm') },
    { label: 'Descent', value: formatMaybeNumber(elevationLossMeters, 'm') },
    { label: 'Max lean', value: formatMaybeNumber(maxLean, 'deg', 1) },
    { label: 'Max pitch', value: formatMaybeNumber(maxPitch, 'deg', 1) },
  ];

  return (
    <View style={[styles.screen, { backgroundColor: palette.background }]}>
      <StatusBar style={isDark ? 'light' : 'dark'} />

      <View style={styles.mapLayer}>
        {currentCoordinate && mapRegion ? (
          <MapView
            style={StyleSheet.absoluteFillObject}
            region={mapRegion}
            mapPadding={{ bottom: mapPaddingBottom, left: 12, right: 12, top: 116 }}
            showsCompass
            showsMyLocationButton
            showsScale
            showsTraffic
            showsUserLocation
            userInterfaceStyle={isDark ? 'dark' : 'light'}
          >
            {route.length > 1 ? (
              <Polyline coordinates={route} strokeColor={palette.primary} strokeWidth={6} />
            ) : null}
            <Marker
              coordinate={currentCoordinate}
              rotation={relativeHeadingDegrees ?? 0}
              title="Live position"
              tracksViewChanges={false}
            >
              <View style={styles.markerOuter}>
                <View style={[styles.markerNeedle, { borderBottomColor: palette.primary }]} />
                <View style={[styles.markerCore, { backgroundColor: palette.primary }]} />
              </View>
            </Marker>
          </MapView>
        ) : (
          <View style={[styles.waitingMap, { backgroundColor: palette.mapWaiting }]}>
            <ActivityIndicator color={palette.primary} />
            <Text selectable style={[styles.waitingTitle, { color: palette.text }]}>
              Waiting for real GPS
            </Text>
            <Text selectable style={[styles.waitingSubtitle, { color: palette.mutedText }]}>
              {locationError ?? 'Accept location permission on the iPhone.'}
            </Text>
          </View>
        )}
      </View>

      <View style={[styles.topBar, { backgroundColor: palette.card, borderColor: palette.border }]}>
        <View style={styles.topTitleBlock}>
          <Text selectable style={[styles.appTitle, { color: palette.text }]}>
            Moto Dashboard
          </Text>
          <Text selectable numberOfLines={1} style={[styles.appSubtitle, { color: palette.subtleText }]}>
            {currentCoordinate
              ? `${currentCoordinate.latitude.toFixed(5)}, ${currentCoordinate.longitude.toFixed(5)}`
              : locationError ?? 'GPS stream starting'}
          </Text>
        </View>
        <View style={[styles.statusBadge, liveStatus === 'Live' ? { backgroundColor: palette.liveBadgeBg } : { backgroundColor: palette.setupBadgeBg }]}>
          <Text selectable style={[styles.statusBadgeText, { color: liveStatus === 'Live' ? palette.liveBadgeText : palette.setupBadgeText }]}>
            {liveStatus}
          </Text>
        </View>
      </View>

      <View style={[styles.recordingPill, { backgroundColor: palette.recordingBg }]}>
        <View style={[styles.recordingDot, { opacity: rideActive ? 1 : 0.35 }]} />
        <Text selectable style={[styles.recordingText, { color: palette.recordingText }]}>
          {rideActive ? 'REC' : 'DONE'} {rideTime}
        </Text>
      </View>

      <View style={[styles.bottomSheet, { height: sheetHeight, backgroundColor: palette.sheet }]}>
        <View style={[styles.sheetHandle, { backgroundColor: palette.handle }]} />

        <View style={styles.panelTabs}>
          <SegmentButton active={activePanel === 'ride'} label="Ride" onPress={() => setActivePanel('ride')} palette={palette} />
          <SegmentButton active={activePanel === 'charts'} label="Diagramme" onPress={() => setActivePanel('charts')} palette={palette} />
          <SegmentButton active={activePanel === 'menu'} label="Menue" onPress={() => setActivePanel('menu')} palette={palette} />
        </View>

        {activePanel === 'ride' ? (
          <ScrollView contentContainerStyle={styles.sheetScrollContent} showsVerticalScrollIndicator={false}>
            <View style={styles.sheetHeader}>
              <View>
                <Text selectable style={[styles.sheetTitle, { color: palette.text }]}>
                  Live Ride
                </Text>
                <Text selectable style={[styles.sheetSubtitle, { color: palette.subtleText }]}>
                  GPS {locationStatus} | Motion {motionStatus} | Weather {weather.status}
                </Text>
              </View>
              <Text selectable style={[styles.gpsAge, { color: palette.subtleText }]}>
                {gpsAgeSeconds === null ? '-- s' : `${gpsAgeSeconds} s`}
              </Text>
            </View>

            <View style={styles.leanMeter}>
              <View style={[styles.leanTrack, { backgroundColor: palette.chartTrack }]}>
                <View style={[styles.leanCenterLine, { backgroundColor: palette.handle }]} />
                <View
                  style={[
                    styles.leanFill,
                    { backgroundColor: isDark ? '#7c2d12' : '#fed7aa' },
                    isLeaningRight ? { left: '50%', width: leanFillWidth } : { right: '50%', width: leanFillWidth },
                  ]}
                />
                <View style={[styles.leanNeedle, { left: leanNeedleLeft, backgroundColor: palette.accent }]} />
              </View>
              <View style={styles.leanLabels}>
                <Text selectable style={[styles.leanLabel, { color: palette.subtleText }]}>
                  L 60
                </Text>
                <Text selectable style={[styles.leanValue, { color: palette.text }]}>
                  {formatSignedMaybeNumber(leanAngle, 'deg', 1)}
                </Text>
                <Text selectable style={[styles.leanLabel, { color: palette.subtleText }]}>
                  R 60
                </Text>
              </View>
            </View>

            <View style={styles.widgetGrid}>
              {orderedWidgets.map((item) => (
                <WidgetCard
                  key={item.key}
                  item={item}
                  palette={palette}
                  valueSize={widgetValueSize}
                  width={widgetWidth as `${number}%`}
                />
              ))}
            </View>

            <View style={styles.statsGrid}>
              {rideStats.map((item) => (
                <View key={item.label} style={[styles.rideStat, { backgroundColor: palette.mutedCard }]}>
                  <Text selectable style={[styles.rideStatLabel, { color: palette.subtleText }]}>
                    {item.label}
                  </Text>
                  <Text selectable style={[styles.rideStatValue, { color: palette.text }]}>
                    {item.value}
                  </Text>
                </View>
              ))}
            </View>

            <View style={styles.actionRow}>
              <Pressable
                accessibilityRole="button"
                disabled={smoothedAngles.lean === null && smoothedAngles.pitch === null && altitudeMeters === null}
                onPress={calibrateSensors}
                style={({ pressed }) => [
                  styles.actionButton,
                  { backgroundColor: palette.primary },
                  smoothedAngles.lean === null && smoothedAngles.pitch === null && altitudeMeters === null
                    ? styles.disabledActionButton
                    : null,
                  pressed ? styles.pressedActionButton : null,
                ]}
              >
                <Text selectable style={styles.actionButtonText}>
                  Sensoren kalibrieren
                </Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                onPress={rideActive ? finishRide : resetRide}
                style={({ pressed }) => [
                  styles.secondaryButton,
                  { backgroundColor: rideActive ? palette.mutedCard : palette.primarySoft, borderColor: palette.border },
                  pressed ? styles.pressedActionButton : null,
                ]}
              >
                <Text selectable style={[styles.secondaryButtonText, { color: palette.text }]}>
                  {rideActive ? 'Ride beenden' : 'Neuer Ride'}
                </Text>
              </Pressable>
            </View>

            <Pressable
              accessibilityRole="button"
              onPress={resetRide}
              style={({ pressed }) => [
                styles.fullWidthButton,
                { backgroundColor: palette.mutedCard, borderColor: palette.border },
                pressed ? styles.pressedActionButton : null,
              ]}
            >
              <Text selectable style={[styles.secondaryButtonText, { color: palette.text }]}>
                Aktuellen Ride zuruecksetzen
              </Text>
            </Pressable>

            {locationError || motionError || weather.error ? (
              <Text selectable style={[styles.errorText, { color: palette.danger }]}>
                {locationError ?? motionError ?? weather.error}
              </Text>
            ) : null}
          </ScrollView>
        ) : null}

        {activePanel === 'charts' ? (
          <ScrollView contentContainerStyle={styles.sheetScrollContent} showsVerticalScrollIndicator={false}>
            <View style={styles.sheetHeader}>
              <View>
                <Text selectable style={[styles.sheetTitle, { color: palette.text }]}>
                  Diagramme
                </Text>
                <Text selectable style={[styles.sheetSubtitle, { color: palette.subtleText }]}>
                  {rideActive ? 'Live Ride' : 'Letzter beendeter Ride'} | {chartSamples.length} Samples
                </Text>
              </View>
              <Text selectable style={[styles.gpsAge, { color: palette.subtleText }]}>
                {lastCompletedRide && !rideActive ? formatDuration(lastCompletedRide.durationMs) : rideTime}
              </Text>
            </View>

            {chartSamples.length === 0 ? (
              <View style={[styles.emptyState, { backgroundColor: palette.card, borderColor: palette.border }]}>
                <Text selectable style={[styles.emptyStateTitle, { color: palette.text }]}>
                  Noch keine Diagrammdaten
                </Text>
                <Text selectable style={[styles.emptyStateText, { color: palette.subtleText }]}>
                  Sobald GPS oder Motion Daten ankommen, werden hier alle Statistiken als Verlauf gezeigt.
                </Text>
              </View>
            ) : (
              chartDefinitions.map((chart) => (
                <ChartCard
                  key={chart.label}
                  label={chart.label}
                  palette={palette}
                  suffix={chart.suffix}
                  tone={chart.tone}
                  values={chart.values}
                />
              ))
            )}

            {lastCompletedRide ? (
              <View style={[styles.summaryCard, { backgroundColor: palette.card, borderColor: palette.border }]}>
                <Text selectable style={[styles.summaryTitle, { color: palette.text }]}>
                  Start / Ende gespeichert
                </Text>
                <View style={styles.summaryGrid}>
                  <View style={styles.summaryItem}>
                    <Text selectable style={[styles.summaryLabel, { color: palette.subtleText }]}>
                      Start
                    </Text>
                    <Text selectable style={[styles.summaryValue, { color: palette.text }]}>
                      {safeDateTime(lastCompletedRide.start?.timestamp ?? null)}
                    </Text>
                    <Text selectable style={[styles.summaryDetail, { color: palette.subtleText }]}>
                      {formatMaybeNumber(lastCompletedRide.start?.altitudeMeters ?? null, 'm')} |{' '}
                      {formatMaybeNumber(lastCompletedRide.start?.speedKmh ?? null, 'km/h')}
                    </Text>
                  </View>
                  <View style={styles.summaryItem}>
                    <Text selectable style={[styles.summaryLabel, { color: palette.subtleText }]}>
                      Ende
                    </Text>
                    <Text selectable style={[styles.summaryValue, { color: palette.text }]}>
                      {safeDateTime(lastCompletedRide.end?.timestamp ?? null)}
                    </Text>
                    <Text selectable style={[styles.summaryDetail, { color: palette.subtleText }]}>
                      {formatMaybeNumber(lastCompletedRide.end?.altitudeMeters ?? null, 'm')} |{' '}
                      {formatMaybeNumber(lastCompletedRide.end?.speedKmh ?? null, 'km/h')}
                    </Text>
                  </View>
                </View>
              </View>
            ) : null}
          </ScrollView>
        ) : null}

        {activePanel === 'menu' ? (
          <ScrollView contentContainerStyle={styles.sheetScrollContent} showsVerticalScrollIndicator={false}>
            <View style={styles.sheetHeader}>
              <View>
                <Text selectable style={[styles.sheetTitle, { color: palette.text }]}>
                  Menue
                </Text>
                <Text selectable style={[styles.sheetSubtitle, { color: palette.subtleText }]}>
                  Theme, Layout, Wetter und Widgets
                </Text>
              </View>
            </View>

            <SettingSection title="Darkmode" palette={palette}>
              <View style={styles.segmentRow}>
                <SegmentButton active={themeMode === 'system'} label="System" onPress={() => setThemeMode('system')} palette={palette} />
                <SegmentButton active={themeMode === 'light'} label="Hell" onPress={() => setThemeMode('light')} palette={palette} />
                <SegmentButton active={themeMode === 'dark'} label="Dunkel" onPress={() => setThemeMode('dark')} palette={palette} />
              </View>
            </SettingSection>

            <SettingSection title="Widget Layout" palette={palette}>
              <View style={styles.segmentRow}>
                <SegmentButton active={widgetLayout === 'compact'} label="3 Spalten" onPress={() => setWidgetLayout('compact')} palette={palette} />
                <SegmentButton active={widgetLayout === 'balanced'} label="2 Spalten" onPress={() => setWidgetLayout('balanced')} palette={palette} />
                <SegmentButton active={widgetLayout === 'large'} label="Gross" onPress={() => setWidgetLayout('large')} palette={palette} />
              </View>
            </SettingSection>

            <SettingSection title="Sensoren" palette={palette}>
              <View style={[styles.menuCard, { backgroundColor: palette.card, borderColor: palette.border }]}>
                <View style={styles.menuCardText}>
                  <Text selectable style={[styles.menuCardTitle, { color: palette.text }]}>
                    Fix montiert kalibrieren
                  </Text>
                  <Text selectable style={[styles.menuCardSubtitle, { color: palette.subtleText }]}>
                    Lean, Pitch, Heading und Hoehe werden als Nullpunkt gespeichert.
                  </Text>
                </View>
                <Pressable
                  accessibilityRole="button"
                  onPress={calibrateSensors}
                  style={({ pressed }) => [
                    styles.smallButton,
                    { backgroundColor: palette.primary },
                    pressed ? styles.pressedActionButton : null,
                  ]}
                >
                  <Text selectable style={styles.smallButtonText}>
                    Kalibrieren
                  </Text>
                </Pressable>
              </View>
              <Text selectable style={[styles.calibrationText, { color: palette.subtleText }]}>
                Letzte Kalibrierung: {safeDateTime(calibration.createdAt)}
              </Text>
            </SettingSection>

            <SettingSection title="Wetter API" palette={palette}>
              <View style={[styles.menuCard, { backgroundColor: palette.card, borderColor: palette.border }]}>
                <View style={styles.menuCardText}>
                  <Text selectable style={[styles.menuCardTitle, { color: palette.text }]}>
                    Open-Meteo
                  </Text>
                  <Text selectable style={[styles.menuCardSubtitle, { color: palette.subtleText }]}>
                    {weather.status === 'live'
                      ? `${weather.description} | ${formatMaybeNumber(weather.temperatureC, 'C')} | ${formatMaybeNumber(weather.windKmh, 'km/h')}`
                      : weather.status}
                  </Text>
                </View>
                <Pressable
                  accessibilityRole="button"
                  onPress={refreshWeather}
                  style={({ pressed }) => [
                    styles.smallButton,
                    { backgroundColor: palette.primary },
                    pressed ? styles.pressedActionButton : null,
                  ]}
                >
                  <Text selectable style={styles.smallButtonText}>
                    Refresh
                  </Text>
                </Pressable>
              </View>
            </SettingSection>

            <SettingSection title="Widgets bearbeiten" palette={palette}>
              {normalizeWidgetOrder(widgetOrder).map((key) => {
                const widgetConfig = widgetConfigByKey.get(key);
                const visible = !hiddenWidgets.includes(key);

                if (!widgetConfig) {
                  return null;
                }

                return (
                  <View key={key} style={[styles.widgetEditorRow, { backgroundColor: palette.card, borderColor: palette.border }]}>
                    <View style={[styles.widgetEditorTone, { backgroundColor: widgetConfig.tone }]} />
                    <View style={styles.widgetEditorText}>
                      <Text selectable style={[styles.widgetEditorTitle, { color: palette.text }]}>
                        {widgetConfig.label}
                      </Text>
                      <Text selectable style={[styles.widgetEditorSubtitle, { color: palette.subtleText }]}>
                        {widgetConfig.value}
                      </Text>
                    </View>
                    <View style={styles.widgetEditorActions}>
                      <Pressable
                        accessibilityRole="button"
                        onPress={() => moveWidget(key, -1)}
                        style={({ pressed }) => [
                          styles.orderButton,
                          { backgroundColor: palette.mutedCard, borderColor: palette.border },
                          pressed ? styles.pressedActionButton : null,
                        ]}
                      >
                        <Text selectable style={[styles.orderButtonText, { color: palette.text }]}>
                          Up
                        </Text>
                      </Pressable>
                      <Pressable
                        accessibilityRole="button"
                        onPress={() => moveWidget(key, 1)}
                        style={({ pressed }) => [
                          styles.orderButton,
                          { backgroundColor: palette.mutedCard, borderColor: palette.border },
                          pressed ? styles.pressedActionButton : null,
                        ]}
                      >
                        <Text selectable style={[styles.orderButtonText, { color: palette.text }]}>
                          Down
                        </Text>
                      </Pressable>
                      <Switch
                        onValueChange={() => toggleWidgetVisible(key)}
                        thumbColor={visible ? palette.primary : palette.handle}
                        trackColor={{ false: palette.mutedCard, true: palette.primarySoft }}
                        value={visible}
                      />
                    </View>
                  </View>
                );
              })}
            </SettingSection>
          </ScrollView>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    overflow: 'hidden',
  },
  mapLayer: {
    ...StyleSheet.absoluteFillObject,
  },
  waitingMap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingHorizontal: 28,
    paddingBottom: 240,
  },
  waitingTitle: {
    fontSize: 18,
    fontWeight: '800',
    textAlign: 'center',
  },
  waitingSubtitle: {
    fontSize: 13,
    fontWeight: '600',
    textAlign: 'center',
  },
  topBar: {
    position: 'absolute',
    left: 18,
    right: 18,
    top: 54,
    zIndex: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    borderWidth: 1,
    borderRadius: 8,
    borderCurve: 'continuous',
    paddingHorizontal: 16,
    paddingVertical: 12,
    boxShadow: '0 8px 24px rgba(15, 23, 42, 0.18)',
  },
  topTitleBlock: {
    flex: 1,
    minWidth: 0,
  },
  appTitle: {
    fontSize: 17,
    fontWeight: '800',
  },
  appSubtitle: {
    fontSize: 12,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  statusBadge: {
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  statusBadgeText: {
    fontSize: 12,
    fontWeight: '900',
  },
  recordingPill: {
    position: 'absolute',
    right: 18,
    top: 128,
    zIndex: 11,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
    boxShadow: '0 8px 18px rgba(15, 23, 42, 0.25)',
  },
  recordingDot: {
    width: 8,
    height: 8,
    borderRadius: 999,
    backgroundColor: '#ef4444',
  },
  recordingText: {
    fontSize: 12,
    fontWeight: '900',
    fontVariant: ['tabular-nums'],
  },
  markerOuter: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  markerNeedle: {
    position: 'absolute',
    top: 0,
    width: 0,
    height: 0,
    borderLeftWidth: 8,
    borderRightWidth: 8,
    borderBottomWidth: 22,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
  },
  markerCore: {
    width: 24,
    height: 24,
    borderRadius: 999,
    borderWidth: 4,
    borderColor: '#ffffff',
    boxShadow: '0 4px 10px rgba(15, 23, 42, 0.3)',
  },
  bottomSheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 20,
    gap: 10,
    borderTopLeftRadius: 8,
    borderTopRightRadius: 8,
    borderCurve: 'continuous',
    paddingHorizontal: 18,
    paddingTop: 10,
    paddingBottom: 18,
    boxShadow: '0 -14px 32px rgba(15, 23, 42, 0.18)',
  },
  sheetHandle: {
    alignSelf: 'center',
    width: 46,
    height: 5,
    borderRadius: 999,
  },
  panelTabs: {
    flexDirection: 'row',
    gap: 8,
  },
  segmentRow: {
    flexDirection: 'row',
    gap: 8,
  },
  segmentButton: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 38,
    borderWidth: 1,
    borderRadius: 8,
    borderCurve: 'continuous',
    paddingHorizontal: 10,
  },
  segmentButtonText: {
    fontSize: 12,
    fontWeight: '900',
  },
  sheetScrollContent: {
    gap: 12,
    paddingBottom: 28,
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  sheetTitle: {
    fontSize: 20,
    fontWeight: '900',
  },
  sheetSubtitle: {
    fontSize: 12,
    fontWeight: '700',
  },
  gpsAge: {
    fontSize: 12,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
  },
  leanMeter: {
    gap: 6,
  },
  leanTrack: {
    height: 42,
    overflow: 'hidden',
    borderRadius: 8,
    borderCurve: 'continuous',
  },
  leanCenterLine: {
    position: 'absolute',
    left: '50%',
    top: 0,
    bottom: 0,
    width: 2,
  },
  leanFill: {
    position: 'absolute',
    top: 0,
    bottom: 0,
  },
  leanNeedle: {
    position: 'absolute',
    top: 5,
    width: 4,
    height: 32,
    borderRadius: 999,
  },
  leanLabels: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  leanLabel: {
    fontSize: 11,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
  },
  leanValue: {
    fontSize: 13,
    fontWeight: '900',
    fontVariant: ['tabular-nums'],
  },
  widgetGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  widgetCard: {
    gap: 3,
    minHeight: 88,
    borderWidth: 1,
    borderRadius: 8,
    borderCurve: 'continuous',
    padding: 10,
    boxShadow: '0 1px 2px rgba(15, 23, 42, 0.08)',
  },
  widgetIndicator: {
    width: 26,
    height: 4,
    borderRadius: 999,
  },
  widgetLabel: {
    fontSize: 10,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  widgetValue: {
    fontWeight: '900',
    fontVariant: ['tabular-nums'],
  },
  widgetDetail: {
    fontSize: 11,
    fontWeight: '700',
  },
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  rideStat: {
    width: '31.7%',
    gap: 1,
    borderRadius: 8,
    borderCurve: 'continuous',
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  rideStatLabel: {
    fontSize: 10,
    fontWeight: '800',
  },
  rideStatValue: {
    fontSize: 13,
    fontWeight: '900',
    fontVariant: ['tabular-nums'],
  },
  actionRow: {
    flexDirection: 'row',
    gap: 10,
  },
  actionButton: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
    borderCurve: 'continuous',
    paddingVertical: 11,
  },
  disabledActionButton: {
    backgroundColor: '#94a3b8',
  },
  pressedActionButton: {
    opacity: 0.82,
  },
  actionButtonText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '900',
  },
  secondaryButton: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderRadius: 8,
    borderCurve: 'continuous',
    paddingVertical: 11,
  },
  secondaryButtonText: {
    fontSize: 13,
    fontWeight: '900',
  },
  fullWidthButton: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderRadius: 8,
    borderCurve: 'continuous',
    paddingVertical: 11,
  },
  errorText: {
    fontSize: 11,
    fontWeight: '700',
  },
  chartCard: {
    gap: 10,
    borderWidth: 1,
    borderRadius: 8,
    borderCurve: 'continuous',
    padding: 12,
  },
  chartHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 10,
  },
  chartTitle: {
    fontSize: 15,
    fontWeight: '900',
  },
  chartSubtitle: {
    fontSize: 12,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
  },
  chartRange: {
    fontSize: 11,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
  },
  chartTrack: {
    height: 76,
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 2,
    overflow: 'hidden',
    borderRadius: 8,
    borderCurve: 'continuous',
    paddingHorizontal: 6,
    paddingVertical: 6,
  },
  chartBar: {
    flex: 1,
    minWidth: 2,
    maxWidth: 8,
    borderTopLeftRadius: 4,
    borderTopRightRadius: 4,
  },
  chartFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 10,
  },
  emptyState: {
    gap: 6,
    borderWidth: 1,
    borderRadius: 8,
    borderCurve: 'continuous',
    padding: 14,
  },
  emptyStateTitle: {
    fontSize: 16,
    fontWeight: '900',
  },
  emptyStateText: {
    fontSize: 12,
    fontWeight: '700',
  },
  summaryCard: {
    gap: 12,
    borderWidth: 1,
    borderRadius: 8,
    borderCurve: 'continuous',
    padding: 12,
  },
  summaryTitle: {
    fontSize: 15,
    fontWeight: '900',
  },
  summaryGrid: {
    flexDirection: 'row',
    gap: 10,
  },
  summaryItem: {
    flex: 1,
    gap: 3,
  },
  summaryLabel: {
    fontSize: 10,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  summaryValue: {
    fontSize: 12,
    fontWeight: '900',
  },
  summaryDetail: {
    fontSize: 11,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  settingSection: {
    gap: 8,
  },
  settingTitle: {
    fontSize: 14,
    fontWeight: '900',
  },
  menuCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderWidth: 1,
    borderRadius: 8,
    borderCurve: 'continuous',
    padding: 12,
  },
  menuCardText: {
    flex: 1,
    gap: 3,
  },
  menuCardTitle: {
    fontSize: 14,
    fontWeight: '900',
  },
  menuCardSubtitle: {
    fontSize: 12,
    fontWeight: '700',
  },
  smallButton: {
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 92,
    borderRadius: 8,
    borderCurve: 'continuous',
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  smallButtonText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '900',
  },
  calibrationText: {
    fontSize: 11,
    fontWeight: '700',
  },
  widgetEditorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderWidth: 1,
    borderRadius: 8,
    borderCurve: 'continuous',
    padding: 10,
  },
  widgetEditorTone: {
    width: 5,
    alignSelf: 'stretch',
    borderRadius: 999,
  },
  widgetEditorText: {
    flex: 1,
    gap: 2,
  },
  widgetEditorTitle: {
    fontSize: 13,
    fontWeight: '900',
  },
  widgetEditorSubtitle: {
    fontSize: 11,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  widgetEditorActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  orderButton: {
    minWidth: 42,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderRadius: 8,
    borderCurve: 'continuous',
    paddingHorizontal: 7,
    paddingVertical: 7,
  },
  orderButtonText: {
    fontSize: 10,
    fontWeight: '900',
  },
});
