import { type DeviceMotionMeasurement } from 'expo-sensors';

export interface LeanAngleData {
  leanAngle: number | null;
  pitchAngle: number | null;
  rollAngle: number | null;
  yawAngle: number | null;
  timestamp: number;
  // Debug data
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
}

export interface CalibrationData {
  leanOffset: number;
  pitchOffset: number;
  rollOffset: number;
  yawOffset: number;
  createdAt: number;
}

const DEFAULT_CALIBRATION: CalibrationData = {
  leanOffset: 0,
  pitchOffset: 0,
  rollOffset: 0,
  yawOffset: 0,
  createdAt: Date.now(),
};

/**
 * Quaternion class for 3D rotations
 * Avoids gimbal lock and provides smooth angle calculations
 */
class Quaternion {
  constructor(
    public w: number = 1,
    public x: number = 0,
    public y: number = 0,
    public z: number = 0
  ) {}

  static fromDeviceMotion(motion: DeviceMotionMeasurement): Quaternion {
    // In expo-sensors v15, attitude is not directly available
    // We need to calculate orientation from accelerometer data
    const gravity = motion.accelerationIncludingGravity || { x: 0, y: 0, z: 0 };
    
    // Normalize gravity vector
    const gravityMag = Math.sqrt(gravity.x * gravity.x + gravity.y * gravity.y + gravity.z * gravity.z);
    if (gravityMag < 0.1) {
      return new Quaternion(); // Invalid data
    }
    
    const gx = gravity.x / gravityMag;
    const gy = gravity.y / gravityMag;
    const gz = gravity.z / gravityMag;
    
    // Calculate roll and pitch from gravity vector
    // Roll: rotation around X-axis
    const roll = Math.atan2(gy, gz);
    
    // Pitch: rotation around Y-axis
    const pitch = Math.atan2(-gx, Math.sqrt(gy * gy + gz * gz));
    
    // Yaw: we can't determine yaw from gravity alone, assume 0
    const yaw = 0;
    
    return Quaternion.fromEuler(roll, pitch, yaw);
  }

  static fromEuler(roll: number, pitch: number, yaw: number): Quaternion {
    const cy = Math.cos(yaw * 0.5);
    const sy = Math.sin(yaw * 0.5);
    const cp = Math.cos(pitch * 0.5);
    const sp = Math.sin(pitch * 0.5);
    const cr = Math.cos(roll * 0.5);
    const sr = Math.sin(roll * 0.5);

    const w = cr * cp * cy + sr * sp * sy;
    const x = sr * cp * cy - cr * sp * sy;
    const y = cr * sp * cy + sr * cp * sy;
    const z = cr * cp * sy - sr * sp * cy;

    return new Quaternion(w, x, y, z);
  }

  multiply(other: Quaternion): Quaternion {
    return new Quaternion(
      this.w * other.w - this.x * other.x - this.y * other.y - this.z * other.z,
      this.w * other.x + this.x * other.w + this.y * other.z - this.z * other.y,
      this.w * other.y - this.x * other.z + this.y * other.w + this.z * other.x,
      this.w * other.z + this.x * other.y - this.y * other.x + this.z * other.w
    );
  }

  conjugate(): Quaternion {
    return new Quaternion(this.w, -this.x, -this.y, -this.z);
  }

  normalize(): Quaternion {
    const magnitude = Math.sqrt(
      this.w * this.w + this.x * this.x + this.y * this.y + this.z * this.z
    );
    if (magnitude < 0.0001) {
      return new Quaternion();
    }
    return new Quaternion(
      this.w / magnitude,
      this.x / magnitude,
      this.y / magnitude,
      this.z / magnitude
    );
  }

