/**
 * AquaGreen Smart Irrigation System - Production API Client
 * Interfaces the React frontend directly with the live public Vercel/FastAPI backend.
 * Replaces browser-local storage as the authoritative telemetry and pump state store.
 */

import {
  AlertNotification,
  AutomationSettings,
  CalibrationSettings,
  CropSettings,
  FAO56Calculation,
  IrrigationEvent,
  PredictionResult,
  SensorReading,
  WaterTankSettings
} from '../types';

const API_BASE = import.meta.env.VITE_API_BASE_URL || '';

function getHeaders(customHeaders: Record<string, string> = {}): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...customHeaders
  };

  const storedKey = localStorage.getItem('aquagreen_dashboard_key');
  if (storedKey) {
    headers['X-Dashboard-Key'] = storedKey;
  }

  return headers;
}

export const ApiService = {
  // ----------------------------------------------------------------------------
  // Auth & Client Preferences
  // ----------------------------------------------------------------------------
  getDashboardKey(): string {
    return localStorage.getItem('aquagreen_dashboard_key') || '';
  },

  setDashboardKey(key: string): void {
    if (key.trim()) {
      localStorage.setItem('aquagreen_dashboard_key', key.trim());
    } else {
      localStorage.removeItem('aquagreen_dashboard_key');
    }
  },

  // ----------------------------------------------------------------------------
  // System Health
  // ----------------------------------------------------------------------------
  async checkHealth(): Promise<{ status: string; system: string; database: string; last_telemetry_timestamp?: string }> {
    const res = await fetch(`${API_BASE}/api/health`, { headers: getHeaders() });
    if (!res.ok) throw new Error(`Health check failed: HTTP ${res.status}`);
    return res.json();
  },

  // ----------------------------------------------------------------------------
  // Telemetry Endpoints
  // ----------------------------------------------------------------------------
  async getLatestTelemetry(): Promise<{ reading: SensorReading | null; isStale: boolean; ageSeconds: number | null }> {
    const res = await fetch(`${API_BASE}/api/telemetry/latest`, { headers: getHeaders() });
    if (!res.ok) {
      if (res.status === 404) return { reading: null, isStale: true, ageSeconds: null };
      throw new Error(`Failed to fetch latest telemetry: HTTP ${res.status}`);
    }
    const data = await res.json();

    if (!data || data.temperature === null || data.id === null) {
      return { reading: null, isStale: true, ageSeconds: null };
    }

    const reading: SensorReading = {
      id: String(data.id),
      timestamp: data.timestamp,
      temperature: Number(data.temperature),
      humidity: Number(data.humidity),
      soilMoistureRaw: Number(data.soil_moisture_raw ?? data.soilMoistureRaw ?? 0),
      soilMoisturePercent: data.soil_moisture_percent ?? data.soilMoisturePercent ?? null,
      pressure: Number(data.pressure),
      windSpeed: data.wind_speed ?? data.windSpeed ?? null,
      lux: Number(data.lux ?? 0),
      rainDetected: data.rain_detected ?? data.rainDetected ?? null,
      soilSensorOk: (data.soil_sensor_ok ?? data.soilSensorOk) == null ? null : Boolean(data.soil_sensor_ok ?? data.soilSensorOk),
      rainSensorOk: (data.rain_sensor_ok ?? data.rainSensorOk) == null ? null : Boolean(data.rain_sensor_ok ?? data.rainSensorOk),
      windSensorOk: (data.wind_sensor_ok ?? data.windSensorOk) == null ? null : Boolean(data.wind_sensor_ok ?? data.windSensorOk),
      windRaw: data.wind_raw ?? data.windRaw ?? null,
      windVoltageV: data.wind_voltage_v ?? data.windVoltageV ?? null,
      pumpState: Boolean(data.pump_state ?? data.pumpState),
      supplyTankDistanceCm: data.supply_tank_distance_cm ?? data.supplyTankDistanceCm ?? null,
      supplyTankPercent: data.supply_tank_percent ?? data.supplyTankPercent ?? null,
      supplyTankSensorOk: (data.supply_tank_sensor_ok ?? data.supplyTankSensorOk) == null ? null : Boolean(data.supply_tank_sensor_ok ?? data.supplyTankSensorOk),
      collectionTankDistanceCm: data.collection_tank_distance_cm ?? data.collectionTankDistanceCm ?? null,
      collectionTankPercent: data.collection_tank_percent ?? data.collectionTankPercent ?? null,
      collectionTankSensorOk: (data.collection_tank_sensor_ok ?? data.collectionTankSensorOk) == null ? null : Boolean(data.collection_tank_sensor_ok ?? data.collectionTankSensorOk),
      isSimulated: Boolean(data.is_simulated ?? data.isSimulated)
    };

    return {
      reading,
      isStale: Boolean(data.is_stale),
      ageSeconds: data.age_seconds ?? null
    };
  },

  async getTelemetryHistory(limit: number = 50): Promise<SensorReading[]> {
    const res = await fetch(`${API_BASE}/api/telemetry/history?limit=${limit}`, { headers: getHeaders() });
    if (!res.ok) throw new Error(`Failed to fetch telemetry history: HTTP ${res.status}`);
    const rows = await res.json();

    return rows.map((r: any) => ({
      id: String(r.id),
      timestamp: r.timestamp,
      temperature: Number(r.temperature),
      humidity: Number(r.humidity),
      soilMoistureRaw: Number(r.soil_moisture_raw ?? r.soilMoistureRaw ?? 0),
      soilMoisturePercent: r.soil_moisture_percent ?? r.soilMoisturePercent ?? null,
      pressure: Number(r.pressure),
      windSpeed: r.wind_speed ?? r.windSpeed ?? null,
      lux: Number(r.lux ?? 0),
      rainDetected: r.rain_detected ?? r.rainDetected ?? null,
      soilSensorOk: (r.soil_sensor_ok ?? r.soilSensorOk) == null ? null : Boolean(r.soil_sensor_ok ?? r.soilSensorOk),
      rainSensorOk: (r.rain_sensor_ok ?? r.rainSensorOk) == null ? null : Boolean(r.rain_sensor_ok ?? r.rainSensorOk),
      windSensorOk: (r.wind_sensor_ok ?? r.windSensorOk) == null ? null : Boolean(r.wind_sensor_ok ?? r.windSensorOk),
      windRaw: r.wind_raw ?? r.windRaw ?? null,
      windVoltageV: r.wind_voltage_v ?? r.windVoltageV ?? null,
      pumpState: Boolean(r.pump_state ?? r.pumpState),
      supplyTankDistanceCm: r.supply_tank_distance_cm ?? r.supplyTankDistanceCm ?? null,
      supplyTankPercent: r.supply_tank_percent ?? r.supplyTankPercent ?? null,
      supplyTankSensorOk: (r.supply_tank_sensor_ok ?? r.supplyTankSensorOk) == null ? null : Boolean(r.supply_tank_sensor_ok ?? r.supplyTankSensorOk),
      collectionTankDistanceCm: r.collection_tank_distance_cm ?? r.collectionTankDistanceCm ?? null,
      collectionTankPercent: r.collection_tank_percent ?? r.collectionTankPercent ?? null,
      collectionTankSensorOk: (r.collection_tank_sensor_ok ?? r.collectionTankSensorOk) == null ? null : Boolean(r.collection_tank_sensor_ok ?? r.collectionTankSensorOk),
      isSimulated: Boolean(r.is_simulated ?? r.isSimulated)
    }));
  },

  async injectSimulatorReading(reading: SensorReading): Promise<{ id: number; command?: any }> {
    const res = await fetch(`${API_BASE}/api/simulator/telemetry`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({
        temperature: reading.temperature,
        humidity: reading.humidity,
        soilMoistureRaw: reading.soilMoistureRaw,
        soilMoisturePercent: reading.soilMoisturePercent,
        pressure: reading.pressure,
        windSpeed: reading.windSpeed,
        lux: reading.lux,
        rainDetected: reading.rainDetected,
        pumpState: reading.pumpState,
        isSoilFault: reading.isSoilFault,
        supplyTankDistanceCm: reading.supplyTankDistanceCm ?? null,
        supplyTankPercent: reading.supplyTankPercent ?? null,
        supplyTankSensorOk: reading.supplyTankSensorOk ?? null,
        collectionTankDistanceCm: reading.collectionTankDistanceCm ?? null,
        collectionTankPercent: reading.collectionTankPercent ?? null,
        collectionTankSensorOk: reading.collectionTankSensorOk ?? null
      })
    });
    if (!res.ok) throw new Error(`Failed to inject simulator telemetry: HTTP ${res.status}`);
    return res.json();
  },

  // ----------------------------------------------------------------------------
  // Remote Pump Commands & Status
  // ----------------------------------------------------------------------------
  async getPumpStatus(): Promise<{
    actualPumpRunning: boolean;
    relayPin: string;
    relayPolarity: string;
    pendingCommand: any;
    lastUpdated: string | null;
  }> {
    const res = await fetch(`${API_BASE}/api/pump/status`, { headers: getHeaders() });
    if (!res.ok) throw new Error(`Failed to fetch pump status: HTTP ${res.status}`);
    return res.json();
  },

  async sendPumpControl(
    command: 'PUMP_ON' | 'PUMP_OFF' | 'EMERGENCY_STOP',
    durationMinutes: number = 5,
    reason: string = 'Manual command from dashboard'
  ): Promise<{ status: string; command: any }> {
    const res = await fetch(`${API_BASE}/api/pump/control`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({
        command,
        durationMinutes,
        reason
      })
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: 'Network error' }));
      throw new Error(err.detail || `Failed to submit pump command: HTTP ${res.status}`);
    }
    return res.json();
  },

  // ----------------------------------------------------------------------------
  // FAO-56 Penman-Monteith & Crop Demand
  // ----------------------------------------------------------------------------
  async getFaoCalculation(lat?: number, elevation?: number, kRs?: number): Promise<FAO56Calculation> {
    const params = new URLSearchParams();
    if (lat !== undefined) params.append('lat', String(lat));
    if (elevation !== undefined) params.append('elevation', String(elevation));
    if (kRs !== undefined) params.append('k_rs', String(kRs));

    const res = await fetch(`${API_BASE}/api/fao56/calculate?${params.toString()}`, { headers: getHeaders() });
    if (!res.ok) throw new Error(`Failed to calculate FAO-56: HTTP ${res.status}`);
    return res.json();
  },

  async getCropDemand(cropParams: {
    crop_name: string;
    stage: string;
    kc: number;
    area_sqm: number;
    efficiency: number;
    pump_flow_rate_lpm: number;
  }): Promise<any> {
    const res = await fetch(`${API_BASE}/api/crop/demand`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(cropParams)
    });
    if (!res.ok) throw new Error(`Failed to calculate crop demand: HTTP ${res.status}`);
    return res.json();
  },

  // ----------------------------------------------------------------------------
  // Predictions
  // ----------------------------------------------------------------------------
  async getPredictions(dryThreshold: number = 35.0): Promise<PredictionResult> {
    const res = await fetch(`${API_BASE}/api/predictions?dry_threshold=${dryThreshold}`, { headers: getHeaders() });
    if (!res.ok) throw new Error(`Failed to fetch predictions: HTTP ${res.status}`);
    return res.json();
  },

  // ----------------------------------------------------------------------------
  // Shared System Settings
  // ----------------------------------------------------------------------------
  async getSettings(): Promise<any> {
    const res = await fetch(`${API_BASE}/api/settings`, { headers: getHeaders() });
    if (!res.ok) throw new Error(`Failed to fetch settings: HTTP ${res.status}`);
    return res.json();
  },

  async updateSettings(settings: Partial<CalibrationSettings & AutomationSettings & CropSettings> & {
    calibration?: Partial<CalibrationSettings>;
    automation?: Partial<AutomationSettings>;
    crop?: Partial<CropSettings>;
    waterTanks?: Partial<WaterTankSettings>;
  }): Promise<any> {
    const res = await fetch(`${API_BASE}/api/settings`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(settings)
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: 'Failed to save settings' }));
      throw new Error(err.detail || `Failed to save settings: HTTP ${res.status}`);
    }
    return res.json();
  },

  // ----------------------------------------------------------------------------
  // Notifications & Alerts
  // ----------------------------------------------------------------------------
  async getNotifications(limit: number = 50): Promise<AlertNotification[]> {
    const res = await fetch(`${API_BASE}/api/notifications?limit=${limit}`, { headers: getHeaders() });
    if (!res.ok) throw new Error(`Failed to fetch notifications: HTTP ${res.status}`);
    const rows = await res.json();
    return rows.map((n: any) => ({
      id: String(n.id),
      timestamp: n.timestamp,
      severity: n.severity,
      title: n.title,
      message: n.message,
      category: n.category,
      acknowledged: Boolean(n.acknowledged)
    }));
  },

  async acknowledgeNotification(id: string | number): Promise<void> {
    const res = await fetch(`${API_BASE}/api/notifications/${id}/acknowledge`, {
      method: 'POST',
      headers: getHeaders()
    });
    if (!res.ok) throw new Error(`Failed to acknowledge notification: HTTP ${res.status}`);
  },

  // ----------------------------------------------------------------------------
  // Export CSV
  // ----------------------------------------------------------------------------
  getExportCsvUrl(): string {
    return `${API_BASE}/api/export/csv`;
  }
};
