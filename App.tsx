import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Keyboard,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useColorScheme,
  useWindowDimensions,
  PanResponder,
} from 'react-native';
import * as Location from 'expo-location';
import { StatusBar } from 'expo-status-bar';
import { type LatLng } from 'react-native-maps';
import { useSensorManager, type CalibrationData } from './src/hooks/useSensorManager';
import { LeanAngleGauge } from './src/components/LeanAngleGauge';
import { DashboardCard } from './src/components/DashboardCard';
import { MotorcycleMap } from './src/components/MapView';
import { SensorDebugView } from './src/components/SensorDebugView';

type ViewMode = 'hybrid' | 'mapOnly' | 'dataOnly' | 'focused';
type ThemeMode = 'system' | 'light' | 'dark';
type AppScreen = 'dashboard' | 'map' | 'settings' | 'debug';

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

function isCalibrationData(value: unknown): value is CalibrationData {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const calibration = value as CalibrationData;
  return (
    typeof calibration.leanOffset === 'number' &&
    typeof calibration.pitchOffset === 'number' &&
    typeof calibration.rollOffset === 'number' &&
    typeof calibration.yawOffset === 'number' &&
    typeof calibration.createdAt === 'number'
  );
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
  const [themeMode, setThemeMode] = useState<ThemeMode>('system');
  const [rideActive, setRideActive] = useState(true);
  const [navigationActive, setNavigationActive] = useState(false);
  const [navigationRoute, setNavigationRoute] = useState<LatLng[]>([]);
  const [storageLoaded, setStorageLoaded] = useState(false);
  const [followMode, setFollowMode] = useState(true);
  const [destinationQuery, setDestinationQuery] = useState('');
  const [destinationResults, setDestinationResults] = useState<Location.LocationGeocodedLocation[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [zoomLevel, setZoomLevel] = useState(16);
  const [viewMode, setViewMode] = useState<ViewMode>('hybrid');
  const [simulatedLeanAngle, setSimulatedLeanAngle] = useState<number | null>(null);
  const [sheetVisible, setSheetVisible] = useState(true);
  const [sheetSnapPosition, setSheetSnapPosition] = useState<'full' | 'half' | 'hidden'>('full');
  const [currentSheetHeight, setCurrentSheetHeight] = useState(0);
  const [appScreen, setAppScreen] = useState<AppScreen>('dashboard');
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();
  const sheetHeight = useRef(new Animated.Value(0)).current;

  const lastLocationRef = useRef<Location.LocationObject | null>(null);

  // Use new sensor fusion system
  const [sensorState, sensorActions] = useSensorManager();

  const sheetSnapHeights = useMemo(
    () => ({
      full: 0,
      half: Math.max(0, screenHeight * 0.42),
      hidden: Math.max(0, screenHeight * 0.82),
    }),
    [screenHeight],
  );

  useEffect(() => {
    if (screenHeight <= 0) {
      return;
    }

    const target = sheetSnapHeights[sheetSnapPosition];
    setCurrentSheetHeight(target);
    sheetHeight.setValue(target);
  }, [screenHeight, sheetSnapHeights, sheetSnapPosition, sheetHeight]);

  useEffect(() => {
    switch (appScreen) {
      case 'dashboard':
        setViewMode('hybrid');
        setSheetVisible(true);
        setSheetSnapPosition('half');
        break;
      case 'map':
        setViewMode('mapOnly');
        setSheetVisible(false);
        setSheetSnapPosition('hidden');
        break;
      case 'settings':
        setViewMode('dataOnly');
        setSheetVisible(true);
        setSheetSnapPosition('half');
        break;
      case 'debug':
        setViewMode('dataOnly');
        setSheetVisible(true);
        setSheetSnapPosition('half');
        break;
    }
  }, [appScreen]);

  useEffect(() => {
    if (navigationActive) {
      setFollowMode(true);
    }
  }, [navigationActive]);

  const currentCoordinate = location ? getCoordinate(location) : null;

  const handleSetRouteDestination = useCallback(
    (destination: LatLng) => {
      if (!currentCoordinate) {
        return;
      }

      setDestinationResults([]);
      setNavigationRoute([currentCoordinate, destination]);
      setNavigationActive(true);
      setFollowMode(true);
      setAppScreen('map');
    },
    [currentCoordinate],
  );

  const clearNavigationRoute = useCallback(() => {
    setNavigationRoute([]);
    setNavigationActive(false);
    setDestinationResults([]);
    setDestinationQuery('');
    setSearchError(null);
  }, []);

  const formatAddressLabel = useCallback((address: Location.LocationGeocodedLocation) => {
    const addressParts = [
      (address as any).name,
      (address as any).street,
      (address as any).city,
      (address as any).region,
      (address as any).postalCode,
      (address as any).country,
    ].filter(Boolean);

    return addressParts.join(', ');
  }, []);

  const selectDestinationResult = useCallback(
    (result: Location.LocationGeocodedLocation) => {
      if (result.latitude == null || result.longitude == null) {
        return;
      }

      setDestinationQuery(formatAddressLabel(result));
      setDestinationResults([]);
      setSearchError(null);
      handleSetRouteDestination({ latitude: result.latitude, longitude: result.longitude });
    },
    [formatAddressLabel, handleSetRouteDestination],
  );

  const searchNavigationDestination = useCallback(async () => {
    const query = destinationQuery.trim();

    if (!query) {
      setSearchError('Bitte Ziel eingeben.');
      return;
    }

    setSearchLoading(true);
    setSearchError(null);

    try {
      const results = await Location.geocodeAsync(query);

      if (results.length === 0) {
        setSearchError('Kein Ziel gefunden.');
        setDestinationResults([]);
        return;
      }

      setDestinationResults(results.slice(0, 5));
      Keyboard.dismiss();

      const firstResult = results[0];

      if (firstResult.latitude != null && firstResult.longitude != null) {
        handleSetRouteDestination({ latitude: firstResult.latitude, longitude: firstResult.longitude });
      }
    } catch (error) {
      setSearchError('Suche fehlgeschlagen.');
      setDestinationResults([]);
    } finally {
      setSearchLoading(false);
    }
  }, [destinationQuery, handleSetRouteDestination]);
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

        if (isCalibrationData(parsedState.calibration)) {
          sensorActions.setCalibration(parsedState.calibration);
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

  const routeDistanceKm = navigationRoute.length > 1 ? getDistanceMeters(navigationRoute[0], navigationRoute[navigationRoute.length - 1]) / 1000 : 0;
  const isMapScreen = appScreen === 'map';
  const routeStatus = navigationActive ? 'Navigation aktiv' : navigationRoute.length > 1 ? 'Route Vorschau' : 'Ziel auswählen';

  // PanResponder for scaleless sliding with snap positions
  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_, gestureState) => {
        return Math.abs(gestureState.dy) > 5;
      },
      onPanResponderGrant: () => {
        sheetHeight.stopAnimation();
      },
      onPanResponderMove: (_, gestureState) => {
        const newHeight = Math.max(0, currentSheetHeight + gestureState.dy);
        setCurrentSheetHeight(newHeight);
        sheetHeight.setValue(newHeight);
      },
      onPanResponderRelease: (_, gestureState) => {
        const velocity = gestureState.vy;

        // Determine nearest snap position
        let targetPosition: 'full' | 'half' | 'hidden';
        const distances = {
          full: Math.abs(currentSheetHeight - sheetSnapHeights.full),
          half: Math.abs(currentSheetHeight - sheetSnapHeights.half),
          hidden: Math.abs(currentSheetHeight - sheetSnapHeights.hidden),
        };

        if (velocity > 0.5) {
          // Swiping down
          if (currentSheetHeight > sheetSnapHeights.half) {
            targetPosition = 'hidden';
          } else {
            targetPosition = 'half';
          }
        } else if (velocity < -0.5) {
          // Swiping up
          if (currentSheetHeight < sheetSnapHeights.half) {
            targetPosition = 'full';
          } else {
            targetPosition = 'half';
          }
        } else {
          // No velocity, snap to nearest
          targetPosition = (Object.keys(distances) as Array<'full' | 'half' | 'hidden'>).reduce(
            (nearest, pos) => distances[pos] < distances[nearest] ? pos : nearest,
            'full'
          );
        }

        setSheetSnapPosition(targetPosition);
        setCurrentSheetHeight(sheetSnapHeights[targetPosition]);
        Animated.spring(sheetHeight, {
          toValue: sheetSnapHeights[targetPosition],
          tension: 50,
          friction: 7,
          useNativeDriver: true,
        }).start();
      },
      onPanResponderTerminate: () => {
        setCurrentSheetHeight(sheetSnapHeights[sheetSnapPosition]);
        Animated.spring(sheetHeight, {
          toValue: sheetSnapHeights[sheetSnapPosition],
          tension: 50,
          friction: 7,
          useNativeDriver: true,
        }).start();
      },
    })
  ).current;

  const gaugeSize = Math.min(220, Math.max(160, screenWidth * 0.42));
  const cardColumnStyle = screenWidth < 360 ? styles.cardItemFull : styles.cardItem;

  const snapToPosition = useCallback((position: 'full' | 'half' | 'hidden') => {
    setSheetSnapPosition(position);
    setSheetVisible(position !== 'hidden');
    Animated.spring(sheetHeight, {
      toValue: sheetSnapHeights[position],
      tension: 50,
      friction: 7,
      useNativeDriver: true,
    }).start();
  }, [sheetSnapHeights, sheetHeight]);

  return (
    <View style={[styles.screen, { backgroundColor: PALETTE.background }]}> 
      <StatusBar style="light" />

      <View style={[
        styles.mapLayer,
        viewMode === 'dataOnly' && styles.mapLayerHidden,
        viewMode === 'focused' && styles.mapLayerFocused
      ]}>
        <MotorcycleMap 
          currentLocation={location} 
          route={route} 
          navigationRoute={navigationRoute}
          followMode={followMode}
          navigationActive={navigationActive}
          onMapLongPress={handleSetRouteDestination}
          onFollowModeToggle={() => setFollowMode(!followMode)}
          zoomLevel={viewMode === 'focused' ? 18 : zoomLevel}
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

      <View style={[styles.navigationBar, { backgroundColor: PALETTE.card, borderColor: PALETTE.border }]}> 
        <Pressable onPress={() => setAppScreen('dashboard')} style={({ pressed }) => [styles.navButton, pressed ? styles.navButtonPressed : null]}> 
          <Text selectable style={[styles.navButtonText, appScreen === 'dashboard' ? styles.navButtonTextActive : null]}>Dashboard</Text>
        </Pressable>
        <Pressable onPress={() => setAppScreen('map')} style={({ pressed }) => [styles.navButton, pressed ? styles.navButtonPressed : null]}> 
          <Text selectable style={[styles.navButtonText, appScreen === 'map' ? styles.navButtonTextActive : null]}>Map</Text>
        </Pressable>
        <Pressable onPress={() => setAppScreen('settings')} style={({ pressed }) => [styles.navButton, pressed ? styles.navButtonPressed : null]}> 
          <Text selectable style={[styles.navButtonText, appScreen === 'settings' ? styles.navButtonTextActive : null]}>Settings</Text>
        </Pressable>
        <Pressable onPress={() => setAppScreen('debug')} style={({ pressed }) => [styles.navButton, pressed ? styles.navButtonPressed : null]}> 
          <Text selectable style={[styles.navButtonText, appScreen === 'debug' ? styles.navButtonTextActive : null]}>Debug</Text>
        </Pressable>
      </View>

{(isMapScreen || navigationActive) && (
        <View style={[styles.routeSummaryCard, { backgroundColor: PALETTE.card, borderColor: PALETTE.border }]}> 
          <Text selectable style={[styles.routeCardTitle, { color: PALETTE.text }]}> 
            {navigationActive ? 'Navigation aktiv' : navigationRoute.length > 1 ? 'Route Vorschau' : 'Route vorbereiten'}
          </Text>
          <Text selectable style={[styles.routeCardSubtitle, { color: PALETTE.mutedText }]}> 
            {routeStatus}
            {navigationRoute.length > 1 ? ` • ${routeDistanceKm.toFixed(2)} km` : ''}
          </Text>

          <View style={styles.routeSearchRow}>
            <TextInput
              value={destinationQuery}
              onChangeText={(text) => {
                setDestinationQuery(text);
                setSearchError(null);
              }}
              onSubmitEditing={searchNavigationDestination}
              placeholder="Ziel suchen"
              placeholderTextColor={PALETTE.mutedText}
              style={[styles.routeSearchInput, { color: PALETTE.text, borderColor: PALETTE.border }]}
              returnKeyType="search"
              clearButtonMode="while-editing"
            />
            <Pressable
              onPress={searchNavigationDestination}
              style={({ pressed }) => [
                styles.searchButton,
                { backgroundColor: PALETTE.primary },
                pressed ? styles.pressedActionButton : null,
              ]}
            >
              {searchLoading ? (
                <ActivityIndicator color="#ffffff" />
              ) : (
                <Text selectable style={styles.searchButtonText}>Suchen</Text>
              )}
            </Pressable>
          </View>

          {searchError ? (
            <Text selectable style={[styles.searchErrorText, { color: PALETTE.danger }]}>{searchError}</Text>
          ) : null}

          {destinationResults.length > 0 ? (
            <View style={styles.searchResultsContainer}>
              {destinationResults.map((result, index) => (
                <Pressable
                  key={`${result.latitude}-${result.longitude}-${index}`}
                  onPress={() => selectDestinationResult(result)}
                  style={({ pressed }) => [
                    styles.searchResultItem,
                    { backgroundColor: pressed ? PALETTE.border : PALETTE.card },
                  ]}
                >
                  <Text selectable style={[styles.searchResultLabel, { color: PALETTE.text }]}> 
                    {formatAddressLabel(result)}
                  </Text>
                </Pressable>
              ))}
            </View>
          ) : null}

          {navigationRoute.length > 1 ? (
            <View style={styles.routeButtonRow}>
              <Pressable
                onPress={() => setNavigationActive((current) => !current)}
                style={({ pressed }) => [
                  styles.actionButton,
                  { backgroundColor: navigationActive ? PALETTE.danger : PALETTE.primary, flex: 1 },
                  pressed ? styles.pressedActionButton : null,
                ]}
              >
                <Text selectable style={[styles.actionButtonText, { color: '#ffffff' }]}> 
                  {navigationActive ? 'Navigation stoppen' : 'Navigation starten'}
                </Text>
              </Pressable>
              <Pressable
                onPress={clearNavigationRoute}
                style={({ pressed }) => [
                  styles.secondaryButton,
                  { backgroundColor: PALETTE.card, borderColor: PALETTE.border, flex: 1, marginLeft: 10 },
                  pressed ? styles.pressedActionButton : null,
                ]}
              >
                <Text selectable style={[styles.secondaryButtonText, { color: PALETTE.text }]}>Ziel löschen</Text>
              </Pressable>
            </View>
          ) : (
            <Text selectable style={[styles.routeInstructionText, { color: PALETTE.mutedText }]}> 
              Tippe lange auf die Karte oder suche nach einem Ziel, um die Navigation zu starten.
            </Text>
          )}
        </View>
      )}

      <View style={[styles.recordingPill, { backgroundColor: PALETTE.card }]}>
        <View style={[styles.recordingDot, { opacity: rideActive ? 1 : 0.35 }]} />
        <Text selectable style={[styles.recordingText, { color: PALETTE.text }]}>
          {rideActive ? 'REC' : 'DONE'} {rideTime}
        </Text>
      </View>

      {/* Floating button to show sheet when hidden */}
      {!sheetVisible && (
        <Pressable
          style={styles.floatingSheetButton}
          onPress={() => snapToPosition('full')}
        >
          <Text style={styles.floatingSheetButtonText}>📊</Text>
        </Pressable>
      )}

      <Animated.View
        style={[
          styles.bottomSheet,
          {
            backgroundColor: viewMode === 'focused' ? 'rgba(32, 38, 50, 0.95)' : PALETTE.card,
            transform: [{ translateY: sheetHeight }],
            maxHeight: screenHeight * 0.85,
            minHeight: screenHeight * 0.28,
          },
          viewMode === 'mapOnly' && styles.bottomSheetHidden,
        ]}
      >
        <View style={styles.sheetHandleWrapper}>
          <Pressable
            {...panResponder.panHandlers}
            onPress={() => snapToPosition(sheetSnapPosition === 'full' ? 'half' : 'full')}
            style={styles.sheetHandleContainer}
          >
            <View style={[styles.sheetHandle, { backgroundColor: PALETTE.border }]} />
          </Pressable>
        </View>

        {appScreen === 'dashboard' && (
          <View style={styles.viewModeControls}>
            <Text selectable style={[styles.viewModeLabel, { color: PALETTE.mutedText }]}>View Mode</Text>
            <View style={styles.viewModeButtons}>
              <SegmentButton active={viewMode === 'hybrid'} label="Hybrid" onPress={() => setViewMode('hybrid')} />
              <SegmentButton active={viewMode === 'mapOnly'} label="Map" onPress={() => setViewMode('mapOnly')} />
              <SegmentButton active={viewMode === 'dataOnly'} label="Data" onPress={() => setViewMode('dataOnly')} />
              <SegmentButton active={viewMode === 'focused'} label="Focused" onPress={() => setViewMode('focused')} />
            </View>
          </View>
        )}

        {appScreen === 'dashboard' ? (
          <ScrollView style={[styles.sheetScroll, { maxHeight: screenHeight * 0.72 }]} contentContainerStyle={styles.sheetScrollContent} showsVerticalScrollIndicator={false}>
            <View style={styles.leanGaugeContainer}>
              <LeanAngleGauge leanAngle={displayLeanAngle} maxLean={sensorState.maxLean} size={gaugeSize} />
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
                style={cardColumnStyle}
              />
              <DashboardCard
                title="Distance"
                value={metersToKilometers(distanceMeters).toFixed(2)}
                unit="km"
                detail={rideActive ? 'Current ride' : 'Ride stopped'}
                color={PALETTE.success}
                style={cardColumnStyle}
              />
              <DashboardCard
                title="Altitude"
                value={formatMaybeNumber(altitudeMeters, '')}
                unit="m"
                detail="GPS altitude"
                color={PALETTE.warning}
                style={cardColumnStyle}
              />
              <DashboardCard
                title="GPS"
                value={location ? getGpsQuality(gpsAccuracy) : '--'}
                detail={gpsAccuracy === null ? 'Waiting' : `${Math.round(gpsAccuracy)} m | ${gpsAgeSeconds ?? '--'} s`}
                color={PALETTE.success}
                style={cardColumnStyle}
              />
              <DashboardCard
                title="Max Lean"
                value={formatMaybeNumber(sensorState.maxLean, '')}
                unit="°"
                detail={`Last corner: ${formatMaybeNumber(sensorState.lastCornerLean, '°', 1)}`}
                color={PALETTE.accent}
                style={cardColumnStyle}
              />
              <DashboardCard
                title="Top Speed"
                value={topSpeedKmh.toFixed(0)}
                unit="km/h"
                detail="Ride max"
                color={PALETTE.primary}
                style={cardColumnStyle}
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

        {appScreen === 'settings' ? (
          <ScrollView style={[styles.sheetScroll, { maxHeight: screenHeight * 0.72 }]} contentContainerStyle={styles.sheetScrollContent} showsVerticalScrollIndicator={false}>
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

        {appScreen === 'debug' ? (
          <SensorDebugView
            debug={sensorState.debug}
            leanAngle={sensorState.leanAngle}
            calibration={sensorState.calibration}
            onSimulateAngle={handleSimulateLeanAngle}
          />
        ) : null}
      </Animated.View>
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
  mapLayerFocused: {
    opacity: 0.3,
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
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  topTitleBlock: {
    flex: 1,
    minWidth: 0,
  },
  navigationBar: {
    position: 'absolute',
    left: 18,
    right: 18,
    top: 122,
    zIndex: 10,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 14,
    paddingVertical: 8,
    paddingHorizontal: 8,
  },
  navButton: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    marginHorizontal: 4,
    borderRadius: 10,
  },
  navButtonPressed: {
    opacity: 0.7,
  },
  navButtonText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#cbd5e1',
  },
  navButtonTextActive: {
    color: '#ffffff',
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
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  recordingDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: PALETTE.danger,
    marginRight: 8,
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
    overflow: 'hidden',
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
  sheetHandleWrapper: {
    alignItems: 'center',
  },
  sheetHandleContainer: {
    alignItems: 'center',
    paddingVertical: 12,
  },
  panelTabs: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  routeSummaryCard: {
    position: 'absolute',
    left: 18,
    right: 18,
    top: 190,
    zIndex: 15,
    borderWidth: 1,
    borderRadius: 16,
    padding: 16,
    backgroundColor: PALETTE.card,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.18,
    shadowRadius: 10,
    elevation: 8,
  },
  routeCardTitle: {
    fontSize: 14,
    fontWeight: '700',
    marginBottom: 6,
  },
  routeCardSubtitle: {
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 12,
  },
  routeButtonRow: {
    flexDirection: 'row',
    width: '100%',
  },
  routeInstructionText: {
    fontSize: 13,
    fontWeight: '500',
    lineHeight: 18,
    marginTop: 4,
  },
  routeSearchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 10,
  },
  routeSearchInput: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 13,
    backgroundColor: '#111827',
  },
  searchButton: {
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  searchButtonText: {
    color: '#ffffff',
    fontWeight: '700',
    fontSize: 13,
  },
  searchResultsContainer: {
    marginBottom: 10,
  },
  searchResultItem: {
    borderWidth: 1,
    borderColor: PALETTE.border,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 8,
  },
  searchResultLabel: {
    fontSize: 13,
    fontWeight: '600',
  },
  searchErrorText: {
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 8,
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
    justifyContent: 'space-between',
  },
  segmentRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
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
    paddingBottom: 32,
  },
  sheetScroll: {
    flex: 1,
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
    justifyContent: 'space-between',
  },
  cardItem: {
    flexBasis: '48%',
    marginBottom: 12,
  },
  cardItemFull: {
    flexBasis: '100%',
    marginBottom: 12,
  },
  actionRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  actionButtonLeft: {
    marginRight: 12,
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
    marginBottom: 20,
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
  floatingSheetButton: {
    position: 'absolute',
    bottom: 20,
    right: 20,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#60a5fa',
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
  },
  floatingSheetButtonText: {
    fontSize: 24,
  },
});