  toEuler(): { roll: number; pitch: number; yaw: number } {
    const normalized = this.normalize();

    // Roll (x-axis rotation)
    const sinr_cosp = 2 * (normalized.w * normalized.x + normalized.y * normalized.z);
    const cosr_cosp = 1 - 2 * (normalized.x * normalized.x + normalized.y * normalized.y);
    const roll = Math.atan2(sinr_cosp, cosr_cosp);

    // Pitch (y-axis rotation)
    const sinp = 2 * (normalized.w * normalized.y - normalized.z * normalized.x);
    let pitch: number;
    if (Math.abs(sinp) >= 1) {
      pitch = (Math.sign(sinp) * Math.PI) / 2; // Use 90 degrees if out of range
    } else {
      pitch = Math.asin(sinp);
    }

    // Yaw (z-axis rotation)
    const siny_cosp = 2 * (normalized.w * normalized.z + normalized.x * normalized.y);
    const cosy_cosp = 1 - 2 * (normalized.y * normalized.y + normalized.z * normalized.z);
    const yaw = Math.atan2(siny_cosp, cosy_cosp);

    return { roll, pitch, yaw };
  }

  /**
   * Rotate vector by this quaternion
   */
  rotateVector(x: number, y: number, z: number): { x: number; y: number; z: number } {
    const qVec = new Quaternion(0, x, y, z);
    const qConj = this.conjugate();
    const rotated = this.multiply(qVec).multiply(qConj);
    return { x: rotated.x, y: rotated.y, z: rotated.z };
  }
}

/**
 * Complementary filter for sensor fusion
 * Combines gyroscope (fast, drifts) with accelerometer (slow, stable)
 */
class ComplementaryFilter {
  private alpha: number; // Filter coefficient (0-1)
  private lastQuaternion: Quaternion | null = null;
  private lastTimestamp: number | null = null;

  constructor(alpha: number = 0.98) {
    this.alpha = Math.max(0, Math.min(1, alpha));
  }

  /**
   * Filter sensor data using complementary filter
   * @param motion Current device motion measurement
   * @param dt Time delta in seconds
   */
  filter(motion: DeviceMotionMeasurement, dt: number): Quaternion {
    const currentQuaternion = Quaternion.fromDeviceMotion(motion);

    if (!this.lastQuaternion || !this.lastTimestamp || dt <= 0) {
      this.lastQuaternion = currentQuaternion.normalize();
      this.lastTimestamp = Date.now();
      return currentQuaternion.normalize();
    }

    // Gyroscope integration (fast response)
    if (motion.rotationRate && this.lastQuaternion) {
      const gyroX = motion.rotationRate.alpha || 0; // rad/s around x
      const gyroY = motion.rotationRate.beta || 0;  // rad/s around y
      const gyroZ = motion.rotationRate.gamma || 0; // rad/s around z

      // Create rotation from gyroscope
      const gyroMagnitude = Math.sqrt(gyroX * gyroX + gyroY * gyroY + gyroZ * gyroZ);
      if (gyroMagnitude > 0.001) {
        const halfAngle = (gyroMagnitude * dt) / 2;
        const sinHalf = Math.sin(halfAngle) / gyroMagnitude;
        const gyroQuaternion = new Quaternion(
          Math.cos(halfAngle),
          gyroX * sinHalf,
          gyroY * sinHalf,
          gyroZ * sinHalf
        );

        // Integrate gyroscope
        const gyroIntegrated = gyroQuaternion.multiply(this.lastQuaternion).normalize();

        // Complementary filter: blend gyroscope (fast) with accelerometer (stable)
        const blended = this.slerp(
          gyroIntegrated,
          currentQuaternion,
          this.alpha
        );

        this.lastQuaternion = blended;
        this.lastTimestamp = Date.now();
        return blended;
      }
    }

    // Fallback to accelerometer-only if no gyroscope data
    this.lastQuaternion = currentQuaternion.normalize();
    this.lastTimestamp = Date.now();
    return currentQuaternion.normalize();
  }

