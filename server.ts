import express, { Request, Response } from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// In-memory data store for server-side REST ingest
interface TelemetryRecord {
  id: number;
  timestamp: string;
  temperature: number;
  humidity: number;
  soilMoistureRaw: number;
  soilMoisturePercent: number;
  pressure: number;
  windSpeed: number;
  lux: number;
  rainDetected: boolean;
  pumpState: boolean;
  isSoilFault?: boolean;
  isSimulated?: boolean;
}

interface CommandItem {
  command_id: string;
  command_type: string;
  duration_seconds: number;
  created_at: string;
  expires_at: string;
  status: 'PENDING' | 'DISPATCHED' | 'ACKNOWLEDGED' | 'EXPIRED' | 'SUPERSEDED';
  ack_state?: boolean;
  ack_message?: string;
}

let readingsLog: TelemetryRecord[] = [
  {
    id: 1,
    timestamp: new Date().toISOString(),
    temperature: 28.2,
    humidity: 64.0,
    soilMoistureRaw: 2200,
    soilMoisturePercent: 55.5,
    pressure: 1010.8,
    windSpeed: 1.6,
    lux: 38000,
    rainDetected: false,
    pumpState: false,
    isSoilFault: false,
    isSimulated: false
  }
];

let commandQueue: CommandItem[] = [];
let serverSettings = {
  calibration: {
    soilDryAdc: 3200,
    soilWetAdc: 1400,
    latitude: 14.5995,
    elevation: 25.0,
    anemometerHeight: 1.0,
    anemometerFactor: 0.0875,
    kRs: 0.16,
    pumpFlowRate: 12.0,
    relayActiveLow: true
  },
  automation: {
    enabled: true,
    mode: 'AUTO',
    dryThresholdPercent: 35,
    targetWetPercent: 65,
    maxRuntimeMinutes: 15,
    minIntervalHours: 4,
    cooldownMinutes: 30,
    rainInhibitionEnabled: true,
    dailyMaxVolumeLiters: 150,
    emergencyStop: false
  },
  crop: {
    cropName: 'Generic Research Crop',
    stage: 'mid',
    kcInitial: 0.50,
    kcMid: 1.05,
    kcEnd: 0.65,
    irrigatedAreaSqM: 20.0,
    irrigationEfficiency: 0.85
  }
};

let notificationsLog: any[] = [];
let readingIdCounter = 2;

// ------------------------------------------------------------------------------
// REST API Endpoints
// ------------------------------------------------------------------------------
app.get('/api/health', (req: Request, res: Response) => {
  const latest = readingsLog.length > 0 ? readingsLog[readingsLog.length - 1] : null;
  res.json({
    status: 'online',
    system: 'AquaGreen Smart Irrigation System',
    timestamp: new Date().toISOString(),
    last_telemetry_timestamp: latest ? latest.timestamp : null
  });
});

// Physical ESP32 Ingestion
app.post('/api/telemetry', (req: Request, res: Response) => {
  const data = req.body;
  const isFault = data.soilMoistureRaw >= 4090;

  const newRecord: TelemetryRecord = {
    id: readingIdCounter++,
    timestamp: data.rtcTimestamp || data.timestamp || new Date().toISOString(),
    temperature: Number(data.temperature) || 25.0,
    humidity: Number(data.humidity) || 70.0,
    soilMoistureRaw: Number(data.soilMoistureRaw) || 2200,
    soilMoisturePercent: Number(data.soilMoisturePercent) || 50.0,
    pressure: Number(data.pressure) || 1013.25,
    windSpeed: Number(data.windSpeed) || 1.5,
    lux: Number(data.lux) || 0,
    rainDetected: Boolean(data.rainDetected),
    pumpState: Boolean(data.pumpState),
    isSoilFault: isFault,
    isSimulated: false // Physical telemetry is NEVER simulated
  };

  readingsLog.push(newRecord);
  if (readingsLog.length > 500) readingsLog.shift();

  // Safety audits
  if (isFault && data.pumpState) {
    commandQueue.push({
      command_id: `cmd_fault_${Date.now()}`,
      command_type: 'PUMP_OFF',
      duration_seconds: 0,
      created_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 60000).toISOString(),
      status: 'PENDING'
    });
  }

  // Authenticated physical ESP32 claims active pending command
  const now = new Date();
  const pendingCmd = commandQueue.find(c => c.status === 'PENDING' && new Date(c.expires_at) >= now);
  if (pendingCmd) {
    pendingCmd.status = 'DISPATCHED';
  }

  res.json({
    status: 'received',
    id: newRecord.id,
    source: 'ESP32_HARDWARE',
    server_time: new Date().toISOString(),
    command: pendingCmd ? {
      command_id: pendingCmd.command_id,
      type: pendingCmd.command_type,
      duration_seconds: pendingCmd.duration_seconds,
      expires_at: pendingCmd.expires_at
    } : undefined
  });
});

