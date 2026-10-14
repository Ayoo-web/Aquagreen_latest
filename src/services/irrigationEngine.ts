import {
  AutomationSettings,
  CalibrationSettings,
  IrrigationEvent,
  SensorReading
} from '../types';

export interface DecisionResult {
  action: 'MAINTAIN_OFF' | 'MAINTAIN_ON' | 'START_PUMP' | 'STOP_PUMP' | 'EMERGENCY_STOP';
  stateLabel: string;
  reason: string;
  isPermitted: boolean;
  activeFault?: string;
}

/**
 * Calibrates raw 12-bit ADC reading (0-4095) to soil moisture percentage (0-100%)
 * Handles inverted analog soil sensor characteristics
 */
export function rawAdcToMoisturePercent(
  rawAdc: number,
  calibration: CalibrationSettings
): { percent: number; isFault: boolean; faultReason?: string } {
  // Check for open-circuit / disconnected probe (typically holds at 4095 on ESP32 pull-up)
  if (rawAdc >= 4090) {
    return {
      percent: 0,
      isFault: true,
      faultReason: 'ADC reading at 4095 maximum limit. Possible open-circuit or disconnected probe.'
    };
  }

  // Check for shorted probe
  if (rawAdc <= 10) {
    return {
      percent: 100,
      isFault: true,
      faultReason: 'ADC reading at 0 minimum limit. Possible sensor short-circuit.'
    };
  }

  const { soilDryAdc, soilWetAdc } = calibration;
  const range = soilDryAdc - soilWetAdc;
  if (range <= 0) {
    return { percent: 50, isFault: false };
  }

  // Linear interpolation: higher ADC = drier soil, lower ADC = wetter soil
  const unrounded = ((soilDryAdc - rawAdc) / range) * 100;
  const percent = Math.min(100, Math.max(0, Math.round(unrounded)));

  return { percent, isFault: false };
}

/**
 * Autonomous irrigation automation and safety rules evaluator
 */