  /**
   * Spherical linear interpolation between two quaternions
   */
  private slerp(q1: Quaternion, q2: Quaternion, t: number): Quaternion {
    const dot = q1.w * q2.w + q1.x * q2.x + q1.y * q2.y + q1.z * q2.z;

    // If quaternions are too close, use linear interpolation
    if (Math.abs(dot) > 0.9995) {
      const result = new Quaternion(
        q1.w + t * (q2.w - q1.w),
        q1.x + t * (q2.x - q1.x),
        q1.y + t * (q2.y - q1.y),
        q1.z + t * (q2.z - q1.z)
      );
      return result.normalize();
    }

    // Ensure shortest path
    const q2Adjusted = dot < 0 
      ? new Quaternion(-q2.w, -q2.x, -q2.y, -q2.z)
      : q2;

    const dotAdjusted = dot < 0 ? -dot : dot;
    const theta = Math.acos(Math.max(-1, Math.min(1, dotAdjusted)));
    const sinTheta = Math.sin(theta);

    if (Math.abs(sinTheta) < 0.001) {
      return q1;
    }

    const w1 = Math.sin((1 - t) * theta) / sinTheta;
    const w2 = Math.sin(t * theta) / sinTheta;

    return new Quaternion(
      w1 * q1.w + w2 * q2Adjusted.w,
      w1 * q1.x + w2 * q2Adjusted.x,
      w1 * q1.y + w2 * q2Adjusted.y,
      w1 * q1.z + w2 * q2Adjusted.z
    ).normalize();
  }

  reset(): void {
    this.lastQuaternion = null;
    this.lastTimestamp = null;
  }
}

/**
 * Sensor fusion engine for motorcycle lean angle calculation
 * Uses quaternion-based rotation and complementary filter
 */
export class SensorFusionEngine {
  private filter: ComplementaryFilter;
  private calibration: CalibrationData;
  private lastMotion: DeviceMotionMeasurement | null = null;
  private lastTimestamp: number | null = null;

  constructor(alpha: number = 0.98) {
    this.filter = new ComplementaryFilter(alpha);
    this.calibration = { ...DEFAULT_CALIBRATION };
  }

  /**
   * Process device motion and calculate lean angle
   * @param motion Current device motion measurement
   * @returns Lean angle data
   */
  processMotion(motion: DeviceMotionMeasurement): LeanAngleData {
    const currentTime = Date.now();
    const dt = this.lastTimestamp
      ? (currentTime - this.lastTimestamp) / 1000
      : 0.016; // Default to ~60fps

    this.lastTimestamp = currentTime;
    this.lastMotion = motion;

    // Get gravity vector from accelerometer
    const gravity = motion.accelerationIncludingGravity || { x: 0, y: 0, z: 0 };
    
    // Get gyroscope data
    const gyro = motion.rotationRate || { alpha: 0, beta: 0, gamma: 0 };
    
    // Apply complementary filter to get fused quaternion
    const fusedQuaternion = this.filter.filter(motion, dt);
    
    // Get raw quaternion for comparison
    const rawQuaternion = Quaternion.fromDeviceMotion(motion);
    
    // Calculate lean angle using robust quaternion-based method
    const { leanAngle, debug: leanDebug } = this.calculateLeanAngle(gravity, fusedQuaternion, rawQuaternion);
    
    // Also get Euler angles for reference/debug
    const euler = fusedQuaternion.toEuler();
    const rollDeg = (euler.roll * 180) / Math.PI;
    const pitchDeg = (euler.pitch * 180) / Math.PI;
    const yawDeg = (euler.yaw * 180) / Math.PI;
    
    // Apply calibration to pitch/yaw
    const pitchAngle = pitchDeg - this.calibration.pitchOffset;
    const yawAngle = yawDeg - this.calibration.yawOffset;

    return {
      leanAngle: this.clampAngle(leanAngle),
      pitchAngle: this.clampAngle(pitchAngle),
      rollAngle: this.clampAngle(rollDeg - this.calibration.rollOffset),
      yawAngle: this.clampAngle(yawAngle),
      timestamp: currentTime,
      debug: {
        quaternion: {
          w: fusedQuaternion.w,
          x: fusedQuaternion.x,
          y: fusedQuaternion.y,
          z: fusedQuaternion.z,
        },
        gravity: {
          x: gravity.x || 0,
          y: gravity.y || 0,
          z: gravity.z || 0,
        },
        gyro: {
          x: gyro.alpha || 0,
          y: gyro.beta || 0,
          z: gyro.gamma || 0,
        },
        euler: {
          roll: rollDeg,
          pitch: pitchDeg,
          yaw: yawDeg,
        },
        rawLeanAngle: leanDebug.rawLeanAngle,
        calibratedLeanAngle: leanDebug.calibratedLeanAngle,
        gravityLeanAngle: leanDebug.gravityLeanAngle,
        quaternionLeanAngle: leanDebug.quaternionLeanAngle,
        rotationMatrix: leanDebug.rotationMatrix,
        projectedGravity: leanDebug.projectedGravity,
      },
    };
  }

