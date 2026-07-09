import React from 'react';
import { View, StyleSheet } from 'react-native';

interface LeanAngleGaugeProps {
  leanAngle: number | null;
  maxLean: number;
  size?: number;
}

export function LeanAngleGauge({ leanAngle, maxLean, size = 200 }: LeanAngleGaugeProps) {
  const absLean = leanAngle !== null ? Math.abs(leanAngle) : 0;
  const isRight = leanAngle !== null && leanAngle > 0;
  const isLeft = leanAngle !== null && leanAngle < 0;
  const maxAngle = 60;
  const percentage = Math.min(absLean / maxAngle, 1);

  return (
    <View style={[styles.container, { width: size, height: size }]}>
      {/* Background arc */}
      <View style={[styles.arc, styles.arcBackground]} />
      
      {/* Left lean indicator */}
      {isLeft && (
        <View
          style={[
            styles.arc,
            styles.arcLeft,
            {
              transform: [{ rotate: `${-90 + percentage * 90}deg` }],
            },
          ]}
        />
      )}
      
      {/* Right lean indicator */}
      {isRight && (
        <View
          style={[
            styles.arc,
            styles.arcRight,
            {
              transform: [{ rotate: `${90 - percentage * 90}deg` }],
            },
          ]}
        />
      )}

      {/* Center indicator */}
      <View style={styles.centerIndicator}>
        <View style={styles.centerDot} />
      </View>

      {/* Lean direction text */}
      <View style={styles.directionContainer}>
        <View style={[styles.directionBadge, isLeft && styles.directionBadgeActive]}>
          <View style={[styles.directionDot, isLeft && styles.directionDotActive]} />
        </View>
        <View style={[styles.directionBadge, isRight && styles.directionBadgeActive]}>
          <View style={[styles.directionDot, isRight && styles.directionDotActive]} />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'relative',
    justifyContent: 'center',
    alignItems: 'center',
  },
  arc: {
    position: 'absolute',
    width: '100%',
    height: '100%',
    borderRadius: 100,
    borderWidth: 12,
    borderTopWidth: 0,
    borderLeftWidth: 0,
    borderRightWidth: 0,
  },
  arcBackground: {
    borderColor: '#334155',
    opacity: 0.3,
  },
  arcLeft: {
    borderColor: '#f97316',
    opacity: 0.8,
    transform: [{ rotate: '-90deg' }],
  },
  arcRight: {
    borderColor: '#f97316',
    opacity: 0.8,
    transform: [{ rotate: '90deg' }],
  },
  centerIndicator: {
    position: 'absolute',
    justifyContent: 'center',
    alignItems: 'center',
  },
  centerDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#f8fafc',
  },
  directionContainer: {
    position: 'absolute',
    flexDirection: 'row',
    justifyContent: 'space-between',
    width: '80%',
    paddingHorizontal: 20,
  },
  directionBadge: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#334155',
    justifyContent: 'center',
    alignItems: 'center',
    opacity: 0.3,
  },
  directionBadgeActive: {
    backgroundColor: '#f97316',
    opacity: 1,
  },
  directionDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#f8fafc',
  },
  directionDotActive: {
    backgroundColor: '#f8fafc',
  },
});
