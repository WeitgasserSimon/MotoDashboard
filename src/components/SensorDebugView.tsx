import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable } from 'react-native';

interface SensorDebugViewProps {
  debug?: {
    quaternion: { w: number; x: number; y: number; z: number };
    gravity: { x: number; y: number; z: number };
    gyro: { x: number; y: number; z: number };
    euler: { roll: number; pitch: number; yaw: number };
    rawLeanAngle: number;
    calibratedLeanAngle: number;
    gravityLeanAngle: number;
    quaternionLeanAngle: number;
    rotationMatrix: { m11: number; m12: number; m0: number; m22: number };
    projectedGravity: { x: number; y: number; z: number };
  };
  leanAngle: number | null;
  calibration: { leanOffset: number; createdAt: number | null };
  onSimulateAngle?: (angle: number | null) => void;
}

export function SensorDebugView({ debug, leanAngle, calibration, onSimulateAngle }: SensorDebugViewProps) {
  const [simulatedAngle, setSimulatedAngle] = useState(0);
  const [useSimulation, setUseSimulation] = useState(false);

  const handleSimulate = (angle: number) => {
    setSimulatedAngle(angle);
    setUseSimulation(true);
    if (onSimulateAngle) {
      onSimulateAngle(angle);
    }
  };

  const handleResetSimulation = () => {
    setUseSimulation(false);
    setSimulatedAngle(0);
    if (onSimulateAngle) {
      onSimulateAngle(null);
    }
  };

  const testAngles = [0, 15, 30, 45, 60];

  if (!debug) {
    return (
      <View style={styles.container}>
        <Text style={styles.title}>Sensor Debug</Text>
        <Text style={styles.noData}>No debug data available</Text>
      </View>
    );
  }

  const displayLeanAngle = useSimulation ? simulatedAngle : leanAngle;

  return (
    <ScrollView style={styles.container}>
      <Text style={styles.title}>Sensor Debug</Text>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Lean Angle Comparison</Text>
        <DebugRow label="Final Lean Angle" value={displayLeanAngle?.toFixed(2) + '°'} />
        <DebugRow label="Quaternion Lean" value={debug.quaternionLeanAngle.toFixed(2) + '°'} />
        <DebugRow label="Gravity Lean" value={debug.gravityLeanAngle.toFixed(2) + '°'} />
        <DebugRow label="Raw Lean Angle" value={debug.rawLeanAngle.toFixed(2) + '°'} />
        <DebugRow label="Calibration Offset" value={calibration.leanOffset.toFixed(2) + '°'} />
        <DebugRow label="Simulation Mode" value={useSimulation ? 'ON' : 'OFF'} />
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Quaternion</Text>
        <DebugRow label="W" value={debug.quaternion.w.toFixed(4)} />
        <DebugRow label="X" value={debug.quaternion.x.toFixed(4)} />
        <DebugRow label="Y" value={debug.quaternion.y.toFixed(4)} />
        <DebugRow label="Z" value={debug.quaternion.z.toFixed(4)} />
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Gravity (Accelerometer)</Text>
        <DebugRow label="X" value={debug.gravity.x.toFixed(3)} />
        <DebugRow label="Y" value={debug.gravity.y.toFixed(3)} />
        <DebugRow label="Z" value={debug.gravity.z.toFixed(3)} />
        <DebugRow 
          label="Magnitude" 
          value={Math.sqrt(
            debug.gravity.x ** 2 + debug.gravity.y ** 2 + debug.gravity.z ** 2
          ).toFixed(3)} 
        />
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Gyroscope (rad/s)</Text>
        <DebugRow label="X (alpha)" value={debug.gyro.x.toFixed(3)} />
        <DebugRow label="Y (beta)" value={debug.gyro.y.toFixed(3)} />
        <DebugRow label="Z (gamma)" value={debug.gyro.z.toFixed(3)} />
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Rotation Matrix</Text>
        <DebugRow label="M11" value={debug.rotationMatrix.m11.toFixed(4)} />
        <DebugRow label="M12" value={debug.rotationMatrix.m12.toFixed(4)} />
        <DebugRow label="M0" value={debug.rotationMatrix.m0.toFixed(4)} />
        <DebugRow label="M22" value={debug.rotationMatrix.m22.toFixed(4)} />
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Euler Angles</Text>
        <DebugRow label="Roll" value={debug.euler.roll.toFixed(2) + '°'} />
        <DebugRow label="Pitch" value={debug.euler.pitch.toFixed(2) + '°'} />
        <DebugRow label="Yaw" value={debug.euler.yaw.toFixed(2) + '°'} />
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Angle Simulation Test</Text>
        <Text style={styles.instruction}>
          Test lean angle calculation at specific angles:
        </Text>
        <View style={styles.angleButtons}>
          {testAngles.map((angle) => (
            <Pressable
              key={angle}
              style={[
                styles.angleButton,
                simulatedAngle === angle && styles.angleButtonActive,
              ]}
              onPress={() => handleSimulate(angle)}
            >
              <Text style={[
                styles.angleButtonText,
                simulatedAngle === angle && styles.angleButtonTextActive,
              ]}>
                {angle}°
              </Text>
            </Pressable>
          ))}
        </View>
        <View style={styles.angleButtons}>
          <Pressable
            style={styles.angleButton}
            onPress={() => handleSimulate(simulatedAngle - 5)}
          >
            <Text style={styles.angleButtonText}>-5°</Text>
          </Pressable>
          <Pressable
            style={styles.angleButton}
            onPress={() => handleSimulate(simulatedAngle + 5)}
          >
            <Text style={styles.angleButtonText}>+5°</Text>
          </Pressable>
          <Pressable
            style={[styles.angleButton, styles.angleButtonReset]}
            onPress={handleResetSimulation}
          >
            <Text style={styles.angleButtonText}>Reset</Text>
          </Pressable>
        </View>
        <Text style={styles.instruction}>
          Compare simulated angle with actual sensor reading
        </Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Test Instructions</Text>
        <Text style={styles.instruction}>
          1. Place phone flat on table → should show ~0°
        </Text>
        <Text style={styles.instruction}>
          2. Tilt phone left → should show negative angle
        </Text>
        <Text style={styles.instruction}>
          3. Tilt phone right → should show positive angle
        </Text>
        <Text style={styles.instruction}>
          4. Test at 30°, 45°, 60° using a protractor
        </Text>
        <Text style={styles.instruction}>
          5. Use simulation buttons to verify calculation
        </Text>
      </View>
    </ScrollView>
  );
}

function DebugRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.value}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#12151b',
    padding: 16,
  },
  title: {
    fontSize: 20,
    fontWeight: '800',
    color: '#f8fafc',
    marginBottom: 16,
  },
  noData: {
    fontSize: 14,
    color: '#94a3b8',
  },
  section: {
    backgroundColor: '#202632',
    borderRadius: 12,
    padding: 12,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#334155',
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#60a5fa',
    marginBottom: 8,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 4,
  },
  label: {
    fontSize: 12,
    color: '#94a3b8',
    fontWeight: '500',
  },
  value: {
    fontSize: 12,
    color: '#f8fafc',
    fontWeight: '600',
    fontFamily: 'monospace',
  },
  instruction: {
    fontSize: 12,
    color: '#cbd5e1',
    marginBottom: 6,
    lineHeight: 16,
  },
  angleButtons: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 8,
  },
  angleButton: {
    backgroundColor: '#334155',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    minWidth: 50,
    alignItems: 'center',
  },
  angleButtonActive: {
    backgroundColor: '#60a5fa',
  },
  angleButtonText: {
    fontSize: 12,
    color: '#f8fafc',
    fontWeight: '600',
  },
  angleButtonTextActive: {
    color: '#ffffff',
  },
  angleButtonReset: {
    backgroundColor: '#ef4444',
  },
});
