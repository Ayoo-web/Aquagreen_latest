import { CalibrationSettings, CropSettings, FAO56Calculation, SensorReading } from '../types';

/**
 * Saturation vapor pressure function e°(T) in kPa
 * FAO-56 Equation 11
 */
export function satVaporPressure(tCelsius: number): number {
  return 0.6108 * Math.exp((17.27 * tCelsius) / (tCelsius + 237.3));
}

/**
 * Slope of saturation vapor pressure curve Δ in kPa/°C
 * FAO-56 Equation 13
 */
export function slopeVaporPressureCurve(tCelsius: number): number {
  const num = 4098 * (0.6108 * Math.exp((17.27 * tCelsius) / (tCelsius + 237.3)));
  const den = Math.pow(tCelsius + 237.3, 2);
  return num / den;
}

/**
 * Atmospheric pressure P in kPa based on elevation z (m)
 * FAO-56 Equation 7
 */
export function atmosphericPressure(elevationM: number): number {
  return 101.3 * Math.pow((293.0 - 0.0065 * elevationM) / 293.0, 5.26);
}

/**
 * Psychrometric constant γ in kPa/°C
 * FAO-56 Equation 8
 */
export function psychrometricConstant(pressureKPa: number): number {
  return 0.000665 * pressureKPa;
}

/**
 * Wind speed height correction to 2.0 meters standard
 * FAO-56 Equation 47
 * u₂ = u_z * 4.87 / ln(67.8 * z - 5.42)
 */
export function adjustWindSpeedTo2m(windSpeed: number, sensorHeightM: number): number {
  if (sensorHeightM <= 0) return Math.max(0, windSpeed);
  if (Math.abs(sensorHeightM - 2.0) < 0.05) return Math.max(0, windSpeed);
  const factor = 4.87 / Math.log(67.8 * sensorHeightM - 5.42);
  return Math.max(0, windSpeed * factor);
}

/**
 * Day of year J calculation
 */
export function getDayOfYear(date: Date): number {
  const start = new Date(date.getFullYear(), 0, 0);
  const diff = date.getTime() - start.getTime();
  const oneDay = 1000 * 60 * 60 * 24;
  return Math.floor(diff / oneDay);
}

/**
 * Extraterrestrial Radiation Ra in MJ/m²/day
 * FAO-56 Equations 21-28
 */
export function extraterrestrialRadiation(latitudeDeg: number, dayOfYear: number): {
  ra: number;
  delta: number;
  omegaS: number;
  dr: number;
} {
  const phi = (Math.PI / 180) * latitudeDeg;
  // Inverse relative distance Earth-Sun dr (Eq. 23)
  const dr = 1 + 0.033 * Math.cos(((2 * Math.PI) / 365) * dayOfYear);
  // Solar declination δ in radians (Eq. 24)
  const delta = 0.409 * Math.sin(((2 * Math.PI) / 365) * dayOfYear - 1.39);
  // Sunset hour angle ωs in radians (Eq. 25, 26)
  const tanPhiTanDelta = Math.tan(phi) * Math.tan(delta);
  // Clamp between -1 and 1 to prevent NaN in polar regions
  const clamped = Math.max(-1, Math.min(1, -tanPhiTanDelta));
  const omegaS = Math.acos(clamped);

  // Solar constant Gsc = 0.0820 MJ/m²/min (Eq. 28)
  const gsc = 0.0820;
  const term1 = omegaS * Math.sin(phi) * Math.sin(delta);
  const term2 = Math.cos(phi) * Math.cos(delta) * Math.sin(omegaS);
  const ra = ((24 * 60) / Math.PI) * gsc * dr * (term1 + term2);

  return { ra: Math.max(0, ra), delta, omegaS, dr };
}

/**
 * Clear-sky solar radiation Rso in MJ/m²/day
 * FAO-56 Equation 37
 */
export function clearSkyRadiation(ra: number, elevationM: number): number {
  return (0.75 + 2e-5 * elevationM) * ra;
}

/**
 * Estimated solar radiation Rs via FAO Hargreaves temperature-range method
 * FAO-56 Equation 50: Rs = kRs * sqrt(Tmax - Tmin) * Ra
 */
export function estimateSolarRadiation(
  tMin: number,
  tMax: number,
  ra: number,
  kRs: number = 0.16
): number {
  const tDiff = Math.max(0, tMax - tMin);
  return kRs * Math.sqrt(tDiff) * ra;
}

/**
 * Net solar radiation Rns in MJ/m²/day
 * FAO-56 Equation 38: Rns = (1 - α) * Rs, α = 0.23
 */
