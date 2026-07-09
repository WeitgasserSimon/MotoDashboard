import React, { useEffect, useRef, useState, useCallback } from 'react';
import { View, StyleSheet, ActivityIndicator, Text, Pressable } from 'react-native';
import MapView, { Marker, Polyline, type LatLng, type Region } from 'react-native-maps';
import * as Location from 'expo-location';

interface MotorcycleMapProps {
  currentLocation: Location.LocationObject | null;
  route: LatLng[];
  followMode: boolean;
  onRegionChange?: (region: Region) => void;
  onFollowModeToggle?: () => void;
  zoomLevel?: number;
}

export function MotorcycleMap({ 
  currentLocation, 
  route, 
  followMode, 
  onRegionChange, 
  onFollowModeToggle,
  zoomLevel = 16
}: MotorcycleMapProps) {
  const [isReady, setIsReady] = useState(false);
  const [initialRegion, setInitialRegion] = useState<Region | undefined>(undefined);
  const [currentRegion, setCurrentRegion] = useState<Region | undefined>(undefined);
  const [userInteracted, setUserInteracted] = useState(false);
  const mapRef = useRef<MapView>(null);
  const lastLocationRef = useRef<LatLng | null>(null);

  const currentCoordinate = currentLocation
    ? {
        latitude: currentLocation.coords.latitude,
        longitude: currentLocation.coords.longitude,
      }
    : null;

  // Initialize map with first location
  useEffect(() => {
    if (currentCoordinate && !initialRegion) {
      const region: Region = {
        latitude: currentCoordinate.latitude,
        longitude: currentCoordinate.longitude,
        latitudeDelta: 0.006,
        longitudeDelta: 0.006,
      };
      setInitialRegion(region);
      setCurrentRegion(region);
      setIsReady(true);
    }
  }, [currentCoordinate, initialRegion]);

  // Follow mode: animate camera to current location
  useEffect(() => {
    if (followMode && isReady && currentCoordinate && mapRef.current) {
      // Only animate if location changed significantly
      const lastLoc = lastLocationRef.current;
      if (!lastLoc || 
          Math.abs(currentCoordinate.latitude - lastLoc.latitude) > 0.00001 ||
          Math.abs(currentCoordinate.longitude - lastLoc.longitude) > 0.00001) {
        mapRef.current.animateCamera({
          center: currentCoordinate,
          zoom: zoomLevel,
        }, { duration: 500 });
        lastLocationRef.current = currentCoordinate;
      }
    }
  }, [currentCoordinate, followMode, isReady, zoomLevel]);

  // Handle user interaction (pan/zoom)
  const handleRegionChangeComplete = useCallback((region: Region) => {
    setCurrentRegion(region);
    setUserInteracted(true);
    if (onRegionChange) {
      onRegionChange(region);
    }
  }, [onRegionChange]);

  // Toggle follow mode
  const toggleFollowMode = useCallback(() => {
    if (onFollowModeToggle) {
      onFollowModeToggle();
    }
    // Reset user interaction flag when entering follow mode
    if (!followMode) {
      setUserInteracted(false);
    }
  }, [followMode, onFollowModeToggle]);

  if (!isReady || !initialRegion) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#60a5fa" />
        <Text style={styles.loadingText}>Warte auf GPS...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <MapView
        ref={mapRef}
        style={styles.map}
        initialRegion={initialRegion}
        region={currentRegion}
        onRegionChangeComplete={handleRegionChangeComplete}
        showsUserLocation={false}
        showsMyLocationButton={false}
        followsUserLocation={false}
        loadingEnabled
        loadingBackgroundColor="#12151b"
        loadingIndicatorColor="#60a5fa"
        zoomEnabled={true}
        rotateEnabled={true}
        scrollEnabled={true}
        pitchEnabled={false}
      >
        {currentCoordinate && (
          <Marker
            coordinate={currentCoordinate}
            title="Aktuelle Position"
            description={currentLocation?.coords.speed 
              ? `${(currentLocation.coords.speed * 3.6).toFixed(0)} km/h`
              : 'Stehend'
          }
          />
        )}
        
        {route.length > 1 && (
          <Polyline
            coordinates={route}
            strokeColor="#60a5fa"
            strokeWidth={4}
            lineCap="round"
            lineJoin="round"
          />
        )}
      </MapView>
      
      {/* Follow Mode Toggle Button */}
      <Pressable
        style={[
          styles.followButton,
          { backgroundColor: followMode ? '#22c55e' : '#334155' }
        ]}
        onPress={toggleFollowMode}
      >
        <Text style={styles.followButtonText}>
          {followMode ? '🎯' : '📍'}
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  map: {
    ...StyleSheet.absoluteFillObject,
  },
  loadingContainer: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#12151b',
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    marginTop: 12,
    fontSize: 14,
    color: '#cbd5e1',
    fontWeight: '500',
  },
  followButton: {
    position: 'absolute',
    bottom: 20,
    right: 20,
    width: 50,
    height: 50,
    borderRadius: 25,
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 5,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
  },
  followButtonText: {
    fontSize: 24,
  },
});
