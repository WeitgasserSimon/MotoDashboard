import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useColorScheme,
} from 'react-native';
import * as Location from 'expo-location';
import { StatusBar } from 'expo-status-bar';
import { type LatLng } from 'react-native-maps';
import { useSensorManager } from './src/hooks/useSensorManager';
import { LeanAngleGauge } from './src/components/LeanAngleGauge';
import { DashboardCard } from './src/components/DashboardCard';
import { MotorcycleMap } from './src/components/MapView';
import { SensorDebugView } from './src/components/SensorDebugView';

type ActivePanel = 'ride' | 'settings' | 'debug';
type ViewMode = 'hybrid' | 'mapOnly' | 'dataOnly';
type ThemeMode = 'system' | 'light' | 'dark';

const MAX_LEAN_DEGREES = 60;
const ROUTE_POINT_LIMIT = 600;
const MIN_ROUTE_DISTANCE_METERS = 1;
const STORAGE_KEY = 'shotgunblackbox.dashboard.v3';

const PALETTE = {
  background: '#12151b',
  card: '#202632',
  border: '#334155',
  text: '#f8fafc',
  mutedText: '#94a3b8',
  primary: '#60a5fa',
  accent: '#f97316',
  success: '#22c55e',
  warning: '#eab308',
  danger: '#ef4444',
};

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
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

function isThemeMode(value: unknown): value is ThemeMode {
  return value === 'system' || value === 'light' || value === 'dark';
}

function safeDateTime(timestamp: number | null) {
  if (!timestamp) {
    return '--';
  }

  return new Date(timestamp).toLocaleString();
}

function SegmentButton({
  active,
  label,
  onPress,
}: {
  active: boolean;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.segmentButton,
        {
          backgroundColor: active ? PALETTE.primary : PALETTE.card,
          borderColor: active ? PALETTE.primary : PALETTE.border,
          opacity: pressed ? 0.82 : 1,
        },
      ]}
    >
      <Text selectable style={[styles.segmentButtonText, { color: active ? '#ffffff' : PALETTE.text }]}>
        {label}
      </Text>
    </Pressable>
  );
}

