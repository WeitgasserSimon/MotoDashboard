import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import * as Location from 'expo-location';
import { DeviceMotion, type DeviceMotionMeasurement } from 'expo-sensors';
import { StatusBar } from 'expo-status-bar';
import MapView, { Marker, Polyline, type LatLng, type Region } from 'react-native-maps';

type StreamState = 'starting' | 'live' | 'denied' | 'unavailable' | 'error';

const MAX_LEAN_DEGREES = 60;
const ROUTE_POINT_LIMIT = 600;
const MIN_ROUTE_DISTANCE_METERS = 1;

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function degrees(radians: number) {
  return radians * (180 / Math.PI);
}

function formatDuration(milliseconds: number) {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function formatMaybeNumber(value: number | null, suffix: string, decimals = 0) {
  if (value === null || !Number.isFinite(value)) {
    return '--';
  }

  return `${value.toFixed(decimals)} ${suffix}`;
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

function getRawLeanAngle(motion: DeviceMotionMeasurement | null) {
  if (!motion) {
    return null;
  }

  if (Number.isFinite(motion.rotation.gamma)) {
    return clamp(motion.rotation.gamma, -89, 89);
  }

  const gravity = motion.accelerationIncludingGravity;
  const leanRadians = Math.atan2(gravity.x, Math.sqrt(gravity.y * gravity.y + gravity.z * gravity.z));

  return clamp(degrees(leanRadians), -89, 89);
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

export default function App() {
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
  const [leanOffset, setLeanOffset] = useState(0);
  const [maxLean, setMaxLean] = useState(0);
  const [lastCornerLean, setLastCornerLean] = useState<number | null>(null);

  const lastLocationRef = useRef<Location.LocationObject | null>(null);

  const applyLocationUpdate = useCallback((nextLocation: Location.LocationObject) => {
    const nextCoordinate = getCoordinate(nextLocation);
    const previousLocation = lastLocationRef.current;
    let measuredSpeedMps: number | null = null;

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
    }

    const gpsSpeedMps =
      nextLocation.coords.speed !== null && nextLocation.coords.speed >= 0
        ? nextLocation.coords.speed
        : null;
    const activeSpeedMps = gpsSpeedMps ?? measuredSpeedMps;

    if (activeSpeedMps !== null && Number.isFinite(activeSpeedMps)) {
      setTopSpeedKmh((currentTopSpeed) =>
        Math.max(currentTopSpeed, metersPerSecondToKilometersPerHour(activeSpeedMps)),
      );
    }

    setLocation(nextLocation);
    setRoute((currentRoute) => {
      const lastCoordinate = currentRoute.at(-1);

      if (lastCoordinate && getDistanceMeters(lastCoordinate, nextCoordinate) < MIN_ROUTE_DISTANCE_METERS) {
        return currentRoute;
      }

      return [...currentRoute, nextCoordinate].slice(-ROUTE_POINT_LIMIT);
    });

    lastLocationRef.current = nextLocation;
  }, []);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);

    return () => clearInterval(timer);
  }, []);

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

  const rawLeanAngle = useMemo(() => getRawLeanAngle(motion), [motion]);
  const leanAngle = rawLeanAngle === null ? null : clamp(rawLeanAngle - leanOffset, -89, 89);
  const absLeanAngle = leanAngle === null ? null : Math.abs(leanAngle);

  useEffect(() => {
    if (absLeanAngle === null) {
      return;
    }

    setMaxLean((currentMaxLean) => Math.max(currentMaxLean, absLeanAngle));

    if (absLeanAngle >= 20) {
      setLastCornerLean(absLeanAngle);
    }
  }, [absLeanAngle]);

  const currentCoordinate = location ? getCoordinate(location) : null;
  const gpsSpeedMps = location?.coords.speed !== null && location?.coords.speed !== undefined && location.coords.speed >= 0
    ? location.coords.speed
    : null;
  const activeSpeedMps = gpsSpeedMps ?? calculatedSpeedMps;
  const speedKmh = activeSpeedMps === null ? null : metersPerSecondToKilometersPerHour(activeSpeedMps);
  const speedSource = gpsSpeedMps !== null ? 'GPS speed' : calculatedSpeedMps !== null ? 'GPS delta' : 'Waiting';
  const headingDegrees =
    location?.coords.heading !== null && location?.coords.heading !== undefined && location.coords.heading >= 0
      ? location.coords.heading
      : heading?.trueHeading !== undefined && heading.trueHeading >= 0
        ? heading.trueHeading
        : heading?.magHeading ?? null;
  const mapRegion: Region | undefined = currentCoordinate
    ? {
        ...currentCoordinate,
        latitudeDelta: 0.006,
        longitudeDelta: 0.006,
      }
    : undefined;
  const gpsAccuracy = location?.coords.accuracy ?? null;
  const gpsAgeSeconds = location ? Math.max(0, Math.round((now - location.timestamp) / 1000)) : null;
  const rideTime = formatDuration(now - rideStartedAt);
  const leanPercent = absLeanAngle === null ? 0 : clamp(absLeanAngle / MAX_LEAN_DEGREES, 0, 1) * 50;
  const leanFillWidth = `${leanPercent}%` as `${number}%`;
  const leanNeedleLeft = `${50 + clamp((leanAngle ?? 0) / MAX_LEAN_DEGREES, -1, 1) * 50}%` as `${number}%`;
  const isLeaningRight = (leanAngle ?? 0) >= 0;
  const liveStatus = locationStatus === 'live' && motionStatus === 'live' ? 'Live' : 'Setup';

  const calibrateLean = useCallback(() => {
    if (rawLeanAngle !== null) {
      setLeanOffset(rawLeanAngle);
      setMaxLean(0);
      setLastCornerLean(null);
    }
  }, [rawLeanAngle]);

  const resetRide = useCallback(() => {
    setDistanceMeters(0);
    setCalculatedSpeedMps(null);
    setTopSpeedKmh(0);
    setMaxLean(0);
    setLastCornerLean(null);
    setRideStartedAt(Date.now());
    setRoute(currentCoordinate ? [currentCoordinate] : []);
    lastLocationRef.current = location;
  }, [currentCoordinate, location]);

  const telemetry = [
    {
      label: 'Lean',
      value: formatMaybeNumber(absLeanAngle, 'deg'),
      detail: leanAngle === null ? 'Waiting' : leanAngle < -1 ? 'Left' : leanAngle > 1 ? 'Right' : 'Centered',
      tone: '#f97316',
    },
    {
      label: 'Speed',
      value: formatMaybeNumber(speedKmh, 'km/h'),
      detail: speedSource,
      tone: '#2563eb',
    },
    {
      label: 'GPS',
      value: location ? getGpsQuality(gpsAccuracy) : '--',
      detail: gpsAccuracy === null ? 'Waiting' : `${Math.round(gpsAccuracy)} m`,
      tone: '#16a34a',
    },
  ];

  const rideStats = [
    { label: 'Max lean', value: formatMaybeNumber(maxLean, 'deg') },
    { label: 'Last corner', value: formatMaybeNumber(lastCornerLean, 'deg') },
    { label: 'Distance', value: `${metersToKilometers(distanceMeters).toFixed(2)} km` },
    { label: 'Top speed', value: `${topSpeedKmh.toFixed(0)} km/h` },
    { label: 'Heading', value: formatMaybeNumber(headingDegrees, 'deg') },
    { label: 'Ride time', value: rideTime },
  ];

  return (
    <View style={styles.screen}>
      <StatusBar style="dark" />

      <View style={styles.mapLayer}>
        {currentCoordinate && mapRegion ? (
          <MapView
            style={StyleSheet.absoluteFillObject}
            region={mapRegion}
            mapPadding={{ bottom: 350, left: 12, right: 12, top: 116 }}
            showsCompass
            showsMyLocationButton
            showsScale
            showsTraffic
            showsUserLocation
            userInterfaceStyle="light"
          >
            {route.length > 1 ? (
              <Polyline coordinates={route} strokeColor="#2563eb" strokeWidth={6} />
            ) : null}
            <Marker
              coordinate={currentCoordinate}
              rotation={headingDegrees ?? 0}
              title="Live position"
              tracksViewChanges={false}
            >
              <View style={styles.markerOuter}>
                <View style={styles.markerNeedle} />
                <View style={styles.markerCore} />
              </View>
            </Marker>
          </MapView>
        ) : (
          <View style={styles.waitingMap}>
            <ActivityIndicator color="#2563eb" />
            <Text selectable style={styles.waitingTitle}>
              Waiting for real GPS
            </Text>
            <Text selectable style={styles.waitingSubtitle}>
              {locationError ?? 'Accept location permission on the iPhone.'}
            </Text>
          </View>
        )}
      </View>

      <View style={styles.topBar}>
        <View>
          <Text selectable style={styles.appTitle}>
            Moto Dashboard
          </Text>
          <Text selectable style={styles.appSubtitle}>
            {currentCoordinate
              ? `${currentCoordinate.latitude.toFixed(5)}, ${currentCoordinate.longitude.toFixed(5)}`
              : locationError ?? 'GPS stream starting'}
          </Text>
        </View>
        <View style={[styles.statusBadge, liveStatus === 'Live' ? styles.liveBadge : styles.setupBadge]}>
          <Text selectable style={[styles.statusBadgeText, liveStatus === 'Live' ? styles.liveBadgeText : styles.setupBadgeText]}>
            {liveStatus}
          </Text>
        </View>
      </View>

      <View style={styles.recordingPill}>
        <View style={styles.recordingDot} />
        <Text selectable style={styles.recordingText}>
          REC {rideTime}
        </Text>
      </View>

      <View style={styles.bottomSheet}>
        <View style={styles.sheetHandle} />

        <View style={styles.sheetHeader}>
          <View>
            <Text selectable style={styles.sheetTitle}>
              Live Ride
            </Text>
            <Text selectable style={styles.sheetSubtitle}>
              GPS {locationStatus} | Motion {motionStatus}
            </Text>
          </View>
          <Text selectable style={styles.gpsAge}>
            {gpsAgeSeconds === null ? '-- s' : `${gpsAgeSeconds} s`}
          </Text>
        </View>

        <View style={styles.leanMeter}>
          <View style={styles.leanTrack}>
            <View style={styles.leanCenterLine} />
            <View
              style={[
                styles.leanFill,
                isLeaningRight ? { left: '50%', width: leanFillWidth } : { right: '50%', width: leanFillWidth },
              ]}
            />
            <View style={[styles.leanNeedle, { left: leanNeedleLeft }]} />
          </View>
          <View style={styles.leanLabels}>
            <Text selectable style={styles.leanLabel}>
              L 60
            </Text>
            <Text selectable style={styles.leanValue}>
              {formatMaybeNumber(leanAngle, 'deg')}
            </Text>
            <Text selectable style={styles.leanLabel}>
              R 60
            </Text>
          </View>
        </View>

        <View style={styles.telemetryGrid}>
          {telemetry.map((item) => (
            <View key={item.label} style={styles.telemetryCard}>
              <View style={[styles.telemetryIndicator, { backgroundColor: item.tone }]} />
              <Text selectable style={styles.telemetryLabel}>
                {item.label}
              </Text>
              <Text selectable style={styles.telemetryValue}>
                {item.value}
              </Text>
              <Text selectable style={styles.telemetryDetail}>
                {item.detail}
              </Text>
            </View>
          ))}
        </View>

        <View style={styles.statsGrid}>
          {rideStats.map((item) => (
            <View key={item.label} style={styles.rideStat}>
              <Text selectable style={styles.rideStatLabel}>
                {item.label}
              </Text>
              <Text selectable style={styles.rideStatValue}>
                {item.value}
              </Text>
            </View>
          ))}
        </View>

        <View style={styles.actionRow}>
          <Pressable
            accessibilityRole="button"
            disabled={rawLeanAngle === null}
            onPress={calibrateLean}
            style={({ pressed }) => [
              styles.actionButton,
              rawLeanAngle === null ? styles.disabledActionButton : null,
              pressed ? styles.pressedActionButton : null,
            ]}
          >
            <Text selectable style={styles.actionButtonText}>
              Calibrate lean
            </Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            onPress={resetRide}
            style={({ pressed }) => [styles.secondaryButton, pressed ? styles.pressedActionButton : null]}
          >
            <Text selectable style={styles.secondaryButtonText}>
              Reset ride
            </Text>
          </Pressable>
        </View>

        {locationError || motionError ? (
          <Text selectable style={styles.errorText}>
            {locationError ?? motionError}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    overflow: 'hidden',
    backgroundColor: '#dbe7df',
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
    backgroundColor: '#dbe7df',
  },
  waitingTitle: {
    color: '#0f172a',
    fontSize: 18,
    fontWeight: '800',
    textAlign: 'center',
  },
  waitingSubtitle: {
    color: '#475569',
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
    borderRadius: 8,
    borderCurve: 'continuous',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#ffffff',
    boxShadow: '0 8px 24px rgba(15, 23, 42, 0.18)',
  },
  appTitle: {
    color: '#111827',
    fontSize: 17,
    fontWeight: '800',
  },
  appSubtitle: {
    color: '#64748b',
    fontSize: 12,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  statusBadge: {
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  liveBadge: {
    backgroundColor: '#dcfce7',
  },
  setupBadge: {
    backgroundColor: '#e2e8f0',
  },
  statusBadgeText: {
    fontSize: 12,
    fontWeight: '900',
  },
  liveBadgeText: {
    color: '#166534',
  },
  setupBadgeText: {
    color: '#475569',
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
    backgroundColor: '#111827',
    boxShadow: '0 8px 18px rgba(15, 23, 42, 0.25)',
  },
  recordingDot: {
    width: 8,
    height: 8,
    borderRadius: 999,
    backgroundColor: '#ef4444',
  },
  recordingText: {
    color: '#f8fafc',
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
    borderBottomColor: '#2563eb',
  },
  markerCore: {
    width: 24,
    height: 24,
    borderRadius: 999,
    borderWidth: 4,
    borderColor: '#ffffff',
    backgroundColor: '#2563eb',
    boxShadow: '0 4px 10px rgba(15, 23, 42, 0.3)',
  },
  bottomSheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 20,
    height: 356,
    gap: 12,
    borderTopLeftRadius: 8,
    borderTopRightRadius: 8,
    borderCurve: 'continuous',
    paddingHorizontal: 18,
    paddingTop: 10,
    paddingBottom: 18,
    backgroundColor: '#f8fafc',
    boxShadow: '0 -14px 32px rgba(15, 23, 42, 0.18)',
  },
  sheetHandle: {
    alignSelf: 'center',
    width: 46,
    height: 5,
    borderRadius: 999,
    backgroundColor: '#cbd5e1',
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  sheetTitle: {
    color: '#0f172a',
    fontSize: 20,
    fontWeight: '900',
  },
  sheetSubtitle: {
    color: '#64748b',
    fontSize: 12,
    fontWeight: '700',
  },
  gpsAge: {
    color: '#475569',
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
    backgroundColor: '#e2e8f0',
  },
  leanCenterLine: {
    position: 'absolute',
    left: '50%',
    top: 0,
    bottom: 0,
    width: 2,
    backgroundColor: '#94a3b8',
  },
  leanFill: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    backgroundColor: '#fed7aa',
  },
  leanNeedle: {
    position: 'absolute',
    top: 5,
    width: 4,
    height: 32,
    borderRadius: 999,
    backgroundColor: '#f97316',
  },
  leanLabels: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  leanLabel: {
    color: '#64748b',
    fontSize: 11,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
  },
  leanValue: {
    color: '#0f172a',
    fontSize: 13,
    fontWeight: '900',
    fontVariant: ['tabular-nums'],
  },
  telemetryGrid: {
    flexDirection: 'row',
    gap: 10,
  },
  telemetryCard: {
    flex: 1,
    gap: 3,
    minHeight: 82,
    borderRadius: 8,
    borderCurve: 'continuous',
    padding: 10,
    backgroundColor: '#ffffff',
    boxShadow: '0 1px 2px rgba(15, 23, 42, 0.08)',
  },
  telemetryIndicator: {
    width: 26,
    height: 4,
    borderRadius: 999,
  },
  telemetryLabel: {
    color: '#64748b',
    fontSize: 10,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  telemetryValue: {
    color: '#0f172a',
    fontSize: 18,
    fontWeight: '900',
    fontVariant: ['tabular-nums'],
  },
  telemetryDetail: {
    color: '#64748b',
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
    backgroundColor: '#eef2f7',
  },
  rideStatLabel: {
    color: '#64748b',
    fontSize: 10,
    fontWeight: '800',
  },
  rideStatValue: {
    color: '#0f172a',
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
    paddingVertical: 10,
    backgroundColor: '#2563eb',
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
    borderRadius: 8,
    borderCurve: 'continuous',
    paddingVertical: 10,
    backgroundColor: '#e2e8f0',
  },
  secondaryButtonText: {
    color: '#0f172a',
    fontSize: 13,
    fontWeight: '900',
  },
  errorText: {
    color: '#b91c1c',
    fontSize: 11,
    fontWeight: '700',
  },
});