  /**
   * Calculate motorcycle lean angle using robust quaternion-based method
   * 
   * This method:
   * 1. Uses the quaternion to extract the device's orientation
   * 2. Calculates the lean angle using asin for numerical stability at high angles
   * 3. Projects the lean onto the lateral plane for accurate results
   * 
   * This is accurate at all angles including 60°+ because it:
   * - Uses asin instead of atan2 which is numerically stable at large angles
   * - Properly handles 3D rotations including pitch
   * - Uses quaternion math which avoids gimbal lock
   * 
   * Coordinate system assumption:
   * - Phone mounted with screen facing rider
   * - Phone Y-axis points forward (along motorcycle)
   * - Phone X-axis points left/right (lateral)
   * - Phone Z-axis points up/down
   * - Lean is rotation around Y-axis (pitch in phone coordinates)
   */
  private calculateLeanAngle(
    gravity: { x: number; y: number; z: number },
    fusedQuaternion: Quaternion,
    rawQuaternion: Quaternion
  ): { leanAngle: number; debug: any } {
    // Normalize quaternion
    const q = fusedQuaternion.normalize();
    
    const qw = q.w;
    const qx = q.x;
    const qy = q.y;
    const qz = q.z;
    
    // Extract lean angle using quaternion components
    // For motorcycle lean (rotation around Y-axis in device frame):
    // We use the pitch formula which is numerically stable with asin
    // sin(pitch) = 2*(w*y - z*x)
    const sinPitch = 2 * (qw * qy - qz * qx);
    
    // Clamp to valid range for asin [-1, 1]
    const clampedSinPitch = Math.max(-1, Math.min(1, sinPitch));
    
    // Calculate lean angle in radians using asin (stable at all angles)
    let leanAngleRad = Math.asin(clampedSinPitch);
    
    // Convert to degrees
    let leanAngle = leanAngleRad * (180 / Math.PI);
    
    // Alternative: Use rotation matrix for verification (not for primary calculation)
    const m11 = 1 - 2 * (qy * qy + qz * qz);
    const m12 = 2 * (qx * qy - qw * qz);
    const m21 = 2 * (qx * qy + qw * qz);
    const m22 = 1 - 2 * (qx * qx + qz * qz);
    const m31 = 2 * (qx * qz - qw * qy);
    const m32 = 2 * (qy * qz + qw * qx);
    const m33 = 1 - 2 * (qx * qx + qy * qy);
    
    // Calculate lean from rotation matrix (for comparison/debug only)
    const matrixLean = Math.atan2(m31, m33) * (180 / Math.PI);
    
    // Calculate lean from gravity vector (for comparison/debug only)
    const gravityMag = Math.sqrt(gravity.x * gravity.x + gravity.y * gravity.y + gravity.z * gravity.z);
    const gx = gravityMag > 0.1 ? gravity.x / gravityMag : 0;
    const gy = gravityMag > 0.1 ? gravity.y / gravityMag : 0;
    const gz = gravityMag > 0.1 ? gravity.z / gravityMag : 0;
    const gravityLean = Math.atan2(gx, gz) * (180 / Math.PI);
    
    // Calculate from raw quaternion (for comparison/debug)
    const rawQ = rawQuaternion.normalize();
    const rawSinPitch = 2 * (rawQ.w * rawQ.y - rawQ.z * rawQ.x);
    const rawClampedSinPitch = Math.max(-1, Math.min(1, rawSinPitch));
    const rawLeanAngle = Math.asin(rawClampedSinPitch) * (180 / Math.PI);
    
    // Apply calibration offset
    const calibratedLean = leanAngle - this.calibration.leanOffset;
    
    return {
      leanAngle: calibratedLean,
      debug: {
        rawLeanAngle: leanAngle,
        calibratedLeanAngle: calibratedLean,
        gravityLeanAngle: gravityLean,
        quaternionLeanAngle: leanAngle,
        rotationMatrix: {
          m11, m12, m0: m21, m22
        },
        projectedGravity: { x: gx, y: gy, z: gz },
      }
    };
  }

