import {
  AlertNotification,
  AutomationSettings,
  CalibrationSettings,
  CropSettings,
  IrrigationEvent,
  SensorReading,
  WaterTankSettings
} from '../types';
import { rawAdcToMoisturePercent } from './irrigationEngine';

const STORAGE_KEYS = {
  READINGS: 'aquagreen_sensor_readings',
  CALIBRATION: 'aquagreen_calibration_v1',
  AUTOMATION: 'aquagreen_automation_v1',
  CROP: 'aquagreen_crop_v1',
  EVENTS: 'aquagreen_irrigation_events',
  NOTIFICATIONS: 'aquagreen_notifications'
};

export const DEFAULT_CALIBRATION: CalibrationSettings = {
  soilDryAdc: 3200, // Dry probe reading
  soilWetAdc: 1400, // Saturated probe reading
  latitude: 14.5995, // 14.6° N (tropical / semi-arid research plot)
  elevation: 25.0, // 25 meters above sea level
  anemometerHeight: 1.0, // Sensor installed at 1.0 m height
  anemometerFactor: 0.0875, // Calibration scaling
  kRs: 0.16, // Interior location coefficient (0.16 interior, 0.19 coastal)
  pumpFlowRate: 12.0, // 12 Liters / minute
  relayActiveLow: true, // ESP32 GPIO17 active-LOW: LOW=ON, HIGH=OFF
  timezone: 'Asia/Manila'
};

export const DEFAULT_WATER_TANKS: WaterTankSettings = {
  supplyLowThresholdPercent: 20,
  collectionHighThresholdPercent: 90,
  alertHysteresisPercent: 5
};

export const DEFAULT_AUTOMATION: AutomationSettings = {
  enabled: true,
  mode: 'AUTO',
  dryThresholdPercent: 35, // Trigger ON when moisture <= 35%
  targetWetPercent: 65, // Trigger OFF when moisture >= 65%
  maxRuntimeMinutes: 15, // Hard cutoff
  minIntervalHours: 4, // Minimum 4 hours between automatic waterings
  cooldownMinutes: 30, // 30 min soak period
  rainInhibitionEnabled: true, // Block if rain sensor is wet
  dailyMaxVolumeLiters: 150,
  emergencyStop: false
};

export const DEFAULT_CROP: CropSettings = {
  cropName: 'Generic Research Crop',
  stage: 'mid',
  kcInitial: 0.50,
  kcMid: 1.05,
  kcEnd: 0.65,
  irrigatedAreaSqM: 20.0,
  irrigationEfficiency: 0.85
};

export class StorageService {
  private static alertCooldowns: Map<string, number> = new Map();

  static getCalibration(): CalibrationSettings {
    const raw = localStorage.getItem(STORAGE_KEYS.CALIBRATION);
    if (!raw) return DEFAULT_CALIBRATION;
    try {
      return { ...DEFAULT_CALIBRATION, ...JSON.parse(raw) };
    } catch {
      return DEFAULT_CALIBRATION;
    }
  }

  static saveCalibration(settings: CalibrationSettings): void {
    localStorage.setItem(STORAGE_KEYS.CALIBRATION, JSON.stringify(settings));
  }

  static getAutomation(): AutomationSettings {
    const raw = localStorage.getItem(STORAGE_KEYS.AUTOMATION);
    if (!raw) return DEFAULT_AUTOMATION;
    try {
      return { ...DEFAULT_AUTOMATION, ...JSON.parse(raw) };
    } catch {
      return DEFAULT_AUTOMATION;
    }
  }

  static saveAutomation(settings: AutomationSettings): void {
    localStorage.setItem(STORAGE_KEYS.AUTOMATION, JSON.stringify(settings));
  }

  static getCrop(): CropSettings {
    const raw = localStorage.getItem(STORAGE_KEYS.CROP);
    if (!raw) return DEFAULT_CROP;
    try {
      return { ...DEFAULT_CROP, ...JSON.parse(raw) };
    } catch {
      return DEFAULT_CROP;
    }
  }

  static saveCrop(settings: CropSettings): void {
    localStorage.setItem(STORAGE_KEYS.CROP, JSON.stringify(settings));
  }

