import { PredictionResult, SensorReading } from '../types';

/**
 * Computes an explainable, linear regression-based soil moisture drying trajectory
 * from recent validated readings.
 */
export function calculateSoilMoisturePrediction(
  readings: SensorReading[],
  dryThresholdPercent: number
): PredictionResult {
  const timestamp = new Date().toISOString();

  // Need at least 5 readings to establish a credible directional slope
  const validReadings = readings.filter(
    r => !isNaN(r.soilMoisturePercent) && r.soilMoistureRaw < 4090 && r.soilMoistureRaw > 10
  );

  if (validReadings.length < 5) {
    return {
      timestamp,
      currentMoisture: validReadings.length > 0 ? validReadings[validReadings.length - 1].soilMoisturePercent : 0,
      dryingVelocityPerHour: 0,
      projectedMoisture30Min: validReadings.length > 0 ? validReadings[validReadings.length - 1].soilMoisturePercent : 0,
      projectedMoisture60Min: validReadings.length > 0 ? validReadings[validReadings.length - 1].soilMoisturePercent : 0,
      hoursUntilDryThreshold: null,
      isAvailable: false,
      confidence: 'UNAVAILABLE',
      reason: `Insufficient valid readings (collected ${validReadings.length}/5 required time-series samples).`,
      samplePointsUsed: validReadings.length
    };
  }

  // Use the most recent 20 readings for local slope estimation
  const windowReadings = validReadings.slice(-20);
  const latest = windowReadings[windowReadings.length - 1];
  const currentMoisture = latest.soilMoisturePercent;

  // If pump is currently running or was running in the window, drying trend is disrupted
  const wasIrrigatingRecently = windowReadings.some(r => r.pumpState);
  if (wasIrrigatingRecently) {
    return {
      timestamp,
      currentMoisture,
      dryingVelocityPerHour: 0,
      projectedMoisture30Min: currentMoisture,
      projectedMoisture60Min: currentMoisture,
      hoursUntilDryThreshold: null,
      isAvailable: false,
      confidence: 'LOW',
      reason: 'Active or recent irrigation cycle in observation window. Evapotranspiration drying curve is temporarily disrupted by water infiltration.',
      samplePointsUsed: windowReadings.length
    };
  }

  // Check if readings have timestamps to compute real time-based derivative
  const t0 = new Date(windowReadings[0].timestamp).getTime();
  const timesHours: number[] = [];
  const moistures: number[] = [];

  for (const r of windowReadings) {
    const t = (new Date(r.timestamp).getTime() - t0) / (1000 * 60 * 60); // Hours
    timesHours.push(t);
    moistures.push(r.soilMoisturePercent);
  }

  const n = timesHours.length;
  const totalTimeHours = timesHours[n - 1] - timesHours[0];

  // If readings are crammed in less than 3 minutes, slope can be noisy
  if (totalTimeHours < (3 / 60)) {
    return {
      timestamp,
      currentMoisture,
      dryingVelocityPerHour: 0,
      projectedMoisture30Min: currentMoisture,
      projectedMoisture60Min: currentMoisture,
      hoursUntilDryThreshold: null,
      isAvailable: false,
      confidence: 'LOW',
      reason: 'Observation window duration is less than 3 minutes. Extended baseline required for statistical significance.',
      samplePointsUsed: n
    };
  }

  // Linear Regression: y = slope * t + intercept
  const sumX = timesHours.reduce((a, b) => a + b, 0);
  const sumY = moistures.reduce((a, b) => a + b, 0);
  const sumXY = timesHours.reduce((acc, x, i) => acc + x * moistures[i], 0);
  const sumX2 = timesHours.reduce((acc, x) => acc + x * x, 0);

  const denom = n * sumX2 - sumX * sumX;
  if (Math.abs(denom) < 1e-6) {
    return {
      timestamp,
      currentMoisture,
      dryingVelocityPerHour: 0,
      projectedMoisture30Min: currentMoisture,
      projectedMoisture60Min: currentMoisture,
      hoursUntilDryThreshold: null,
      isAvailable: false,
      confidence: 'UNAVAILABLE',
      reason: 'Zero variance in observation time intervals.',
      samplePointsUsed: n
    };
  }

  const slope = (n * sumXY - sumX * sumY) / denom; // % moisture change per hour

  // Compute R² to assess statistical confidence
  const meanY = sumY / n;
  const ssTotal = moistures.reduce((acc, y) => acc + Math.pow(y - meanY, 2), 0);
  const ssRes = timesHours.reduce((acc, x, i) => {
    const yPred = ((sumY - slope * sumX) / n) + slope * x;
    return acc + Math.pow(moistures[i] - yPred, 2);
  }, 0);
  const rSquared = ssTotal > 0 ? Math.max(0, 1 - (ssRes / ssTotal)) : 0;

  // Projected 30 min (0.5 hr) and 60 min (1.0 hr)
  const projected30 = Math.max(0, Math.min(100, Math.round(currentMoisture + slope * 0.5)));
  const projected60 = Math.max(0, Math.min(100, Math.round(currentMoisture + slope * 1.0)));

  let hoursUntilDryThreshold: number | null = null;
  if (slope < -0.05 && currentMoisture > dryThresholdPercent) {
    const diff = currentMoisture - dryThresholdPercent;
    hoursUntilDryThreshold = Number((diff / Math.abs(slope)).toFixed(1));
  }

  let confidence: 'HIGH' | 'MODERATE' | 'LOW' = 'LOW';
  if (rSquared > 0.7 && n >= 10 && totalTimeHours >= 0.5) {
    confidence = 'HIGH';
  } else if (rSquared > 0.4 && n >= 6) {
    confidence = 'MODERATE';
  }

  return {
    timestamp,
    currentMoisture,
    dryingVelocityPerHour: Number(slope.toFixed(2)),
    projectedMoisture30Min: projected30,
    projectedMoisture60Min: projected60,
    hoursUntilDryThreshold,
    isAvailable: true,
    confidence,
    reason: slope < 0
      ? `Soil drying rate observed at ${Math.abs(slope).toFixed(2)}%/hr (R² = ${rSquared.toFixed(2)}).`
      : `Soil moisture stable or slightly rising (+${slope.toFixed(2)}%/hr).`,
    samplePointsUsed: n
  };
}