export function evaluateAutomationDecision(
  latestReading: SensorReading | null,
  automation: AutomationSettings,
  calibration: CalibrationSettings,
  activePumpDurationSeconds: number,
  recentEvents: IrrigationEvent[],
  lastStopTime: number | null
): DecisionResult {
  // 1. Emergency Stop overrides all actions unconditionally
  if (automation.emergencyStop) {
    return {
      action: 'EMERGENCY_STOP',
      stateLabel: 'Emergency Stopped',
      reason: 'Emergency Stop latch is engaged by operator. Pump is locked in safe de-energized state.',
      isPermitted: false
    };
  }

  // 2. Hardware telemetry health checks
  if (!latestReading) {
    return {
      action: 'MAINTAIN_OFF',
      stateLabel: 'Awaiting Telemetry',
      reason: 'No sensor telemetry received from ESP32 controller.',
      isPermitted: false
    };
  }

  // Check for sensor fault (ADC open-circuit 4095)
  const { isFault, faultReason } = rawAdcToMoisturePercent(latestReading.soilMoistureRaw, calibration);
  if (isFault) {
    return {
      action: 'STOP_PUMP',
      stateLabel: 'Blocked by Sensor Fault',
      reason: faultReason || 'Soil moisture sensor error. Automatic irrigation paused.',
      isPermitted: false,
      activeFault: faultReason
    };
  }

  // Do not infer dry soil or dry weather from unavailable/calibration-blocked values.
  if (latestReading.soilMoisturePercent == null || !Number.isFinite(latestReading.soilMoisturePercent)) {
    const pumpActive = latestReading.pumpState;
    return {
      action: pumpActive ? 'STOP_PUMP' : 'MAINTAIN_OFF',
      stateLabel: 'Blocked by Unavailable Soil Data',
      reason: 'Soil moisture percentage is unavailable. Automatic irrigation is held off until soil calibration/reading is valid.',
      isPermitted: false,
      activeFault: 'SOIL_MOISTURE_UNAVAILABLE'
    };
  }

  // If rain inhibition is enabled, unknown rain status is not the same as dry weather.
  if (automation.rainInhibitionEnabled && latestReading.rainDetected == null) {
    const pumpActive = latestReading.pumpState;
    return {
      action: pumpActive ? 'STOP_PUMP' : 'MAINTAIN_OFF',
      stateLabel: 'Blocked by Unavailable Rain Data',
      reason: 'Rain sensor status is unavailable. The system will not assume dry weather.',
      isPermitted: false,
      activeFault: 'RAIN_SENSOR_UNAVAILABLE'
    };
  }

  // 3. Rain inhibition policy
  if (automation.rainInhibitionEnabled && latestReading.rainDetected === true) {
    return {
      action: 'STOP_PUMP',
      stateLabel: 'Blocked by Rain Inhibit',
      reason: 'Rain surface wetness detected on sensor. Irrigation inhibited to prevent waterlogging.',
      isPermitted: false
    };
  }

  const isPumpRunning = latestReading.pumpState;

  // 4. Pump is actively running: evaluate shutoff conditions
  if (isPumpRunning) {
    // 4A. Hard maximum runtime limit reached
    const maxRuntimeSec = automation.maxRuntimeMinutes * 60;
    if (activePumpDurationSeconds >= maxRuntimeSec) {
      return {
        action: 'STOP_PUMP',
        stateLabel: 'Max Runtime Limit Reached',
        reason: `Maximum allowable runtime of ${automation.maxRuntimeMinutes} minutes reached. Safety shutoff triggered.`,
        isPermitted: false
      };
    }

    // 4B. Target wet threshold reached (hysteresis cutoff)
    if (latestReading.soilMoisturePercent >= automation.targetWetPercent) {
      return {
        action: 'STOP_PUMP',
        stateLabel: 'Target Wet Threshold Reached',
        reason: `Soil moisture recovered to ${latestReading.soilMoisturePercent}% (>= target ${automation.targetWetPercent}%). De-energizing relay.`,
        isPermitted: true
      };
    }

    return {
      action: 'MAINTAIN_ON',
      stateLabel: 'Irrigation In Progress',
      reason: `Watering active. Current moisture: ${latestReading.soilMoisturePercent}%, targeting ${automation.targetWetPercent}%. Elapsed: ${Math.floor(activePumpDurationSeconds / 60)}m ${activePumpDurationSeconds % 60}s.`,
      isPermitted: true
    };
  }

  // 5. Pump is OFF: evaluate startup conditions
  if (automation.mode !== 'AUTO' || !automation.enabled) {
    return {
      action: 'MAINTAIN_OFF',
      stateLabel: automation.mode === 'MANUAL' ? 'Manual Mode Active' : 'Automation Disabled',
      reason: automation.mode === 'MANUAL' 
        ? 'System is in Manual operating mode. Automatic start triggers are paused.'
        : 'Master automation toggle is disabled.',
      isPermitted: true
    };
  }

  const now = Date.now();

  // 5A. Infiltration cooldown period after watering
  if (lastStopTime) {
    const elapsedSinceLastStopMin = (now - lastStopTime) / (1000 * 60);
    if (elapsedSinceLastStopMin < automation.cooldownMinutes) {
      const remainingMin = Math.ceil(automation.cooldownMinutes - elapsedSinceLastStopMin);
      return {
        action: 'MAINTAIN_OFF',
        stateLabel: 'Waiting in Infiltration Cooldown',
        reason: `Allowing water to percolate through soil root zone. Cooldown active for ${remainingMin} more minutes.`,
        isPermitted: false
      };
    }
  }

  // 5B. Minimum inter-cycle spacing
  const lastStartEvent = recentEvents.find(e => e.eventType === 'START');
  if (lastStartEvent) {
    const elapsedSinceLastStartHours = (now - new Date(lastStartEvent.timestamp).getTime()) / (1000 * 60 * 60);
    if (elapsedSinceLastStartHours < automation.minIntervalHours) {
      const remainingHours = (automation.minIntervalHours - elapsedSinceLastStartHours).toFixed(1);
      return {
        action: 'MAINTAIN_OFF',
        stateLabel: 'Min Inter-Cycle Interval Enforced',
        reason: `Minimum spacing of ${automation.minIntervalHours} hours between cycles not elapsed (${remainingHours} hrs remaining).`,
        isPermitted: false
      };
    }
  }

  // 5C. Soil moisture trigger check (hysteresis startup)
  if (latestReading.soilMoisturePercent <= automation.dryThresholdPercent) {
    return {
      action: 'START_PUMP',
      stateLabel: 'Soil Moisture Below Dry Threshold',
      reason: `Soil moisture dropped to ${latestReading.soilMoisturePercent}% (<= dry trigger ${automation.dryThresholdPercent}%). Commencing automated irrigation.`,
      isPermitted: true
    };
  }

  return {
    action: 'MAINTAIN_OFF',
    stateLabel: 'Soil Moisture Sufficient',
    reason: `Soil moisture is at ${latestReading.soilMoisturePercent}%, above dry threshold (${automation.dryThresholdPercent}%). No watering required.`,
    isPermitted: true
  };
}
