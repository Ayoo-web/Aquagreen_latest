import React from 'react';
import {
  Activity,
  AlertTriangle,
  Clock,
  CloudRain,
  Compass,
  Droplets,
  Gauge,
  Power,
  Sun,
  Thermometer,
  Wind
} from 'lucide-react';
import { DecisionResult } from '../services/irrigationEngine';
import {
  AutomationSettings,
  CalibrationSettings,
  FAO56Calculation,
  SensorReading,
  WaterTankSettings
} from '../types';

interface OverviewTabProps {
  latestReading: SensorReading | null;
  readings: SensorReading[];
  faoCalculation: FAO56Calculation | null;
  calibration: CalibrationSettings;
  automation: AutomationSettings;
  waterTanks: WaterTankSettings;
  decisionState: DecisionResult;
  onTogglePumpManual: () => void;
  onOpenSettings: () => void;
  esp32Online: boolean;
  activePumpDurationSeconds: number;
}

export const OverviewTab: React.FC<OverviewTabProps> = ({
  latestReading,
  readings,
  faoCalculation,
  calibration,
  automation,
  waterTanks,
  decisionState,
  onTogglePumpManual,
  onOpenSettings,
  esp32Online,
  activePumpDurationSeconds
}) => {
  if (!latestReading) {
    return (
      <div className="p-8 text-center bg-white border border-slate-200 rounded-xl">
        <Activity className="w-8 h-8 mx-auto text-slate-400 animate-pulse mb-3" />
        <h3 className="text-base font-semibold text-slate-900">Awaiting Sensor Telemetry</h3>
        <p className="text-xs text-slate-500 mt-1 max-w-md mx-auto">
          No records found. Connect your ESP32 controller or launch the hardware simulator to stream sensor readings.
        </p>
      </div>
    );
  }

  // Calculate staleness (readings older than 15 minutes flagged as stale)
  const lastUpdated = new Date(latestReading.timestamp);
  const ageSeconds = Math.round((Date.now() - lastUpdated.getTime()) / 1000);
  const isStale = ageSeconds > 900;

  // Check for ADC fault condition (open circuit)
  const isAdcFault = latestReading.soilMoistureRaw >= 4090;

  // Recent 24 readings for mini trend sparks
  const sparklineData = readings.slice(-24);

  return (
    <div className="space-y-6">
      {/* 1. System Telemetry Ribbon */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-xs">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex flex-wrap items-center gap-6">
            {/* ESP32 Hardware Status */}
            <div className="flex items-center gap-2">
              <span className={`w-2.5 h-2.5 rounded-full ${esp32Online ? 'bg-emerald-500' : 'bg-slate-400'}`} />
              <div>
                <div className="text-xs font-semibold text-slate-900">
                  {esp32Online ? 'ESP32 Controller Active' : 'ESP32 Telemetry Idle'}
                </div>
                <div className="text-[11px] text-slate-500 font-mono">
                  {latestReading.isSimulated ? 'Source: Hardware Simulator' : 'Source: Physical HTTP Telemetry'}
                </div>
              </div>
            </div>

            {/* Telemetry Age */}
            <div className="flex items-center gap-2 border-l border-slate-200 pl-4">
              <Clock className="w-3.5 h-3.5 text-slate-400" />
              <div>
                <div className="text-xs font-medium text-slate-700">Last Telemetry Sync</div>
                <div className={`text-[11px] font-mono ${isStale ? 'text-amber-600 font-semibold' : 'text-slate-500'}`}>
                  {isStale ? `Stale (${Math.round(ageSeconds / 60)}m ago)` : `${ageSeconds}s ago`} · {lastUpdated.toLocaleTimeString()}
                </div>
              </div>
            </div>

            {/* Operating Mode */}
            <div className="flex items-center gap-2 border-l border-slate-200 pl-4">
              <Compass className="w-3.5 h-3.5 text-slate-400" />
              <div>
                <div className="text-xs font-medium text-slate-700">Operating Mode</div>
                <div className="text-[11px] font-semibold text-emerald-800">
                  {automation.mode} · {automation.enabled ? 'Automation Armed' : 'Disarmed'}
                </div>
              </div>
            </div>
          </div>

          {/* Controller Decision State Tracker */}
          <div className="flex items-center gap-3 bg-slate-50 border border-slate-200 px-3 py-1.5 rounded-lg max-w-md">
            <span className={`w-2 h-2 rounded-full shrink-0 ${
              decisionState.action === 'MAINTAIN_ON' || decisionState.action === 'START_PUMP'
                ? 'bg-blue-600 animate-pulse'
                : decisionState.isPermitted
                ? 'bg-emerald-500'
                : 'bg-amber-500'
            }`} />
            <div className="truncate">
              <div className="text-[11px] font-semibold text-slate-900 truncate">
                {decisionState.stateLabel}
              </div>
              <div className="text-[10px] text-slate-500 truncate" title={decisionState.reason}>
                {decisionState.reason}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Staleness / Fault Notification Banner */}
      {isAdcFault && (
        <div className="flex items-center gap-3 bg-rose-50 border border-rose-200 text-rose-800 p-3 rounded-xl text-xs">
          <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
          <div>
            <span className="font-semibold">Sensor Fault Detected:</span> Soil moisture ADC is reporting 4095. This indicates an open-circuit, disconnected wiring, or sensor saturation. Automatic watering is automatically blocked.
          </div>
        </div>
      )}

      {/* Water supply and collection tank levels */}
      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-bold text-slate-900">Water Storage Monitoring</h2>
            <p className="text-xs text-slate-500">Ultrasonic tank levels · live percentage is based on your empty/full distance calibration</p>
          </div>
          <button type="button" onClick={onOpenSettings} className="text-xs font-semibold text-emerald-800 hover:text-emerald-950 underline underline-offset-2">Alert thresholds</button>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {[
            {
              key: 'supply', title: 'Water Supply Tank', subtitle: 'Protects pump from running dry', percent: latestReading.supplyTankPercent, distance: latestReading.supplyTankDistanceCm, sensorOk: latestReading.supplyTankSensorOk, warning: latestReading.supplyTankPercent != null && latestReading.supplyTankPercent <= waterTanks.supplyLowThresholdPercent, threshold: waterTanks.supplyLowThresholdPercent, warningLabel: 'Low water', icon: 'supply'
            },
            {
              key: 'collection', title: 'Water Collection Tank', subtitle: 'Warns when storage is nearly full', percent: latestReading.collectionTankPercent, distance: latestReading.collectionTankDistanceCm, sensorOk: latestReading.collectionTankSensorOk, warning: latestReading.collectionTankPercent != null && latestReading.collectionTankPercent >= waterTanks.collectionHighThresholdPercent, threshold: waterTanks.collectionHighThresholdPercent, warningLabel: 'Almost full', icon: 'collection'
            }
          ].map(tank => {
            const valid = tank.percent != null && Number.isFinite(Number(tank.percent)) && tank.sensorOk === true;
            const pct = valid ? Math.max(0, Math.min(100, Number(tank.percent))) : null;
            const barColor = !valid ? 'bg-slate-300' : tank.warning ? (tank.key === 'supply' ? 'bg-rose-500' : 'bg-amber-500') : 'bg-emerald-500';
            return (
              <div key={tank.key} className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-bold text-slate-900">{tank.title}</h3>
                    <p className="text-[11px] text-slate-500 mt-0.5">{tank.subtitle}</p>
                  </div>
                  <span className={`text-[10px] font-bold px-2 py-1 rounded-full ${!valid ? 'bg-slate-100 text-slate-600' : tank.warning ? (tank.key === 'supply' ? 'bg-rose-100 text-rose-800' : 'bg-amber-100 text-amber-800') : 'bg-emerald-100 text-emerald-800'}`}>
                    {!valid ? (tank.sensorOk === false ? 'SENSOR ERROR' : 'CALIBRATION NEEDED') : tank.warning ? tank.warningLabel.toUpperCase() : 'NORMAL'}
                  </span>
                </div>
                <div className="flex items-end justify-between mt-5 gap-3">
                  <div className="flex items-baseline gap-1">
                    <span className={`text-4xl font-bold font-mono tabular-nums ${valid && tank.warning ? (tank.key === 'supply' ? 'text-rose-600' : 'text-amber-600') : 'text-slate-900'}`}>{pct == null ? '—' : pct.toFixed(1)}</span>
                    <span className="text-sm text-slate-500">%</span>
                  </div>
                  <div className="text-right text-[11px] text-slate-500">
                    <div>Alert at {tank.key === 'supply' ? '≤' : '≥'} {tank.threshold}%</div>
                    <div className="mt-1">Distance: {tank.distance == null ? '—' : `${Number(tank.distance).toFixed(1)} cm`}</div>
                  </div>
                </div>
                <div className="h-3 w-full mt-3 rounded-full bg-slate-100 overflow-hidden">
                  <div className={`h-full rounded-full transition-all duration-500 ${barColor}`} style={{ width: `${pct ?? 0}%` }} />
                </div>
                {!valid && <p className="mt-3 text-[11px] text-amber-700">{tank.sensorOk === false ? 'No valid ultrasonic echo. Check wiring, power, and the ECHO voltage divider.' : 'Set this tank’s measured empty and safe-full sensor distances in the ESP32 Wi-Fi setup portal.'}</p>}
                {valid && tank.warning && <p className="mt-3 text-[11px] font-semibold text-rose-700">{tank.key === 'supply' ? 'Refill the supply tank. Pump dry-run protection should stop irrigation at its local cutoff.' : 'Collection tank is near capacity. Check the collection/overflow route.'}</p>}
              </div>
            );
          })}
        </div>
      </section>

      {/* 2. Sensor Metric Cards Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Card 1: Soil Moisture */}
        <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-xs">
          <div className="flex items-center justify-between text-slate-500 mb-2">
            <span className="text-xs font-semibold tracking-wide uppercase">Soil Moisture</span>
            <Droplets className="w-4 h-4 text-blue-600" />
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-bold font-mono text-slate-900 tabular-nums">
              {latestReading.soilMoisturePercent}%
            </span>
            <span className="text-[11px] font-mono text-slate-400">
              ADC {latestReading.soilMoistureRaw}
            </span>
          </div>
          <div className="mt-2 flex items-center justify-between text-[11px] text-slate-500">
            <span>Dry: {automation.dryThresholdPercent}%</span>
            <span>Wet: {automation.targetWetPercent}%</span>
          </div>
          {/* Progress bar */}
          <div className="w-full bg-slate-100 rounded-full h-1.5 mt-2 overflow-hidden">
            <div
              className={`h-full transition-all duration-500 ${
                latestReading.soilMoisturePercent <= automation.dryThresholdPercent
                  ? 'bg-rose-500'
                  : latestReading.soilMoisturePercent >= automation.targetWetPercent
                  ? 'bg-blue-600'
                  : 'bg-emerald-600'
              }`}
              style={{ width: `${Math.min(100, Math.max(0, latestReading.soilMoisturePercent))}%` }}
            />
          </div>
          <div className="mt-2 text-[10px] text-slate-400">
            Calibrated (Dry {calibration.soilDryAdc} · Wet {calibration.soilWetAdc})
          </div>
        </div>

        {/* Card 2: Air Temperature */}
        <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-xs">
          <div className="flex items-center justify-between text-slate-500 mb-2">
            <span className="text-xs font-semibold tracking-wide uppercase">Air Temperature</span>
            <Thermometer className="w-4 h-4 text-amber-600" />
          </div>
          <div className="flex items-baseline gap-1">
            <span className="text-2xl font-bold font-mono text-slate-900 tabular-nums">
              {latestReading.temperature.toFixed(1)}
            </span>
            <span className="text-xs font-mono text-slate-500">°C</span>
          </div>
          <div className="mt-2 text-[11px] text-slate-500">
            DHT22 Sensor · 24h Mean: {faoCalculation ? `${faoCalculation.tMean}°C` : 'N/A'}
          </div>
          <div className="mt-1 text-[10px] text-slate-400">
            Min: {faoCalculation ? `${faoCalculation.tMin}°C` : 'N/A'} · Max: {faoCalculation ? `${faoCalculation.tMax}°C` : 'N/A'}
          </div>
        </div>

        {/* Card 3: Relative Humidity */}
        <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-xs">
          <div className="flex items-center justify-between text-slate-500 mb-2">
            <span className="text-xs font-semibold tracking-wide uppercase">Relative Humidity</span>
            <Activity className="w-4 h-4 text-cyan-600" />
          </div>
          <div className="flex items-baseline gap-1">
            <span className="text-2xl font-bold font-mono text-slate-900 tabular-nums">
              {latestReading.humidity.toFixed(1)}
            </span>
            <span className="text-xs font-mono text-slate-500">%</span>
          </div>
          <div className="mt-2 text-[11px] text-slate-500">
            DHT22 Sensor · VPD: {faoCalculation ? `${faoCalculation.vpd} kPa` : 'N/A'}
          </div>
          <div className="mt-1 text-[10px] text-slate-400">
            Min: {faoCalculation ? `${faoCalculation.rhMin}%` : 'N/A'} · Max: {faoCalculation ? `${faoCalculation.rhMax}%` : 'N/A'}
          </div>
        </div>

        {/* Card 4: Atmospheric Pressure */}
        <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-xs">
          <div className="flex items-center justify-between text-slate-500 mb-2">
            <span className="text-xs font-semibold tracking-wide uppercase">Atmospheric Pressure</span>
            <Gauge className="w-4 h-4 text-indigo-600" />
          </div>
          <div className="flex items-baseline gap-1">
            <span className="text-2xl font-bold font-mono text-slate-900 tabular-nums">
              {latestReading.pressure.toFixed(1)}
            </span>
            <span className="text-xs font-mono text-slate-500">hPa</span>
          </div>
          <div className="mt-2 text-[11px] text-slate-500">
            BMP280 Sensor · Elevation {calibration.elevation} m
          </div>
          <div className="mt-1 text-[10px] text-slate-400">
            P = {(latestReading.pressure / 10).toFixed(2)} kPa
          </div>
        </div>

        {/* Card 5: Wind Speed */}
        <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-xs">
          <div className="flex items-center justify-between text-slate-500 mb-2">
            <span className="text-xs font-semibold tracking-wide uppercase">Wind Speed</span>
            <Wind className="w-4 h-4 text-teal-600" />
          </div>
          <div className="flex items-baseline gap-1">
            <span className="text-2xl font-bold font-mono text-slate-900 tabular-nums">
              {latestReading.windSpeed.toFixed(2)}
            </span>
            <span className="text-xs font-mono text-slate-500">m/s</span>
          </div>
          <div className="mt-2 text-[11px] text-slate-500">
            Height {calibration.anemometerHeight}m · Adjusted u₂: {faoCalculation ? `${faoCalculation.windSpeed2m} m/s` : 'N/A'}
          </div>
          <div className="mt-1 text-[10px] text-slate-400">
            FAO-56 2-meter log wind profile correction
          </div>
        </div>

        {/* Card 6: Illuminance (Lux) */}
        <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-xs">
          <div className="flex items-center justify-between text-slate-500 mb-2">
            <span className="text-xs font-semibold tracking-wide uppercase">Illuminance</span>
            <Sun className="w-4 h-4 text-amber-500" />
          </div>
          <div className="flex items-baseline gap-1">
            <span className="text-2xl font-bold font-mono text-slate-900 tabular-nums">
              {latestReading.lux.toLocaleString()}
            </span>
            <span className="text-xs font-mono text-slate-500">lux</span>
          </div>
          <div className="mt-2 text-[11px] text-amber-700 font-medium">
            GY-302 / BH1750 Sensor
          </div>
          <div className="mt-1 text-[10px] text-slate-400">
            Note: Lux ≠ Solar Radiation (Rs estimated via FAO-56)
          </div>
        </div>

        {/* Card 7: Rain Sensor Status */}
        <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-xs">
          <div className="flex items-center justify-between text-slate-500 mb-2">
            <span className="text-xs font-semibold tracking-wide uppercase">Rain Surface</span>
            <CloudRain className="w-4 h-4 text-blue-500" />
          </div>
          <div className="flex items-baseline gap-2">
            <span className={`text-2xl font-bold ${latestReading.rainDetected ? 'text-blue-600' : 'text-slate-900'}`}>
              {latestReading.rainDetected ? 'Wet Surface' : 'Dry Surface'}
            </span>
          </div>
          <div className="mt-2 text-[11px] text-slate-500">
            Rain Sensor on GPIO34
          </div>
          <div className="mt-1 text-[10px] text-slate-400">
            {automation.rainInhibitionEnabled ? 'Rain Inhibit: Armed' : 'Rain Inhibit: Bypassed'}
          </div>
        </div>

        {/* Card 8: Active Pump & Water Demand */}
        <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-xs">
          <div className="flex items-center justify-between text-slate-500 mb-2">
            <span className="text-xs font-semibold tracking-wide uppercase">Irrigation Pump</span>
            <Power className={`w-4 h-4 ${latestReading.pumpState ? 'text-blue-600 animate-pulse' : 'text-slate-400'}`} />
          </div>
          <div className="flex items-baseline justify-between">
            <div className="flex items-baseline gap-2">
              <span className={`text-2xl font-bold font-mono ${latestReading.pumpState ? 'text-blue-600' : 'text-slate-900'}`}>
                {latestReading.pumpState ? 'RUNNING' : 'STOPPED'}
              </span>
            </div>
            <button
              onClick={onTogglePumpManual}
              className={`px-3 py-1 text-xs font-semibold rounded transition-colors ${
                latestReading.pumpState
                  ? 'bg-rose-100 text-rose-800 hover:bg-rose-200'
                  : 'bg-emerald-100 text-emerald-800 hover:bg-emerald-200'
              }`}
            >
              {latestReading.pumpState ? 'Turn OFF' : 'Turn ON'}
            </button>
          </div>
          <div className="mt-2 text-[11px] text-slate-500 font-mono">
            {latestReading.pumpState ? (
              <span className="text-blue-700 font-semibold">
                Running for: {Math.floor(activePumpDurationSeconds / 60)}m {activePumpDurationSeconds % 60}s
              </span>
            ) : (
              <span>Relay: GPIO17 (Active-LOW: {calibration.relayActiveLow ? 'Verified' : 'Inverted'})</span>
            )}
          </div>
          <div className="mt-1 text-[10px] text-slate-400">
            Flow: {calibration.pumpFlowRate} L/min · Max: {automation.maxRuntimeMinutes}m
          </div>
        </div>
      </div>

      {/* 3. Trend Charts Section */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Soil Moisture Trend Chart */}
        <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-sm font-semibold text-slate-900">Soil Moisture & Threshold Dynamics</h3>
              <p className="text-xs text-slate-500">24-hour time-series with hysteresis thresholds</p>
            </div>
            <div className="flex items-center gap-4 text-xs font-mono text-slate-500">
              <span className="flex items-center gap-1.5">
                <span className="w-2.5 h-0.5 bg-blue-600 inline-block" /> Moisture %
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-2.5 h-0.5 border-t border-dashed border-rose-500 inline-block" /> Dry ({automation.dryThresholdPercent}%)
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-2.5 h-0.5 border-t border-dashed border-emerald-500 inline-block" /> Wet ({automation.targetWetPercent}%)
              </span>
            </div>
          </div>

          {/* SVG Line Chart */}
          <div className="h-48 w-full">
            <svg className="w-full h-full overflow-visible" viewBox="0 0 500 150">
              {/* Threshold guide lines */}
              <line
                x1="0"
                y1={150 - (automation.dryThresholdPercent / 100) * 150}
                x2="500"
                y2={150 - (automation.dryThresholdPercent / 100) * 150}
                stroke="#F43F5E"
                strokeDasharray="4 4"
                strokeWidth="1"
              />
              <line
                x1="0"
                y1={150 - (automation.targetWetPercent / 100) * 150}
                x2="500"
                y2={150 - (automation.targetWetPercent / 100) * 150}
                stroke="#10B981"
                strokeDasharray="4 4"
                strokeWidth="1"
              />

              {/* Data polyline */}
              {sparklineData.length > 1 && (
                <polyline
                  fill="none"
                  stroke="#2563EB"
                  strokeWidth="2.5"
                  points={sparklineData
                    .map((d, index) => {
                      const x = (index / (sparklineData.length - 1)) * 500;
                      const y = 150 - (Math.min(100, Math.max(0, d.soilMoisturePercent)) / 100) * 150;
                      return `${x},${y}`;
                    })
                    .join(' ')}
                />
              )}

              {/* End circle */}
              {sparklineData.length > 0 && (
                <circle
                  cx="500"
                  cy={150 - (Math.min(100, Math.max(0, sparklineData[sparklineData.length - 1].soilMoisturePercent)) / 100) * 150}
                  r="4"
                  fill="#2563EB"
                />
              )}
            </svg>
          </div>
          <div className="flex justify-between text-[11px] text-slate-400 font-mono mt-2 pt-2 border-t border-slate-100">
            <span>24 hours ago</span>
            <span>Current: {latestReading.soilMoisturePercent}%</span>
          </div>
        </div>

        {/* Ambient Temperature & Relative Humidity Diurnal Chart */}
        <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-sm font-semibold text-slate-900">Atmospheric Diurnal Rhythm</h3>
              <p className="text-xs text-slate-500">Air temperature (°C) and relative humidity (%)</p>
            </div>
            <div className="flex items-center gap-4 text-xs font-mono text-slate-500">
              <span className="flex items-center gap-1.5">
                <span className="w-2.5 h-0.5 bg-amber-500 inline-block" /> Temp (°C)
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-2.5 h-0.5 bg-cyan-600 inline-block" /> Humidity (%)
              </span>
            </div>
          </div>

          <div className="h-48 w-full">
            <svg className="w-full h-full overflow-visible" viewBox="0 0 500 150">
              {/* Temperature line (scaled 15°C to 40°C) */}
              {sparklineData.length > 1 && (
                <polyline
                  fill="none"
                  stroke="#F59E0B"
                  strokeWidth="2"
                  points={sparklineData
                    .map((d, index) => {
                      const x = (index / (sparklineData.length - 1)) * 500;
                      const y = 150 - ((d.temperature - 15) / 25) * 150;
                      return `${x},${Math.max(5, Math.min(145, y))}`;
                    })
                    .join(' ')}
                />
              )}

              {/* Humidity line (scaled 0% to 100%) */}
              {sparklineData.length > 1 && (
                <polyline
                  fill="none"
                  stroke="#0891B2"
                  strokeWidth="2"
                  strokeDasharray="2 1"
                  points={sparklineData
                    .map((d, index) => {
                      const x = (index / (sparklineData.length - 1)) * 500;
                      const y = 150 - (d.humidity / 100) * 150;
                      return `${x},${Math.max(5, Math.min(145, y))}`;
                    })
                    .join(' ')}
                />
              )}
            </svg>
          </div>
          <div className="flex justify-between text-[11px] text-slate-400 font-mono mt-2 pt-2 border-t border-slate-100">
            <span>24 hours ago</span>
            <span>Latest: {latestReading.temperature}°C · {latestReading.humidity}% RH</span>
          </div>
        </div>
      </div>
    </div>
  );
};