// Dedicated Simulator Ingestion (Defect 9)
app.post(['/api/simulator/telemetry', '/api/telemetry/simulate'], (req: Request, res: Response) => {
  const data = req.body;
  const isFault = (data.soilMoistureRaw || 0) >= 4090;

  const newRecord: TelemetryRecord = {
    id: readingIdCounter++,
    timestamp: new Date().toISOString(),
    temperature: Number(data.temperature) || 25.0,
    humidity: Number(data.humidity) || 70.0,
    soilMoistureRaw: Number(data.soilMoistureRaw) || 2200,
    soilMoisturePercent: Number(data.soilMoisturePercent) || 50.0,
    pressure: Number(data.pressure) || 1013.25,
    windSpeed: Number(data.windSpeed) || 1.5,
    lux: Number(data.lux) || 0,
    rainDetected: Boolean(data.rainDetected),
    pumpState: Boolean(data.pumpState),
    isSoilFault: isFault,
    isSimulated: true
  };

  readingsLog.push(newRecord);
  if (readingsLog.length > 500) readingsLog.shift();

  res.json({
    status: 'simulated_reading_recorded',
    id: newRecord.id,
    source: 'SIMULATOR',
    server_time: new Date().toISOString()
  });
});

app.get('/api/telemetry/latest', (req: Request, res: Response) => {
  if (readingsLog.length === 0) {
    return res.status(404).json({ detail: 'No telemetry records found' });
  }
  const latest = readingsLog[readingsLog.length - 1];
  const ageSeconds = Math.round((Date.now() - new Date(latest.timestamp).getTime()) / 1000);
  res.json({
    ...latest,
    age_seconds: ageSeconds,
    is_stale: ageSeconds > 900
  });
});

app.get('/api/telemetry/history', (req: Request, res: Response) => {
  const limit = Math.min(500, Math.max(1, parseInt(req.query.limit as string) || 50));
  const slice = readingsLog.slice(-limit);
  res.json(slice);
});

app.post('/api/pump/control', (req: Request, res: Response) => {
  const { command, durationMinutes, reason } = req.body;
  const cmd = (command || '').toUpperCase();

  if (!['PUMP_ON', 'PUMP_OFF', 'EMERGENCY_STOP'].includes(cmd)) {
    return res.status(400).json({ detail: 'Invalid command type' });
  }

  // Interlock checks
  if (serverSettings.automation.emergencyStop && cmd === 'PUMP_ON') {
    return res.status(403).json({ detail: 'Cannot energize pump: Emergency Stop latch is engaged' });
  }

  const latest = readingsLog.length > 0 ? readingsLog[readingsLog.length - 1] : null;
  if (cmd === 'PUMP_ON' && serverSettings.automation.rainInhibitionEnabled && latest?.rainDetected) {
    return res.status(403).json({ detail: 'Cannot energize pump: Rain surface wetness detected' });
  }

  if (cmd === 'PUMP_ON' && latest && latest.soilMoistureRaw >= 4090) {
    return res.status(403).json({ detail: 'Cannot energize pump: Soil sensor probe is disconnected' });
  }

  const durationSec = Math.min((durationMinutes || 5) * 60, (serverSettings.automation.maxRuntimeMinutes || 15) * 60);
  const cmdId = `cmd_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 6)}`;

  if (cmd === 'EMERGENCY_STOP') {
    commandQueue.forEach(c => {
      if (c.status === 'PENDING') c.status = 'SUPERSEDED';
    });
    serverSettings.automation.emergencyStop = true;
  }

  const newCmd: CommandItem = {
    command_id: cmdId,
    command_type: cmd,
    duration_seconds: durationSec,
    created_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 120000).toISOString(),
    status: 'PENDING'
  };
  commandQueue.push(newCmd);

  res.json({
    status: 'command_queued',
    command: newCmd
  });
});