export function netSolarRadiation(rs: number, albedo: number = 0.23): number {
  return (1 - albedo) * rs;
}

/**
 * Net longwave radiation Rnl in MJ/m²/day
 * FAO-56 Equation 39
 */
export function netLongwaveRadiation(
  tMin: number,
  tMax: number,
  ea: number,
  rs: number,
  rso: number
): number {
  const sigma = 4.903e-9; // Stefan-Boltzmann constant in MJ/K⁴/m²/day
  const tMaxK4 = Math.pow(tMax + 273.16, 4);
  const tMinK4 = Math.pow(tMin + 273.16, 4);
  const tempFactor = (tMaxK4 + tMinK4) / 2.0;

  // Vapor pressure term
  const vpFactor = 0.34 - 0.14 * Math.sqrt(Math.max(0, ea));

  // Cloudiness / relative solar radiation ratio capped between 0.3 and 1.0 (Eq. 39)
  const rsRatio = rso > 0 ? Math.min(1.0, Math.max(0.3, rs / rso)) : 0.7;
  const cloudFactor = 1.35 * rsRatio - 0.35;

  return sigma * tempFactor * vpFactor * Math.max(0.05, cloudFactor);
}

/**
 * Complete FAO-56 Penman-Monteith Reference Evapotranspiration calculation
 */