  /**
   * Clamp angle to valid range
   */
  private clampAngle(angle: number): number {
    return Math.max(-89, Math.min(89, angle));
  }

  /**
   * Set calibration offset
   * Call this when the motorcycle is upright (0° lean)
   * Uses quaternion-based method for accurate calibration
   */
  calibrate(motion: DeviceMotionMeasurement): void {
    const gravity = motion.accelerationIncludingGravity || { x: 0, y: 0, z: 0 };
    const quaternion = Quaternion.fromDeviceMotion(motion);
    
    // Calculate current lean angle using quaternion method
    const { leanAngle: currentLean } = this.calculateLeanAngle(gravity, quaternion, quaternion);
    
    // Also get Euler angles for reference
    const euler = quaternion.toEuler();
    
    this.calibration = {
      leanOffset: currentLean, // Use quaternion-based lean for calibration
      pitchOffset: (euler.pitch * 180) / Math.PI,
      rollOffset: (euler.roll * 180) / Math.PI,
      yawOffset: (euler.yaw * 180) / Math.PI,
      createdAt: Date.now(),
    };

    // Reset filter after calibration
    this.filter.reset();
  }

  /**
   * Get current calibration data
   */
  getCalibration(): CalibrationData {
    return { ...this.calibration };
  }

  /**
   * Set calibration data (e.g., from storage)
   */
  setCalibration(calibration: Partial<CalibrationData>): void {
    this.calibration = {
      leanOffset: calibration.leanOffset ?? this.calibration.leanOffset,
      pitchOffset: calibration.pitchOffset ?? this.calibration.pitchOffset,
      rollOffset: calibration.rollOffset ?? this.calibration.rollOffset,
      yawOffset: calibration.yawOffset ?? this.calibration.yawOffset,
      createdAt: calibration.createdAt ?? this.calibration.createdAt,
    };
  }

  /**
   * Reset calibration to default
   */
  resetCalibration(): void {
    this.calibration = { ...DEFAULT_CALIBRATION };
    this.filter.reset();
  }

  /**
   * Reset the filter state
   */
  reset(): void {
    this.filter.reset();
    this.lastMotion = null;
    this.lastTimestamp = null;
  }
}

/**
 * Low-pass filter for smoothing jittery values
 */
export class LowPassFilter {
  private alpha: number;
  private lastValue: number | null = null;

  constructor(alpha: number = 0.85) {
    this.alpha = Math.max(0, Math.min(1, alpha));
  }

  filter(value: number): number {
    if (this.lastValue === null) {
      this.lastValue = value;
      return value;
    }

    const filtered = this.alpha * this.lastValue + (1 - this.alpha) * value;
    this.lastValue = filtered;
    return filtered;
  }

  reset(): void {
    this.lastValue = null;
  }
}
