import { useCallback, useEffect, useRef, useState } from 'react';
import { DeviceMotion, type DeviceMotionMeasurement } from 'expo-sensors';
import { SensorFusionEngine, type LeanAngleData, type CalibrationData, LowPassFilter } from '../sensors/SensorFusion';

export type SensorStatus = 'starting' | 'live' | 'denied' | 'unavailable' | 'error';

export interface SensorManagerState {
  leanAngle: number | null;
  pitchAngle: number | null;
  rollAngle: number | null;
  yawAngle: number | null;
  status: SensorStatus;
  error: string | null;
  calibration: CalibrationData;
  maxLean: number;
  maxPitch: number;
  lastCornerLean: number | null;
  debug?: LeanAngleData['debug'];
}

export interface SensorManagerActions {
  calibrate: () => void;
  resetCalibration: () => void;
  resetMaxValues: () => void;
}

const UPDATE_INTERVAL_MS = 50; // 20Hz for smooth updates
const LEAN_THRESHOLD_DEG = 20; // Threshold for corner detection

export function useSensorManager(): [SensorManagerState, SensorManagerActions] {
  const [status, setStatus] = useState<SensorStatus>('starting');
  const [error, setError] = useState<string | null>(null);
  const [leanAngle, setLeanAngle] = useState<number | null>(null);
  const [pitchAngle, setPitchAngle] = useState<number | null>(null);
  const [rollAngle, setRollAngle] = useState<number | null>(null);
  const [yawAngle, setYawAngle] = useState<number | null>(null);
  const [calibration, setCalibration] = useState<CalibrationData>({
    leanOffset: 0,
    pitchOffset: 0,
    rollOffset: 0,
    yawOffset: 0,
    createdAt: Date.now(),
  });
  const [maxLean, setMaxLean] = useState(0);
  const [maxPitch, setMaxPitch] = useState(0);
  const [lastCornerLean, setLastCornerLean] = useState<number | null>(null);
  const [debug, setDebug] = useState<LeanAngleData['debug']>();

  const engineRef = useRef<SensorFusionEngine>(new SensorFusionEngine(0.98));
  const leanFilterRef = useRef<LowPassFilter>(new LowPassFilter(0.85));
  const pitchFilterRef = useRef<LowPassFilter>(new LowPassFilter(0.85));
  const lastMotionRef = useRef<DeviceMotionMeasurement | null>(null);

  const calibrate = useCallback(() => {
    const motion = lastMotionRef.current;
    if (!motion) {
      console.warn('Cannot calibrate: no motion data available');
      return;
    }

    engineRef.current.calibrate(motion);
    const newCalibration = engineRef.current.getCalibration();
    setCalibration(newCalibration);
    
    // Reset max values after calibration
    setMaxLean(0);
    setMaxPitch(0);
    setLastCornerLean(null);
    
    // Reset filters
    leanFilterRef.current.reset();
    pitchFilterRef.current.reset();
  }, []);

  const resetCalibration = useCallback(() => {
    engineRef.current.resetCalibration();
    const defaultCalibration = engineRef.current.getCalibration();
    setCalibration(defaultCalibration);
    
    setMaxLean(0);
    setMaxPitch(0);
    setLastCornerLean(null);
    
    leanFilterRef.current.reset();
    pitchFilterRef.current.reset();
  }, []);

  const resetMaxValues = useCallback(() => {
    setMaxLean(0);
    setMaxPitch(0);
    setLastCornerLean(null);
  }, []);

  useEffect(() => {
    let subscription: { remove: () => void } | null = null;
    let isMounted = true;

    async function startSensors() {
      try {
        setStatus('starting');
        setError(null);

        const available = await DeviceMotion.isAvailableAsync();

        if (!available) {
          if (isMounted) {
            setStatus('unavailable');
            setError('Device motion is not available on this device.');
          }
          return;
        }

        const permission = await DeviceMotion.requestPermissionsAsync();

        if (!isMounted) {
          return;
        }

        if (permission.status !== 'granted') {
          setStatus('denied');
          setError('Motion permission was denied.');
          return;
        }

        // Set update interval for smooth readings
        DeviceMotion.setUpdateInterval(UPDATE_INTERVAL_MS);

        subscription = DeviceMotion.addListener((motion) => {
          if (!isMounted) {
            return;
          }

          lastMotionRef.current = motion;

          try {
            // Process motion through sensor fusion engine
            const data: LeanAngleData = engineRef.current.processMotion(motion);

            // Apply low-pass filter for smooth output
            const filteredLean = data.leanAngle !== null 
              ? leanFilterRef.current.filter(data.leanAngle)
              : null;
            const filteredPitch = data.pitchAngle !== null
              ? pitchFilterRef.current.filter(data.pitchAngle)
              : null;

            // Update state
            setLeanAngle(filteredLean);
            setPitchAngle(filteredPitch);
            setRollAngle(data.rollAngle);
            setYawAngle(data.yawAngle);
            setDebug(data.debug);

            // Track max values
            if (filteredLean !== null) {
              const absLean = Math.abs(filteredLean);
              setMaxLean((current) => Math.max(current, absLean));

              // Track corner lean (when lean exceeds threshold)
              if (absLean >= LEAN_THRESHOLD_DEG) {
                setLastCornerLean(absLean);
              }
            }

            if (filteredPitch !== null) {
              const absPitch = Math.abs(filteredPitch);
              setMaxPitch((current) => Math.max(current, absPitch));
            }

            setStatus('live');
          } catch (err) {
            console.error('Error processing motion data:', err);
            if (isMounted) {
              setStatus('error');
              setError(err instanceof Error ? err.message : 'Motion processing failed.');
            }
          }
        });

        if (isMounted) {
          setStatus('live');
        }
      } catch (err) {
        if (isMounted) {
          setStatus('error');
          setError(err instanceof Error ? err.message : 'Motion sensor failed.');
        }
      }
    }

    startSensors();

    return () => {
      isMounted = false;
      subscription?.remove();
    };
  }, []);

  const state: SensorManagerState = {
    leanAngle,
    pitchAngle,
    rollAngle,
    yawAngle,
    status,
    error,
    calibration,
    maxLean,
    maxPitch,
    lastCornerLean,
    debug,
  };

  const actions: SensorManagerActions = {
    calibrate,
    resetCalibration,
    resetMaxValues,
  };

  return [state, actions];
}