export function calculateFAO56(
  readings: SensorReading[],
  calibration: CalibrationSettings,
  crop: CropSettings,
  targetDate: Date = new Date()
): FAO56Calculation | null {
  const warnings: string[] = [];
  const limitations: string[] = [
    'Solar radiation (Rs) estimated via FAO-56 Hargreaves temperature-range method. The GY-302 sensor measures photometric illuminance (lux) which cannot be converted to radiometric energy (W/m² or MJ/m²) without spectral bias.',
    'Rain sensor detects surface wetness only. It does not measure precipitation depth in millimeters.',
    'Daily soil heat flux (G) is assumed to be 0 MJ/m²/day in accordance with FAO-56 recommendations for 24-hour periods.'
  ];

  // FAO-56 Penman-Monteith requires wind speed. Do not replace unavailable wind
  // with a plausible-looking default; only calculate from samples with a measured value.
  const validReadings = readings.filter(
    (r): r is SensorReading & { windSpeed: number } => Number.isFinite(r.temperature) &&
      Number.isFinite(r.humidity) && r.windSpeed != null && Number.isFinite(r.windSpeed) && r.windSpeed >= 0
  );
  if (validReadings.length === 0) return null;

  let tMin: number;
  let tMax: number;
  let tMean: number;
  let rhMin: number;
  let rhMax: number;
  let rhMean: number;
  let rawWindSpeed: number;
  let isDailyAverage = false;

  if (validReadings.length >= 8) {
    // We have a dataset with multiple temporal samples
    isDailyAverage = true;
    const temps = validReadings.map(r => r.temperature);
    const humids = validReadings.map(r => r.humidity);
    const winds = validReadings.map(r => r.windSpeed);

    tMin = Math.min(...temps);
    tMax = Math.max(...temps);
    tMean = temps.reduce((a, b) => a + b, 0) / temps.length;

    rhMin = Math.min(...humids);
    rhMax = Math.max(...humids);
    rhMean = humids.reduce((a, b) => a + b, 0) / humids.length;

    rawWindSpeed = winds.reduce((a, b) => a + b, 0) / winds.length;
  } else if (validReadings.length > 0) {
    // Instantaneous single or few readings fallback
    const latest = validReadings[validReadings.length - 1];
    tMean = latest.temperature;
    // Approximated diurnal amplitude for Hargreaves method when only instantaneous sample is present
    tMin = tMean - 4.5;
    tMax = tMean + 4.5;
    rhMean = latest.humidity;
    rhMin = Math.max(10, rhMean - 15);
    rhMax = Math.min(100, rhMean + 15);
    rawWindSpeed = latest.windSpeed as number;
    warnings.push('Fewer than 8 hourly samples available for 24-hr dataset. Daily temperature range approximated from current reading.');
  } else {
    // Default fallback values
    tMean = 26.0;
    tMin = 22.0;
    tMax = 31.0;
    rhMean = 70.0;
    rhMin = 55.0;
    rhMax = 85.0;
    return null;
  }

  // 1. Vapor pressure values
  const eTmin = satVaporPressure(tMin);
  const eTmax = satVaporPressure(tMax);
  const es = (eTmin + eTmax) / 2.0;
  // Actual vapor pressure ea from RH extremes (Eq. 17)
  const ea = (eTmin * (rhMax / 100.0) + eTmax * (rhMin / 100.0)) / 2.0;
  const vpd = Math.max(0, es - ea);

  // 2. Slope of vapor pressure curve Δ (Eq. 13)
  const delta = slopeVaporPressureCurve(tMean);

  // 3. Pressure & Psychrometric constant (Eq. 7, 8)
  const pressureKPa = atmosphericPressure(calibration.elevation);
  const gamma = psychrometricConstant(pressureKPa);

  // 4. Wind speed height correction to 2m (Eq. 47)
  const windSpeed2m = adjustWindSpeedTo2m(rawWindSpeed, calibration.anemometerHeight);

  // 5. Radiation terms
  const dayOfYear = getDayOfYear(targetDate);
  const { ra } = extraterrestrialRadiation(calibration.latitude, dayOfYear);
  const rso = clearSkyRadiation(ra, calibration.elevation);
  const rsEstimated = estimateSolarRadiation(tMin, tMax, ra, calibration.kRs);
  const rns = netSolarRadiation(rsEstimated, 0.23);
  const rnl = netLongwaveRadiation(tMin, tMax, ea, rsEstimated, rso);
  const rn = Math.max(0, rns - rnl);
  const g = 0.0; // Daily soil heat flux

  // 6. Master FAO-56 Penman-Monteith equation (Eq. 6)
  // ET0 = [0.408 Δ (Rn - G) + γ (900 / (T + 273)) u2 (es - ea)] / [Δ + γ (1 + 0.34 u2)]
  const numRad = 0.408 * delta * (rn - g);
  const numAero = gamma * (900.0 / (tMean + 273.0)) * windSpeed2m * (es - ea);
  const den = delta + gamma * (1.0 + 0.34 * windSpeed2m);
  const et0Raw = (numRad + numAero) / den;
  const et0 = Math.max(0.1, Number(et0Raw.toFixed(2)));

  // 7. Crop Evapotranspiration ETc
  let kc = crop.kcMid;
  if (crop.stage === 'initial') kc = crop.kcInitial;
  if (crop.stage === 'end') kc = crop.kcEnd;
  const etc = Number((et0 * kc).toFixed(2));

  // 8. Volumetric Water Requirements
  // 1 mm of water over 1 m² = 1 Liter
  const netWaterRequirementLiters = Number((etc * crop.irrigatedAreaSqM).toFixed(1));
  const efficiency = Math.max(0.3, Math.min(1.0, crop.irrigationEfficiency || 0.85));
  const grossWaterRequirementLiters = Number((netWaterRequirementLiters / efficiency).toFixed(1));

  // 9. Pump Runtime Estimation
  const flowRate = Math.max(0.5, calibration.pumpFlowRate || 10.0);
  const estimatedPumpRuntimeMinutes = Number((grossWaterRequirementLiters / flowRate).toFixed(1));

  // Data completeness score (out of 24 ideal hourly readings)
  const completeness = Math.min(100, Math.round((validReadings.length / 24) * 100));

  return {
    timestamp: new Date().toISOString(),
    date: targetDate.toISOString().split('T')[0],
    dataCompletenessPercent: completeness,
    sampleCount: validReadings.length,
    isDailyAverage,
    tMean: Number(tMean.toFixed(1)),
    tMin: Number(tMin.toFixed(1)),
    tMax: Number(tMax.toFixed(1)),
    rhMean: Number(rhMean.toFixed(1)),
    rhMin: Number(rhMin.toFixed(1)),
    rhMax: Number(rhMax.toFixed(1)),
    rawWindSpeed: Number(rawWindSpeed.toFixed(2)),
    windSensorHeight: calibration.anemometerHeight,
    windSpeed2m: Number(windSpeed2m.toFixed(2)),
    pressureKPa: Number(pressureKPa.toFixed(2)),
    delta: Number(delta.toFixed(4)),
    gamma: Number(gamma.toFixed(4)),
    es: Number(es.toFixed(3)),
    ea: Number(ea.toFixed(3)),
    vpd: Number(vpd.toFixed(3)),
    dayOfYear,
    ra: Number(ra.toFixed(2)),
    rso: Number(rso.toFixed(2)),
    rsEstimated: Number(rsEstimated.toFixed(2)),
    rns: Number(rns.toFixed(2)),
    rnl: Number(rnl.toFixed(2)),
    rn: Number(rn.toFixed(2)),
    g,
    et0,
    kc,
    etc,
    netWaterRequirementLiters,
    grossWaterRequirementLiters,
    estimatedPumpRuntimeMinutes,
    warnings,
    methodLimitations: limitations
  };
}