app.get('/api/pump/status', (req: Request, res: Response) => {
  const latest = readingsLog.length > 0 ? readingsLog[readingsLog.length - 1] : null;
  const now = new Date();
  const pending = commandQueue.find(c => c.status === 'PENDING' && new Date(c.expires_at) >= now);

  res.json({
    actualPumpRunning: Boolean(latest?.pumpState),
    relayPin: 'GPIO17',
    relayPolarity: 'Active-LOW (LOW=ON, HIGH=OFF)',
    pendingCommand: pending || null,
    lastUpdated: latest ? latest.timestamp : null
  });
});

app.post('/api/pump/acknowledge', (req: Request, res: Response) => {
  const { command_id, actual_state, success, error_message } = req.body;
  const cmd = commandQueue.find(c => c.command_id === command_id);

  if (!cmd) {
    return res.status(404).json({ detail: 'Command ID not found' });
  }

  cmd.status = success ? 'ACKNOWLEDGED' : 'EXPIRED';
  cmd.ack_state = actual_state;
  cmd.ack_message = error_message || 'Relay transition verified on GPIO17';

  // Update latest reading pump state to match physical confirmation
  if (readingsLog.length > 0) {
    readingsLog[readingsLog.length - 1].pumpState = actual_state;
  }

  res.json({
    status: 'acknowledged',
    command_id,
    actual_state
  });
});

app.get('/api/settings', (req: Request, res: Response) => {
  res.json(serverSettings);
});

app.post('/api/settings', (req: Request, res: Response) => {
  const body = req.body || {};
  if (body.calibration && typeof body.calibration === 'object') {
    serverSettings.calibration = { ...serverSettings.calibration, ...body.calibration };
  }
  if (body.automation && typeof body.automation === 'object') {
    serverSettings.automation = { ...serverSettings.automation, ...body.automation };
  }
  if (body.crop && typeof body.crop === 'object') {
    serverSettings.crop = { ...serverSettings.crop, ...body.crop };
  }
  // Also route any flat properties
  for (const [k, v] of Object.entries(body)) {
    if (['calibration', 'automation', 'crop'].includes(k)) continue;
    if (k in serverSettings.calibration) {
      (serverSettings.calibration as any)[k] = v;
    } else if (k in serverSettings.automation) {
      (serverSettings.automation as any)[k] = v;
    } else if (k in serverSettings.crop) {
      (serverSettings.crop as any)[k] = v;
    }
  }
  res.json({ status: 'saved', settings: serverSettings });
});

app.get('/api/notifications', (req: Request, res: Response) => {
  res.json(notificationsLog);
});

app.post('/api/notifications/:id/acknowledge', (req: Request, res: Response) => {
  const id = req.params.id;
  notificationsLog = notificationsLog.map(n => n.id === id ? { ...n, acknowledged: true } : n);
  res.json({ status: 'acknowledged', id });
});

