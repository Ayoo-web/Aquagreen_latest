import React from 'react';
import { AlertCircle, Clock, Info, LineChart, Sparkles, TrendingDown, TrendingUp } from 'lucide-react';
import { AutomationSettings, FAO56Calculation, PredictionResult, SensorReading } from '../types';

interface PredictionTabProps {
  prediction: PredictionResult;
  readings: SensorReading[];
  automation: AutomationSettings;
  calculation: FAO56Calculation | null;
}

export const PredictionTab: React.FC<PredictionTabProps> = ({
  prediction,
  readings,
  automation,
  calculation
}) => {
  const recentReadings = readings.slice(-15).filter(
    (r): r is SensorReading & { soilMoisturePercent: number } => r.soilMoisturePercent != null && Number.isFinite(r.soilMoisturePercent)
  );

  return (
    <div className="space-y-6">
      {/* 1. Header & Prediction State Card */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <LineChart className="w-5 h-5 text-indigo-600" />
              <h2 className="text-base font-bold text-slate-900">
                Soil Moisture Depletion Trend & Advisory Forecasting
              </h2>
            </div>
            <p className="text-xs text-slate-500 mt-1">
              Linear regression trend analysis using actual high-resolution time-series records.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <span className="text-xs text-slate-500">Model Confidence:</span>
            <span className={`px-2.5 py-1 text-xs font-mono font-bold rounded ${
              prediction.confidence === 'HIGH'
                ? 'bg-emerald-100 text-emerald-800'
                : prediction.confidence === 'MODERATE'
                ? 'bg-blue-100 text-blue-800'
                : prediction.confidence === 'LOW'
                ? 'bg-amber-100 text-amber-800'
                : 'bg-slate-100 text-slate-600'
            }`}>
              {prediction.confidence}
            </span>
          </div>
        </div>

        {/* Advisory Warning Note */}
        <div className="mt-4 p-3 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-600 flex items-start gap-2">
          <Info className="w-4 h-4 text-slate-500 shrink-0 mt-0.5" />
          <div className="leading-relaxed">
            <span className="font-semibold text-slate-900">Advisory Forecast Notice:</span> Depletion projections are statistical trend estimates intended for operator situational awareness. The physical ESP32 controller always validates sensor ADC levels and safety interlocks locally before energizing the pump relay.
          </div>
        </div>
      </div>

      {/* 2. Key Forecast Metrics */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Metric 1: Current Moisture */}
        <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-xs">
          <div className="text-xs font-semibold text-slate-500 uppercase">Observed Moisture</div>
          <div className="text-3xl font-bold font-mono text-slate-900 mt-2 tabular-nums">
            {prediction.isAvailable ? `${prediction.currentMoisture}%` : 'Unavailable'}
          </div>
          <div className="text-[11px] text-slate-500 mt-2 font-mono">
            Dry Trigger: {automation.dryThresholdPercent}%
          </div>
        </div>

        {/* Metric 2: Drying Velocity */}
        <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-xs">
          <div className="text-xs font-semibold text-slate-500 uppercase flex items-center justify-between">
            <span>Drying Rate (dθ/dt)</span>
            {prediction.dryingVelocityPerHour < 0 ? (
              <TrendingDown className="w-4 h-4 text-amber-600" />
            ) : (
              <TrendingUp className="w-4 h-4 text-emerald-600" />
            )}
          </div>
          <div className={`text-3xl font-bold font-mono mt-2 tabular-nums ${
            prediction.dryingVelocityPerHour < 0 ? 'text-amber-800' : 'text-slate-900'
          }`}>
            {prediction.dryingVelocityPerHour > 0 ? `+${prediction.dryingVelocityPerHour}` : prediction.dryingVelocityPerHour}%
            <span className="text-xs font-normal text-slate-500">/hr</span>
          </div>
          <div className="text-[11px] text-slate-500 mt-2">
            {prediction.isAvailable ? prediction.reason : 'Baseline calculating'}
          </div>
        </div>

        {/* Metric 3: Projected +30 / +60 min */}
        <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-xs">
          <div className="text-xs font-semibold text-slate-500 uppercase">Projected Horizons</div>
          <div className="mt-2 space-y-1 font-mono text-xs">
            <div className="flex justify-between items-baseline">
              <span className="text-slate-500">+30 min Horizon:</span>
              <span className="text-base font-bold text-slate-900">{prediction.projectedMoisture30Min}%</span>
            </div>
            <div className="flex justify-between items-baseline">
              <span className="text-slate-500">+60 min Horizon:</span>
              <span className="text-base font-bold text-slate-900">{prediction.projectedMoisture60Min}%</span>
            </div>
          </div>
          <div className="text-[10px] text-slate-400 mt-2">
            Sample window: {prediction.samplePointsUsed} readings
          </div>
        </div>

        {/* Metric 4: Estimated Time Until Dry Breach */}
        <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-xs">
          <div className="text-xs font-semibold text-slate-500 uppercase flex items-center justify-between">
            <span>Time to Dry Trigger</span>
            <Clock className="w-4 h-4 text-indigo-600" />
          </div>
          <div className="text-3xl font-bold font-mono text-indigo-950 mt-2 tabular-nums">
            {prediction.hoursUntilDryThreshold !== null
              ? `${prediction.hoursUntilDryThreshold}h`
              : 'N/A'}
          </div>
          <div className="text-[11px] text-slate-500 mt-2">
            {prediction.hoursUntilDryThreshold !== null
              ? `Estimated until reaching ${automation.dryThresholdPercent}%`
              : 'Moisture steady or rising'}
          </div>
        </div>
      </div>

      {/* 3. Observed vs Projected Trajectory Visualization */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-sm font-semibold text-slate-900">
              Soil Moisture Trajectory (Observed History & Projected Extrapolation)
            </h3>
            <p className="text-xs text-slate-500">Solid line: Observed data · Dashed line: 60-minute statistical projection</p>
          </div>
          <div className="flex items-center gap-4 text-xs font-mono text-slate-500">
            <span className="flex items-center gap-1.5">
              <span className="w-2.5 h-0.5 bg-blue-600 inline-block" /> Observed
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-2.5 h-0.5 border-t border-dashed border-indigo-600 inline-block" /> Projected
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-2.5 h-0.5 border-t border-dashed border-rose-500 inline-block" /> Dry Threshold
            </span>
          </div>
        </div>

        <div className="h-56 w-full">
          <svg className="w-full h-full overflow-visible" viewBox="0 0 600 160">
            {/* Dry threshold line */}
            <line
              x1="0"
              y1={160 - (automation.dryThresholdPercent / 100) * 160}
              x2="600"
              y2={160 - (automation.dryThresholdPercent / 100) * 160}
              stroke="#F43F5E"
              strokeDasharray="4 4"
              strokeWidth="1.5"
            />

            {/* Observed historical points (left 450px) */}
            {recentReadings.length > 1 && (
              <polyline
                fill="none"
                stroke="#2563EB"
                strokeWidth="2.5"
                points={recentReadings
                  .map((d, index) => {
                    const x = (index / (recentReadings.length - 1)) * 450;
                    const y = 160 - (Math.min(100, Math.max(0, d.soilMoisturePercent)) / 100) * 160;
                    return `${x},${y}`;
                  })
                  .join(' ')}
              />
            )}

            {/* Current point junction */}
            <circle
              cx="450"
              cy={160 - (prediction.currentMoisture / 100) * 160}
              r="4.5"
              fill="#2563EB"
            />

            {/* Projected extrapolation line (450px to 600px) */}
            {prediction.isAvailable && (
              <polyline
                fill="none"
                stroke="#4F46E5"
                strokeWidth="2.5"
                strokeDasharray="4 4"
                points={`450,${160 - (prediction.currentMoisture / 100) * 160} 525,${160 - (prediction.projectedMoisture30Min / 100) * 160} 600,${160 - (prediction.projectedMoisture60Min / 100) * 160}`}
              />
            )}

            {/* Future point */}
            {prediction.isAvailable && (
              <circle
                cx="600"
                cy={160 - (prediction.projectedMoisture60Min / 100) * 160}
                r="4.5"
                fill="#4F46E5"
              />
            )}
          </svg>
        </div>

        <div className="flex justify-between text-[11px] text-slate-400 font-mono mt-2 pt-2 border-t border-slate-100">
          <span>Observed Baseline</span>
          <span>Now ({prediction.currentMoisture}%)</span>
          <span>+30 min ({prediction.projectedMoisture30Min}%)</span>
          <span>+60 min ({prediction.projectedMoisture60Min}%)</span>
        </div>
      </div>
    </div>
  );
};
