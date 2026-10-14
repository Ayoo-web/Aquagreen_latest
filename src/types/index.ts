export interface SensorReading {
  id?: string;
  timestamp: string; // ISO string
  temperature: number; // °C
  humidity: number; // %
  soilMoistureRaw: number; // ADC 0 - 4095
  soilMoisturePercent: number; // Calibrated 0 - 100%
  pressure: number; // hPa
  windSpeed: number; // m/s
  lux: number; // Illuminance in lux (NOT solar radiation)
  rainDetected: boolean; // Rain surface wetness detector
  pumpState: boolean; // Reported state from controller (true = ON, false = OFF)
  supplyTankDistanceCm?: number | null; // HC-SR04 distance from sensor to supply-tank water surface
  supplyTankPercent?: number | null; // Calibrated fill percentage, 0-100
  supplyTankSensorOk?: boolean | null; // Echo received; percentage also requires distance calibration
  collectionTankDistanceCm?: number | null; // HC-SR04 distance from sensor to collection-tank water surface
  collectionTankPercent?: number | null; // Calibrated fill percentage, 0-100
  collectionTankSensorOk?: boolean | null;
  isSoilFault?: boolean;
  isSimulated?: boolean;
}

export interface CalibrationSettings {
  soilDryAdc: number; // ADC reading when sensor is in dry air/dry soil (e.g., ~3200)
  soilWetAdc: number; // ADC reading when sensor is in water/saturated soil (e.g., ~1400)
  latitude: number; // Decimal degrees North/South (e.g., 14.5995)
  elevation: number; // Elevation in meters above sea level (e.g., 25.0)
  anemometerHeight: number; // Height of wind sensor in meters (e.g., 1.0)
  anemometerFactor: number; // Calibration multiplier from pulses/voltage to m/s
  kRs: number; // Hargreaves radiation adjustment coefficient (0.16 interior, 0.19 coastal)
  pumpFlowRate: number; // Calibrated pump flow rate in Liters/minute (e.g., 12.0)
  relayActiveLow: boolean; // ESP32 GPIO17 polarity: true = Active-LOW (LOW=ON, HIGH=OFF)
  timezone: string; // e.g. "Asia/Manila" or "UTC"
}

export interface WaterTankSettings {
  supplyLowThresholdPercent: number; // Warn when supply tank falls to/below this percentage
  collectionHighThresholdPercent: number; // Warn when collection tank rises to/above this percentage
  alertHysteresisPercent: number; // Prevent repeated notifications while hovering near a threshold
}

export interface AutomationSettings {
  enabled: boolean; // Master automation toggle
  mode: 'AUTO' | 'MANUAL';
  dryThresholdPercent: number; // Turn ON when soil moisture falls below this % (e.g. 35%)
  targetWetPercent: number; // Turn OFF when soil moisture recovers to this % (e.g. 65%)
  maxRuntimeMinutes: number; // Hard safety cap for single pump activation (e.g. 15 min)
  minIntervalHours: number; // Mandatory minimum spacing between automatic irrigation events (e.g. 4 hrs)
  cooldownMinutes: number; // Infiltration soak pause after watering stops (e.g. 30 min)
  rainInhibitionEnabled: boolean; // Interlock: block irrigation if rain sensor detects wetness
  dailyMaxVolumeLiters: number; // Maximum cumulative water per 24-hr window (e.g. 200 L)
  emergencyStop: boolean; // Master emergency latch
}

export interface CropSettings {
  cropName: string;
  stage: 'initial' | 'mid' | 'end';
  kcInitial: number; // e.g. 0.50
  kcMid: number; // e.g. 1.05
  kcEnd: number; // e.g. 0.65
  irrigatedAreaSqM: number; // Irrigated bed/plot surface area in m²
  irrigationEfficiency: number; // Field application efficiency (e.g. 0.85 for drip, 0.70 for sprinkler)
}

export interface FAO56Calculation {
  timestamp: string;
  date: string;
  dataCompletenessPercent: number;
  sampleCount: number;
  isDailyAverage: boolean;
  tMean: number; // °C
  tMin: number; // °C
  tMax: number; // °C
  rhMean: number; // %
  rhMin: number; // %
  rhMax: number; // %
  rawWindSpeed: number; // m/s measured at sensor height
  windSensorHeight: number; // m
  windSpeed2m: number; // u₂: wind speed at 2 m height (m/s)
  pressureKPa: number; // Atmospheric pressure P (kPa)
  delta: number; // Δ: slope of vapor pressure curve (kPa/°C)
  gamma: number; // γ: psychrometric constant (kPa/°C)
  es: number; // Mean saturation vapor pressure (kPa)
  ea: number; // Actual vapor pressure (kPa)
  vpd: number; // Vapor pressure deficit (es - ea) (kPa)
  dayOfYear: number; // J: day of year
  ra: number; // Extraterrestrial radiation (MJ/m²/day)
  rso: number; // Clear-sky solar radiation (MJ/m²/day)
  rsEstimated: number; // Rs: Solar radiation estimated via FAO Hargreaves method (MJ/m²/day)
  rns: number; // Net shortwave radiation (MJ/m²/day)
  rnl: number; // Net longwave radiation (MJ/m²/day)
  rn: number; // Net radiation (MJ/m²/day)
  g: number; // Soil heat flux (MJ/m²/day, 0 for daily)
  et0: number; // Reference evapotranspiration (mm/day)
  kc: number; // Current crop coefficient
  etc: number; // Crop evapotranspiration (mm/day)
  netWaterRequirementLiters: number; // Liters = ETc (mm) * Area (m²)
  grossWaterRequirementLiters: number; // Liters = Net / Efficiency
  estimatedPumpRuntimeMinutes: number; // Gross Volume / Flow Rate (min)
  warnings: string[];
  methodLimitations: string[];
}

export interface IrrigationEvent {
  id: string;
  timestamp: string;
  eventType: 'START' | 'STOP' | 'BLOCKED' | 'EMERGENCY_STOP' | 'COOLDOWN_COMPLETE';
  triggerReason: string;
  durationSeconds?: number;
  estimatedVolumeLiters?: number;
  soilMoistureBefore?: number;
  soilMoistureAfter?: number;
  commandSource: 'AUTO_ALGORITHM' | 'MANUAL_USER' | 'SAFETY_CONTROLLER' | 'SIMULATOR';
  pumpReportedState: boolean;
}

export type AlertSeverity = 'INFO' | 'WARNING' | 'CRITICAL';

export interface AlertNotification {
  id: string;
  timestamp: string;
  severity: AlertSeverity;
  title: string;
  message: string;
  category: 'SOIL' | 'WEATHER' | 'HARDWARE' | 'IRRIGATION' | 'CALCULATION' | 'NETWORK' | 'WATER_TANK';
  acknowledged: boolean;
}

export interface PredictionResult {
  timestamp: string;
  currentMoisture: number;
  dryingVelocityPerHour: number; // % moisture change per hour (negative when drying)
  projectedMoisture30Min: number;
  projectedMoisture60Min: number;
  hoursUntilDryThreshold: number | null; // null if rising or unavailable
  isAvailable: boolean;
  confidence: 'HIGH' | 'MODERATE' | 'LOW' | 'UNAVAILABLE';
  reason: string;
  samplePointsUsed: number;
}