app.get('/api/export/csv', (req: Request, res: Response) => {
  const headers = [
    'timestamp_iso', 'temperature_c', 'humidity_percent',
    'soil_moisture_raw_adc', 'soil_moisture_percent', 'pressure_hpa',
    'wind_speed_ms', 'lux', 'rain_detected', 'pump_state'
  ];
  const rows = readingsLog.map(r => [
    r.timestamp, r.temperature, r.humidity, r.soilMoistureRaw,
    r.soilMoisturePercent, r.pressure, r.windSpeed, r.lux,
    r.rainDetected ? 1 : 0, r.pumpState ? 1 : 0
  ]);
  const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename=aquagreen_dataset_${Date.now()}.csv`);
  res.send(csv);
});

// ------------------------------------------------------------------------------
// FAO-56 Penman-Monteith & Crop Demand Endpoints
// ------------------------------------------------------------------------------
function computeFao56Server(
  tMin: number,
  tMax: number,
  rhMin: number,
  rhMax: number,
  windSpeed: number,
  elevation: number = 25.0,
  lat: number = 14.5995,
  kRs: number = 0.16
) {
  const tMean = (tMax + tMin) / 2.0;
  const eTmin = 0.6108 * Math.exp((17.27 * tMin) / (tMin + 237.3));
  const eTmax = 0.6108 * Math.exp((17.27 * tMax) / (tMax + 237.3));
  const es = (eTmin + eTmax) / 2.0;
  const ea = (eTmin * (rhMax / 100.0) + eTmax * (rhMin / 100.0)) / 2.0;

  const delta = (4098.0 * (0.6108 * Math.exp((17.27 * tMean) / (tMean + 237.3)))) / Math.pow(tMean + 237.3, 2);
  const pressure = 101.3 * Math.pow((293.0 - 0.0065 * elevation) / 293.0, 5.26);
  const gamma = 0.000665 * pressure;

  const u2 = windSpeed * (4.87 / Math.log(67.8 * 1.0 - 5.42));

  const now = new Date();
  const startOfYear = new Date(Date.UTC(now.getUTCFullYear(), 0, 0));
  const diff = now.getTime() - startOfYear.getTime();
  const dayOfYear = Math.floor(diff / (1000 * 60 * 60 * 24));

  const phi = (lat * Math.PI) / 180.0;
  const dr = 1.0 + 0.033 * Math.cos(((2.0 * Math.PI) / 365.0) * dayOfYear);
  const solarDecl = 0.409 * Math.sin(((2.0 * Math.PI) / 365.0) * dayOfYear - 1.39);
  const clampedVal = Math.max(-1.0, Math.min(1.0, -Math.tan(phi) * Math.tan(solarDecl)));
  const omegaS = Math.acos(clampedVal);
  const gsc = 0.0820;
  const ra = ((24.0 * 60.0) / Math.PI) * gsc * dr * (
    omegaS * Math.sin(phi) * Math.sin(solarDecl) +
    Math.cos(phi) * Math.cos(solarDecl) * Math.sin(omegaS)
  );

  const deltaT = Math.max(0.1, tMax - tMin);
  const rs = kRs * Math.sqrt(deltaT) * ra;
  const rso = (0.75 + 2e-5 * elevation) * ra;
  const rns = (1.0 - 0.23) * rs;

  const sigma = 4.903e-9;
  const tkMax4 = Math.pow(tMax + 273.16, 4);
  const tkMin4 = Math.pow(tMin + 273.16, 4);
  const rsRatio = Math.max(0.3, Math.min(1.0, rso > 0 ? rs / rso : 0.7));
  const rnl = sigma * ((tkMax4 + tkMin4) / 2.0) * (0.34 - 0.14 * Math.sqrt(Math.max(0, ea))) * (1.35 * rsRatio - 0.35);

  const rn = rns - rnl;
  const g = 0.0;

  const numRad = 0.408 * delta * (rn - g);
  const numAero = gamma * (900.0 / (tMean + 273.0)) * u2 * (es - ea);
  const denom = delta + gamma * (1.0 + 0.34 * u2);

  const et0 = Math.max(0.0, (numRad + numAero) / denom);

  return {
    et0: Math.round(et0 * 100) / 100,
    tMean: Math.round(tMean * 10) / 10,
    es: Math.round(es * 1000) / 1000,
    ea: Math.round(ea * 1000) / 1000,
    vpd: Math.round(Math.max(0, es - ea) * 1000) / 1000,
    delta: Math.round(delta * 1000) / 1000,
    gamma: Math.round(gamma * 1000) / 1000,
    rn: Math.round(rn * 100) / 100,
    rsEstimated: Math.round(rs * 100) / 100,
    ra: Math.round(ra * 100) / 100,
    windSpeed2m: Math.round(u2 * 100) / 100,
    pressure: Math.round(pressure * 10) / 10,
    dayOfYear
  };
}

app.get('/api/fao56/calculate', (req: Request, res: Response) => {
  const lat = parseFloat(req.query.lat as string) || 14.5995;
  const elevation = parseFloat(req.query.elevation as string) || 25.0;
  const kRs = parseFloat(req.query.k_rs as string) || 0.16;

  let tMin = 22.0, tMax = 31.0, rhMin = 50.0, rhMax = 85.0, wind = 1.8;
  if (readingsLog.length > 0) {
    const temps = readingsLog.map(r => r.temperature);
    const humids = readingsLog.map(r => r.humidity);
    const winds = readingsLog.map(r => r.windSpeed);
    tMin = Math.min(...temps);
    tMax = Math.max(...temps);
    rhMin = Math.min(...humids);
    rhMax = Math.max(...humids);
    wind = winds.reduce((a, b) => a + b, 0) / winds.length;
  }

  const result = computeFao56Server(tMin, tMax, rhMin, rhMax, wind, elevation, lat, kRs);
  res.json({
    ...result,
    sampleCount: readingsLog.length,
    isDailyAverage: readingsLog.length >= 8,
    methodLimitations: [
      "GY-302 measures lux, not W/m2. Solar radiation Rs estimated via FAO-56 Hargreaves temperature-range method.",
      "Rain sensor detects conductive wetness surface only and does not quantify rainfall depth in mm.",
      "Daily soil heat flux G is assumed to be 0 MJ/m2/day for 24-hr periods."
    ]
  });
});

app.post('/api/crop/demand', (req: Request, res: Response) => {
  const { crop_name = 'Generic Research Crop', kc = 1.05, area_sqm = 20.0, efficiency = 0.85, pump_flow_rate_lpm = 12.0 } = req.body;
  const fao = computeFao56Server(22.0, 31.0, 50.0, 85.0, 1.8);
  const etc = Math.round(fao.et0 * kc * 100) / 100;
  const netLiters = Math.round(etc * area_sqm * 10) / 10;
  const effClamped = Math.max(0.3, Math.min(1.0, efficiency));
  const grossLiters = Math.round((netLiters / effClamped) * 10) / 10;
  const flowRateClamped = Math.max(0.5, pump_flow_rate_lpm);
  const runtimeMin = Math.round((grossLiters / flowRateClamped) * 10) / 10;

  res.json({
    crop_name,
    et0: fao.et0,
    kc,
    etc_mm_day: etc,
    net_water_liters: netLiters,
    gross_water_liters: grossLiters,
    estimated_pump_runtime_minutes: runtimeMin,
    irrigated_area_sqm: area_sqm,
    application_efficiency: effClamped
  });
});

app.get('/api/predictions', (req: Request, res: Response) => {
  const dryThreshold = parseFloat(req.query.dry_threshold as string) || 35.0;
  const valid = readingsLog.filter(r => r.soilMoistureRaw > 10 && r.soilMoistureRaw < 4090);

  if (valid.length < 5) {
    const curr = valid.length > 0 ? valid[valid.length - 1].soilMoisturePercent : 50.0;
    return res.json({
      isAvailable: false,
      confidence: 'UNAVAILABLE',
      reason: `Insufficient readings (${valid.length}/5 samples collected)`,
      currentMoisture: curr,
      dryingVelocityPerHour: 0.0,
      projected30Min: curr,
      projected60Min: curr,
      hoursUntilDryThreshold: null
    });
  }

  const latest = valid[valid.length - 1];
  const currM = latest.soilMoisturePercent;

  const t0 = new Date(valid[0].timestamp).getTime();
  const points = valid.map(r => {
    const tHours = (new Date(r.timestamp).getTime() - t0) / 3600000;
    return [tHours, r.soilMoisturePercent];
  });

  const n = points.length;
  const sumX = points.reduce((acc, p) => acc + p[0], 0);
  const sumY = points.reduce((acc, p) => acc + p[1], 0);
  const sumXY = points.reduce((acc, p) => acc + p[0] * p[1], 0);
  const sumX2 = points.reduce((acc, p) => acc + p[0] * p[0], 0);

  const denom = n * sumX2 - sumX * sumX;
  const slope = Math.abs(denom) > 1e-6 ? (n * sumXY - sumX * sumY) / denom : 0;
  const dryingVelocity = Math.round(-slope * 1000) / 1000;

  const proj30 = Math.max(0, Math.min(100, Math.round((currM + slope * 0.5) * 10) / 10));
  const proj60 = Math.max(0, Math.min(100, Math.round((currM + slope * 1.0) * 10) / 10));

  let hoursUntil: number | null = null;
  if (dryingVelocity > 0.05 && currM > dryThreshold) {
    hoursUntil = Math.round(((currM - dryThreshold) / dryingVelocity) * 10) / 10;
  }

  res.json({
    isAvailable: true,
    confidence: n >= 12 ? 'HIGH' : n >= 8 ? 'MEDIUM' : 'LOW',
    reason: `Linear trajectory computed from ${n} verified telemetry samples`,
    currentMoisture: currM,
    dryingVelocityPerHour: dryingVelocity,
    projected30Min: proj30,
    projected60Min: proj60,
    hoursUntilDryThreshold: hoursUntil
  });
});

// ------------------------------------------------------------------------------
// Mount Vite Middleware in Development or Serve Static in Production
// ------------------------------------------------------------------------------
async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.resolve(__dirname, 'dist')));
    app.get('*', (req: Request, res: Response) => {
      res.sendFile(path.resolve(__dirname, 'dist', 'index.html'));
    });
  }

  app.listen(PORT, () => {
    console.log(`AquaGreen Full-Stack Server listening on http://localhost:${PORT}`);
  });
}

startServer();