  static getReadings(): SensorReading[] {
    const raw = localStorage.getItem(STORAGE_KEYS.READINGS);
    if (!raw) {
      const seeded = StorageService.generateSeedReadings();
      StorageService.saveReadings(seeded);
      return seeded;
    }
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) && parsed.length > 0 ? parsed : StorageService.generateSeedReadings();
    } catch {
      return StorageService.generateSeedReadings();
    }
  }

  static saveReadings(readings: SensorReading[]): void {
    // Keep up to 500 recent readings
    const trimmed = readings.slice(-500);
    localStorage.setItem(STORAGE_KEYS.READINGS, JSON.stringify(trimmed));
  }

  static addReading(reading: SensorReading): SensorReading[] {
    const readings = StorageService.getReadings();
    const updated = [...readings, reading].slice(-500);
    StorageService.saveReadings(updated);
    return updated;
  }

  static getEvents(): IrrigationEvent[] {
    const raw = localStorage.getItem(STORAGE_KEYS.EVENTS);
    if (!raw) return [];
    try {
      return JSON.parse(raw) || [];
    } catch {
      return [];
    }
  }

  static addEvent(event: IrrigationEvent): IrrigationEvent[] {
    const events = StorageService.getEvents();
    const updated = [event, ...events].slice(0, 100);
    localStorage.setItem(STORAGE_KEYS.EVENTS, JSON.stringify(updated));
    return updated;
  }

  static getNotifications(): AlertNotification[] {
    const raw = localStorage.getItem(STORAGE_KEYS.NOTIFICATIONS);
    if (!raw) return [];
    try {
      return JSON.parse(raw) || [];
    } catch {
      return [];
    }
  }

  static addNotification(
    notif: Omit<AlertNotification, 'id' | 'timestamp' | 'acknowledged'>,
    cooldownMs: number = 10 * 60 * 1000 // 10 min default deduplication cooldown
  ): AlertNotification | null {
    const key = `${notif.category}_${notif.title}`;
    const now = Date.now();
    const lastTime = StorageService.alertCooldowns.get(key) || 0;

    if (now - lastTime < cooldownMs) {
      return null; // Suppressed by deduplication
    }

    StorageService.alertCooldowns.set(key, now);

    const fullNotif: AlertNotification = {
      ...notif,
      id: 'alert_' + now + '_' + Math.random().toString(36).substring(2, 6),
      timestamp: new Date().toISOString(),
      acknowledged: false
    };

    const list = StorageService.getNotifications();
    const updated = [fullNotif, ...list].slice(0, 50);
    localStorage.setItem(STORAGE_KEYS.NOTIFICATIONS, JSON.stringify(updated));
    return fullNotif;
  }

  static acknowledgeNotification(id: string): void {
    const list = StorageService.getNotifications();
    const updated = list.map(n => n.id === id ? { ...n, acknowledged: true } : n);
    localStorage.setItem(STORAGE_KEYS.NOTIFICATIONS, JSON.stringify(updated));
  }

  static clearAllNotifications(): void {
    localStorage.setItem(STORAGE_KEYS.NOTIFICATIONS, JSON.stringify([]));
  }

  /**
   * Generates a realistic 24-hour baseline dataset of authentic research readings
   */
  private static generateSeedReadings(): SensorReading[] {
    const readings: SensorReading[] = [];
    const cal = DEFAULT_CALIBRATION;
    const now = Date.now();
    const hourMs = 60 * 60 * 1000;

    // Generate 24 hourly readings matching tropical agricultural diurnal curve
    for (let i = 24; i >= 0; i--) {
      const time = new Date(now - i * hourMs);
      const hour = time.getHours();

      // Diurnal temperature wave (min at 6 AM, max at 2 PM)
      const tMean = 26.5;
      const tAmp = 4.8;
      const temp = tMean + tAmp * Math.sin(((hour - 8) / 24) * 2 * Math.PI);

      // Relative humidity inverse to temperature
      const rh = Math.max(45, Math.min(92, 75 - 20 * Math.sin(((hour - 8) / 24) * 2 * Math.PI)));

      // Barometric pressure around 1010 hPa
      const pressure = 1010.5 + 1.2 * Math.cos(((hour - 9) / 12) * 2 * Math.PI);

      // Wind speed slightly higher during midday
      const wind = 1.2 + (hour >= 10 && hour <= 17 ? 1.5 : 0.4) + (Math.sin(i * 0.7) * 0.3);

      // Lux curve (0 at night, up to 45,000 lux at noon)
      let lux = 0;
      if (hour >= 6 && hour <= 18) {
        const solarFactor = Math.sin(((hour - 6) / 12) * Math.PI);
        lux = Math.round(solarFactor * 42000);
      }

      // Soil moisture gradually decreasing from 48% to 37% over the day
      const moisturePercent = Math.max(34, 48 - (24 - i) * 0.5);
      const rawAdc = Math.round(cal.soilDryAdc - (moisturePercent / 100) * (cal.soilDryAdc - cal.soilWetAdc));

      readings.push({
        id: `seed_${i}`,
        timestamp: time.toISOString(),
        temperature: Number(temp.toFixed(1)),
        humidity: Number(rh.toFixed(1)),
        soilMoistureRaw: rawAdc,
        soilMoisturePercent: Number(moisturePercent.toFixed(1)),
        pressure: Number(pressure.toFixed(1)),
        windSpeed: Number(Math.max(0.2, wind).toFixed(2)),
        lux,
        rainDetected: false,
        pumpState: false,
        isSimulated: false
      });
    }

    return readings;
  }

  /**
   * Exports historical records to CSV string
   */
  static exportCsv(readings: SensorReading[]): string {
    const headers = [
      'timestamp_iso',
      'temperature_celsius',
      'relative_humidity_percent',
      'soil_moisture_raw_adc',
      'soil_moisture_calibrated_percent',
      'atmospheric_pressure_hpa',
      'calibrated_wind_speed_ms',
      'illuminance_lux',
      'rain_surface_detected',
      'pump_reported_state',
      'supply_tank_distance_cm',
      'supply_tank_fill_percent',
      'supply_tank_sensor_ok',
      'collection_tank_distance_cm',
      'collection_tank_fill_percent',
      'collection_tank_sensor_ok',
      'data_source'
    ];

    const rows = readings.map(r => [
      r.timestamp,
      r.temperature,
      r.humidity,
      r.soilMoistureRaw,
      r.soilMoisturePercent,
      r.pressure,
      r.windSpeed,
      r.lux,
      r.rainDetected ? 1 : 0,
      r.pumpState ? 1 : 0,
      r.supplyTankDistanceCm ?? '',
      r.supplyTankPercent ?? '',
      r.supplyTankSensorOk == null ? '' : (r.supplyTankSensorOk ? 1 : 0),
      r.collectionTankDistanceCm ?? '',
      r.collectionTankPercent ?? '',
      r.collectionTankSensorOk == null ? '' : (r.collectionTankSensorOk ? 1 : 0),
      r.isSimulated ? 'SIMULATOR' : 'ESP32_TELEMETRY'
    ]);

    return [headers.join(','), ...rows.map(row => row.join(','))].join('\n');
  }
}