export default function App() {
  const systemColorScheme = useColorScheme();
  const [locationStatus, setLocationStatus] = useState<'starting' | 'live' | 'denied' | 'unavailable' | 'error'>('starting');
  const [locationError, setLocationError] = useState<string | null>(null);
  const [location, setLocation] = useState<Location.LocationObject | null>(null);
  const [route, setRoute] = useState<LatLng[]>([]);
  const [rideStartedAt, setRideStartedAt] = useState(() => Date.now());
  const [now, setNow] = useState(() => Date.now());
  const [distanceMeters, setDistanceMeters] = useState(0);
  const [calculatedSpeedMps, setCalculatedSpeedMps] = useState<number | null>(null);
  const [topSpeedKmh, setTopSpeedKmh] = useState(0);
  const [elevationGainMeters, setElevationGainMeters] = useState(0);
  const [elevationLossMeters, setElevationLossMeters] = useState(0);
  const [activePanel, setActivePanel] = useState<ActivePanel>('ride');
  const [themeMode, setThemeMode] = useState<ThemeMode>('system');
  const [rideActive, setRideActive] = useState(true);
  const [storageLoaded, setStorageLoaded] = useState(false);
  const [followMode, setFollowMode] = useState(true);
  const [zoomLevel, setZoomLevel] = useState(16);
  const [viewMode, setViewMode] = useState<ViewMode>('hybrid');
  const [mapDataRatio, setMapDataRatio] = useState(0.5); // 0 = full data, 1 = full map
  const [simulatedLeanAngle, setSimulatedLeanAngle] = useState<number | null>(null);

  const lastLocationRef = useRef<Location.LocationObject | null>(null);

  // Use new sensor fusion system
  const [sensorState, sensorActions] = useSensorManager();

  const currentCoordinate = location ? getCoordinate(location) : null;
  const gpsSpeedMps =
    location?.coords.speed !== null && location?.coords.speed !== undefined && location.coords.speed >= 0
      ? location.coords.speed
      : null;
  const activeSpeedMps = gpsSpeedMps ?? calculatedSpeedMps;
  const speedKmh = activeSpeedMps === null ? null : metersPerSecondToKilometersPerHour(activeSpeedMps);
  const speedSource = gpsSpeedMps !== null ? 'GPS speed' : calculatedSpeedMps !== null ? 'GPS delta' : 'Waiting';
  const altitudeMeters = location?.coords.altitude ?? null;
  const gpsAccuracy = location?.coords.accuracy ?? null;

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

          if (Math.abs(altitudeDelta) >= 1.2) {
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
        const rawState = await AsyncStorage.getItem(STORAGE_KEY);

        if (!rawState) {
          return;
        }

        const parsedState = JSON.parse(rawState) as {
          themeMode?: unknown;
          calibration?: unknown;
        };

        if (isThemeMode(parsedState.themeMode)) {
          setThemeMode(parsedState.themeMode);
        }

        if (parsedState.calibration) {
          sensorActions.resetCalibration();
        }
      } catch (error) {
        console.warn('Could not restore dashboard settings', error);
      } finally {
        setStorageLoaded(true);
      }
    }

    restoreDashboard();
  }, [sensorActions]);

  useEffect(() => {
    if (!storageLoaded) {
      return;
    }

    const nextState = {
      themeMode,
      calibration: sensorState.calibration,
    };

    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(nextState)).catch((error) => {
      console.warn('Could not persist dashboard settings', error);
    });
  }, [sensorState.calibration, storageLoaded, themeMode]);

  useEffect(() => {
    let locationSubscription: Location.LocationSubscription | null = null;
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
    };
  }, [applyLocationUpdate]);

  const resetRide = useCallback(() => {
    const startedAt = Date.now();
    setDistanceMeters(0);
    setCalculatedSpeedMps(null);
    setTopSpeedKmh(0);
    setElevationGainMeters(0);
    setElevationLossMeters(0);
    setRideStartedAt(startedAt);
    setRideActive(true);
    setRoute(currentCoordinate ? [currentCoordinate] : []);
    lastLocationRef.current = location;
    sensorActions.resetMaxValues();
  }, [currentCoordinate, location, sensorActions]);

  const handleSimulateLeanAngle = useCallback((angle: number | null) => {
    setSimulatedLeanAngle(angle);
  }, []);

  const displayLeanAngle = simulatedLeanAngle !== null ? simulatedLeanAngle : sensorState.leanAngle;
  const gpsAgeSeconds = location ? Math.max(0, Math.round((now - location.timestamp) / 1000)) : null;
  const rideTime = formatDuration(rideActive ? now - rideStartedAt : now - rideStartedAt);
  const absLeanAngle = displayLeanAngle !== null ? Math.abs(displayLeanAngle) : null;
  const isLeaningRight = (displayLeanAngle ?? 0) >= 0;
  const liveStatus = locationStatus === 'live' && sensorState.status === 'live' ? 'Live' : 'Setup';

  return (
    <View style={[styles.screen, { backgroundColor: PALETTE.background }]}>
      <StatusBar style="light" />

      <View style={[
        styles.mapLayer,
        viewMode === 'dataOnly' && styles.mapLayerHidden
      ]}>
        <MotorcycleMap 
          currentLocation={location} 
          route={route} 
          followMode={followMode}
          onFollowModeToggle={() => setFollowMode(!followMode)}
          zoomLevel={zoomLevel}
        />
      </View>

      <View style={[styles.topBar, { backgroundColor: PALETTE.card, borderColor: PALETTE.border }]}>
        <View style={styles.topTitleBlock}>
          <Text selectable style={[styles.appTitle, { color: PALETTE.text }]}>
            Moto Dashboard
          </Text>
          <Text selectable numberOfLines={1} style={[styles.appSubtitle, { color: PALETTE.mutedText }]}>
            {currentCoordinate
              ? `${currentCoordinate.latitude.toFixed(5)}, ${currentCoordinate.longitude.toFixed(5)}`
              : locationError ?? 'GPS stream starting'}
          </Text>
        </View>
        <View style={[styles.statusBadge, liveStatus === 'Live' ? { backgroundColor: PALETTE.success } : { backgroundColor: PALETTE.card }]}>
          <Text selectable style={[styles.statusBadgeText, { color: liveStatus === 'Live' ? '#ffffff' : PALETTE.mutedText }]}>
            {liveStatus}
          </Text>
        </View>
      </View>

      <View style={[styles.recordingPill, { backgroundColor: PALETTE.card }]}>
        <View style={[styles.recordingDot, { opacity: rideActive ? 1 : 0.35 }]} />
        <Text selectable style={[styles.recordingText, { color: PALETTE.text }]}>
          {rideActive ? 'REC' : 'DONE'} {rideTime}
        </Text>
      </View>

      <View style={[
        styles.bottomSheet, 
        { backgroundColor: PALETTE.card },
        viewMode === 'mapOnly' && styles.bottomSheetHidden
      ]}>
        <View style={[styles.sheetHandle, { backgroundColor: PALETTE.border }]} />

        <View style={styles.panelTabs}>
          <SegmentButton active={activePanel === 'ride'} label="Ride" onPress={() => setActivePanel('ride')} />
          <SegmentButton active={activePanel === 'settings'} label="Settings" onPress={() => setActivePanel('settings')} />
          <SegmentButton active={activePanel === 'debug'} label="Debug" onPress={() => setActivePanel('debug')} />
        </View>

        {activePanel === 'ride' && (
          <View style={styles.viewModeControls}>
            <Text selectable style={[styles.viewModeLabel, { color: PALETTE.mutedText }]}>View Mode</Text>
            <View style={styles.viewModeButtons}>
              <SegmentButton active={viewMode === 'hybrid'} label="Hybrid" onPress={() => setViewMode('hybrid')} />
              <SegmentButton active={viewMode === 'mapOnly'} label="Map" onPress={() => setViewMode('mapOnly')} />
              <SegmentButton active={viewMode === 'dataOnly'} label="Data" onPress={() => setViewMode('dataOnly')} />
            </View>
          </View>
        )}

        {activePanel === 'ride' ? (
          <ScrollView contentContainerStyle={styles.sheetScrollContent} showsVerticalScrollIndicator={false}>
            <View style={styles.leanGaugeContainer}>
              <LeanAngleGauge leanAngle={displayLeanAngle} maxLean={sensorState.maxLean} size={180} />
              <View style={styles.leanValueContainer}>
                <Text selectable style={[styles.leanValue, { color: PALETTE.text }]}>
                  {formatSignedMaybeNumber(displayLeanAngle, '°', 1)}
                </Text>
                <Text selectable style={[styles.leanLabel, { color: PALETTE.mutedText }]}>
                  {absLeanAngle === null ? 'Waiting' : absLeanAngle >= 20 ? 'Cornering' : 'Upright'}
                </Text>
              </View>
            </View>

            <View style={styles.cardsGrid}>
              <DashboardCard
                title="Speed"
                value={formatMaybeNumber(speedKmh, '')}
                unit="km/h"
                detail={speedSource}
                color={PALETTE.primary}
              />
              <DashboardCard
                title="Distance"
                value={metersToKilometers(distanceMeters).toFixed(2)}
                unit="km"
                detail={rideActive ? 'Current ride' : 'Ride stopped'}
                color={PALETTE.success}
              />
              <DashboardCard
                title="Altitude"
                value={formatMaybeNumber(altitudeMeters, '')}
                unit="m"
                detail="GPS altitude"
                color={PALETTE.warning}
              />
              <DashboardCard
                title="GPS"
                value={location ? getGpsQuality(gpsAccuracy) : '--'}
                detail={gpsAccuracy === null ? 'Waiting' : `${Math.round(gpsAccuracy)} m | ${gpsAgeSeconds ?? '--'} s`}
                color={PALETTE.success}
              />
              <DashboardCard
                title="Max Lean"
                value={formatMaybeNumber(sensorState.maxLean, '')}
                unit="°"
                detail={`Last corner: ${formatMaybeNumber(sensorState.lastCornerLean, '°', 1)}`}
                color={PALETTE.accent}
              />
              <DashboardCard
                title="Top Speed"
                value={topSpeedKmh.toFixed(0)}
                unit="km/h"
                detail="Ride max"
                color={PALETTE.primary}
              />
            </View>

            <View style={styles.actionRow}>
              <Pressable
                accessibilityRole="button"
                onPress={sensorActions.calibrate}
                style={({ pressed }) => [
                  styles.actionButton,
                  { backgroundColor: PALETTE.primary },
                  pressed ? styles.pressedActionButton : null,
                ]}
              >
                <Text selectable style={styles.actionButtonText}>
                  Kalibrieren
                </Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                onPress={resetRide}
                style={({ pressed }) => [
                  styles.secondaryButton,
                  { backgroundColor: PALETTE.card, borderColor: PALETTE.border },
                  pressed ? styles.pressedActionButton : null,
                ]}
              >
                <Text selectable style={[styles.secondaryButtonText, { color: PALETTE.text }]}>
                  Reset Ride
                </Text>
              </Pressable>
            </View>

            {locationError || sensorState.error ? (
              <Text selectable style={[styles.errorText, { color: PALETTE.danger }]}>
                {locationError ?? sensorState.error}
              </Text>
            ) : null}
          </ScrollView>
        ) : null}

        {activePanel === 'settings' ? (
          <ScrollView contentContainerStyle={styles.sheetScrollContent} showsVerticalScrollIndicator={false}>
            <View style={styles.settingSection}>
              <Text selectable style={[styles.settingTitle, { color: PALETTE.text }]}>
                Theme
              </Text>
              <View style={styles.segmentRow}>
                <SegmentButton active={themeMode === 'system'} label="System" onPress={() => setThemeMode('system')} />
                <SegmentButton active={themeMode === 'light'} label="Light" onPress={() => setThemeMode('light')} />
                <SegmentButton active={themeMode === 'dark'} label="Dark" onPress={() => setThemeMode('dark')} />
              </View>
            </View>

            <View style={styles.settingSection}>
              <Text selectable style={[styles.settingTitle, { color: PALETTE.text }]}>
                Sensor Status
              </Text>
              <DashboardCard
                title="Motion"
                value={sensorState.status}
                detail={sensorState.error ?? 'Sensor fusion active'}
                color={sensorState.status === 'live' ? PALETTE.success : PALETTE.warning}
              />
              <Text selectable style={[styles.infoText, { color: PALETTE.mutedText }]}>
                Using quaternion-based sensor fusion with complementary filter for accurate lean angle measurement up to 60°.
              </Text>
            </View>

            <View style={styles.settingSection}>
              <Text selectable style={[styles.settingTitle, { color: PALETTE.text }]}>
                Calibration
              </Text>
              <DashboardCard
                title="Last Calibration"
                value={safeDateTime(sensorState.calibration.createdAt)}
                detail="Lean offset stored"
                color={PALETTE.primary}
              />
              <Pressable
                accessibilityRole="button"
                onPress={sensorActions.resetCalibration}
                style={({ pressed }) => [
                  styles.fullWidthButton,
                  { backgroundColor: PALETTE.card, borderColor: PALETTE.border },
                  pressed ? styles.pressedActionButton : null,
                ]}
              >
                <Text selectable style={[styles.secondaryButtonText, { color: PALETTE.text }]}>
                  Reset Calibration
                </Text>
              </Pressable>
            </View>
          </ScrollView>
        ) : null}

        {activePanel === 'debug' ? (
          <SensorDebugView
            debug={sensorState.debug}
            leanAngle={sensorState.leanAngle}
            calibration={sensorState.calibration}
            onSimulateAngle={handleSimulateLeanAngle}
          />
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
  mapLayerHidden: {
    opacity: 0,
    pointerEvents: 'none',
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
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  topTitleBlock: {
    flex: 1,
    minWidth: 0,
  },
  appTitle: {
    fontSize: 18,
    fontWeight: '800',
  },
  appSubtitle: {
    fontSize: 12,
    fontWeight: '600',
    marginTop: 2,
  },
  statusBadge: {
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  statusBadgeText: {
    fontSize: 11,
    fontWeight: '800',
  },
  recordingPill: {
    position: 'absolute',
    right: 18,
    top: 128,
    zIndex: 11,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  recordingDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: PALETTE.danger,
  },
  recordingText: {
    fontSize: 12,
    fontWeight: '800',
  },
  bottomSheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 20,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 18,
    paddingTop: 12,
    paddingBottom: 28,
    gap: 16,
  },
  bottomSheetHidden: {
    transform: [{ translateY: 1000 }],
  },
  sheetHandle: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
  },
  panelTabs: {
    flexDirection: 'row',
    gap: 8,
  },
  viewModeControls: {
    marginTop: 12,
    marginBottom: 8,
  },
  viewModeLabel: {
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 8,
  },
  viewModeButtons: {
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
    height: 40,
    borderWidth: 1,
    borderRadius: 10,
  },
  segmentButtonText: {
    fontSize: 13,
    fontWeight: '700',
  },
  sheetScrollContent: {
    gap: 16,
  },
  leanGaugeContainer: {
    alignItems: 'center',
    paddingVertical: 16,
  },
  leanValueContainer: {
    alignItems: 'center',
    marginTop: 12,
  },
  leanValue: {
    fontSize: 42,
    fontWeight: '800',
    letterSpacing: -1,
  },
  leanLabel: {
    fontSize: 14,
    fontWeight: '600',
    marginTop: 4,
  },
  cardsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  actionRow: {
    flexDirection: 'row',
    gap: 12,
  },
  actionButton: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
    paddingVertical: 14,
  },
  pressedActionButton: {
    opacity: 0.8,
  },
  actionButtonText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '700',
  },
  secondaryButton: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 14,
  },
  secondaryButtonText: {
    fontSize: 14,
    fontWeight: '700',
  },
  fullWidthButton: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 14,
  },
  errorText: {
    fontSize: 12,
    fontWeight: '600',
    textAlign: 'center',
  },
  settingSection: {
    gap: 12,
  },
  settingTitle: {
    fontSize: 16,
    fontWeight: '700',
  },
  infoText: {
    fontSize: 13,
    fontWeight: '500',
    lineHeight: 18,
  },
});
