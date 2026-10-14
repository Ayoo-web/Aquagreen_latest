import React, { useState } from 'react';
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Clock,
  CloudRain,
  Droplets,
  Layers,
  Power,
  RotateCcw,
  Shield,
  ShieldAlert,
  Sliders,
  XCircle
} from 'lucide-react';
import { DecisionResult } from '../services/irrigationEngine';
import {
  AutomationSettings,
  CalibrationSettings,
  SensorReading
} from '../types';

interface AutomationTabProps {
  automation: AutomationSettings;
  onUpdateAutomation: (updated: AutomationSettings) => void;
  calibration: CalibrationSettings;
  latestReading: SensorReading | null;
  decisionState: DecisionResult;
  onTogglePumpManual: () => void;
  onEmergencyStop: () => void;
  activePumpDurationSeconds: number;
}

export const AutomationTab: React.FC<AutomationTabProps> = ({
  automation,
  onUpdateAutomation,
  calibration,
  latestReading,
  decisionState,
  onTogglePumpManual,
  onEmergencyStop,
  activePumpDurationSeconds
}) => {
  const [manualDurationMinutes, setManualDurationMinutes] = useState<number>(5);

  const isPumpRunning = latestReading?.pumpState ?? false;

  const handleModeToggle = (mode: 'AUTO' | 'MANUAL') => {
    onUpdateAutomation({ ...automation, mode });
  };

  const handleEnableToggle = () => {
    onUpdateAutomation({ ...automation, enabled: !automation.enabled });
  };

  const handleRainInhibitToggle = () => {
    onUpdateAutomation({ ...automation, rainInhibitionEnabled: !automation.rainInhibitionEnabled });
  };

  return (
    <div className="space-y-6">
      {/* 1. Header & Primary Control Bar */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="text-base font-bold text-slate-900">
              Irrigation Automation & Safety Controllers
            </h2>
            <p className="text-xs text-slate-500 mt-1">
              Autonomous dual-threshold hysteresis with non-blocking fail-safe interlocks.
            </p>
          </div>

          <div className="flex items-center gap-3">
            {/* Mode Selector */}
            <div className="flex items-center bg-slate-100 p-1 rounded-lg">
              <button
                onClick={() => handleModeToggle('AUTO')}
                className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors ${
                  automation.mode === 'AUTO'
                    ? 'bg-emerald-800 text-white shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                AUTOMATIC
              </button>
              <button
                onClick={() => handleModeToggle('MANUAL')}
                className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors ${
                  automation.mode === 'MANUAL'
                    ? 'bg-blue-700 text-white shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                MANUAL
              </button>
            </div>

            {/* Master Arming Switch */}
            <button
              onClick={handleEnableToggle}
              className={`px-3.5 py-1.5 text-xs font-semibold rounded-lg border transition-colors ${
                automation.enabled
                  ? 'bg-emerald-50 border-emerald-300 text-emerald-800'
                  : 'bg-slate-100 border-slate-300 text-slate-600'
              }`}
            >
              {automation.enabled ? 'SYSTEM ARMED' : 'SYSTEM DISARMED'}
            </button>
          </div>
        </div>

        {/* Emergency Stop Strip */}
        <div className={`mt-4 p-4 rounded-xl flex items-center justify-between gap-4 border ${
          automation.emergencyStop
            ? 'bg-rose-100 border-rose-300 text-rose-900'
            : 'bg-slate-50 border-slate-200 text-slate-700'
        }`}>
          <div className="flex items-center gap-3">
            <ShieldAlert className={`w-5 h-5 shrink-0 ${automation.emergencyStop ? 'text-rose-700 animate-pulse' : 'text-slate-400'}`} />
            <div>
              <div className="text-xs font-bold uppercase tracking-wide">
                {automation.emergencyStop ? 'Emergency Stop Engaged' : 'Hardware Safety Interlock Standby'}
              </div>
              <div className="text-[11px] text-slate-600 mt-0.5">
                {automation.emergencyStop
                  ? 'All pump control signals are suppressed. Relay is forced to de-energized safe state (GPIO17 HIGH).'
                  : 'Physical watchdog active. Manual and automatic controls operate within configured boundaries.'}
              </div>
            </div>
          </div>
          <button
            onClick={onEmergencyStop}
            className={`px-4 py-2 text-xs font-bold rounded-lg transition-colors shrink-0 ${
              automation.emergencyStop
                ? 'bg-rose-700 hover:bg-rose-800 text-white'
                : 'bg-rose-50 text-rose-700 border border-rose-200 hover:bg-rose-100'
            }`}
          >
            {automation.emergencyStop ? 'RESET E-STOP' : 'ENGAGE E-STOP'}
          </button>
        </div>
      </div>

      {/* 2. Live Decision Tree & Relay Status */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Relay & Command State */}
        <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs space-y-4">
          <h3 className="text-sm font-bold text-slate-900 border-b border-slate-100 pb-2 flex items-center justify-between">
            <span>Physical Relay Control</span>
            <Power className="w-4 h-4 text-slate-500" />
          </h3>

          <div className="p-4 bg-slate-50 rounded-xl text-center space-y-2">
            <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Reported Hardware State</div>
            <div className={`text-3xl font-bold font-mono ${isPumpRunning ? 'text-blue-600' : 'text-slate-700'}`}>
              {isPumpRunning ? 'PUMP ENERGIZED' : 'PUMP OFF'}
            </div>
            <div className="text-[11px] font-mono text-slate-500">
              ESP32 Pin: GPIO17 · Logic: Active-LOW ({isPumpRunning ? 'LOW / 0V' : 'HIGH / 3.3V'})
            </div>
            {isPumpRunning && (
              <div className="text-xs font-mono font-semibold text-blue-700 bg-blue-100/60 py-1 px-2 rounded">
                Active Duration: {Math.floor(activePumpDurationSeconds / 60)}m {activePumpDurationSeconds % 60}s
              </div>
            )}
          </div>

          {/* Manual Control Trigger */}
          <div className="space-y-2 pt-2">
            <div className="flex items-center justify-between text-xs text-slate-600">
              <span>Manual Run Duration:</span>
              <span className="font-mono font-bold text-slate-900">{manualDurationMinutes} min</span>
            </div>
            <input
              type="range"
              min="1"
              max={automation.maxRuntimeMinutes}
              value={manualDurationMinutes}
              onChange={e => setManualDurationMinutes(parseInt(e.target.value) || 5)}
              className="w-full accent-blue-600"
              disabled={isPumpRunning}
            />
            <button
              onClick={onTogglePumpManual}
              disabled={automation.emergencyStop}
              className={`w-full py-2.5 px-4 text-xs font-bold rounded-lg transition-colors ${
                isPumpRunning
                  ? 'bg-rose-600 hover:bg-rose-700 text-white'
                  : 'bg-emerald-700 hover:bg-emerald-800 text-white disabled:opacity-50'
              }`}
            >
              {isPumpRunning ? 'STOP PUMP IMMEDIATELY' : `START PUMP (${manualDurationMinutes}m Manual Override)`}
            </button>
          </div>

          <div className="text-[11px] text-slate-400 leading-tight">
            Safety note: Manual activation is guarded by the {automation.maxRuntimeMinutes}-minute maximum runtime cap and emergency stop.
          </div>
        </div>

        {/* Live Decision Tree Visualizer */}
        <div className="lg:col-span-2 bg-white border border-slate-200 rounded-xl p-5 shadow-xs space-y-4">
          <h3 className="text-sm font-bold text-slate-900 border-b border-slate-100 pb-2 flex items-center justify-between">
            <span>Decision Tree State Engine</span>
            <span className="text-xs font-normal text-slate-500 font-mono">Real-Time Evaluation</span>
          </h3>

          <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl flex items-center justify-between">
            <div>
              <div className="text-xs font-bold text-slate-900">{decisionState.stateLabel}</div>
              <div className="text-xs text-slate-600 mt-0.5">{decisionState.reason}</div>
            </div>
            <span className={`px-2.5 py-1 text-xs font-mono font-bold rounded ${
              decisionState.isPermitted ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'
            }`}>
              {decisionState.action}
            </span>
          </div>

          {/* 6 Sequential Verification Gates */}
          <div className="space-y-2 text-xs">
            {/* Gate 1 */}
            <div className="flex items-center gap-3 p-2 bg-slate-50 rounded-lg">
              {!automation.emergencyStop ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
              ) : (
                <XCircle className="w-4 h-4 text-rose-600 shrink-0" />
              )}
              <div className="flex-1">
                <span className="font-semibold text-slate-900">1. Emergency Stop Check:</span>
                <span className="text-slate-600 ml-1">
                  {!automation.emergencyStop ? 'Passed (Latch disengaged)' : 'Failed (E-Stop is Active)'}
                </span>
              </div>
            </div>

            {/* Gate 2 */}
            <div className="flex items-center gap-3 p-2 bg-slate-50 rounded-lg">
              {latestReading && latestReading.soilMoistureRaw < 4090 ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
              ) : (
                <XCircle className="w-4 h-4 text-rose-600 shrink-0" />
              )}
              <div className="flex-1">
                <span className="font-semibold text-slate-900">2. Soil Sensor Integrity:</span>
                <span className="text-slate-600 ml-1">
                  {latestReading && latestReading.soilMoistureRaw < 4090
                    ? `Passed (ADC ${latestReading.soilMoistureRaw})`
                    : 'Fault Detected (ADC 4095 Open-Circuit)'}
                </span>
              </div>
            </div>

            {/* Gate 3 */}
            <div className="flex items-center gap-3 p-2 bg-slate-50 rounded-lg">
              {latestReading?.rainDetected === false || !automation.rainInhibitionEnabled ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
              ) : (
                <XCircle className="w-4 h-4 text-amber-600 shrink-0" />
              )}
              <div className="flex-1">
                <span className="font-semibold text-slate-900">3. Rain Inhibition Check:</span>
                <span className="text-slate-600 ml-1">
                  {latestReading?.rainDetected == null
                    ? 'Unavailable (rain status unknown)'
                    : latestReading.rainDetected === false
                    ? 'Passed (Dry sensor surface)'
                    : automation.rainInhibitionEnabled
                    ? 'Blocked (Wet surface detected)'
                    : 'Bypassed (Inhibit policy disabled)'}
                </span>
              </div>
            </div>

            {/* Gate 4 */}
            <div className="flex items-center gap-3 p-2 bg-slate-50 rounded-lg">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
              <div className="flex-1">
                <span className="font-semibold text-slate-900">4. Moisture Hysteresis Evaluation:</span>
                <span className="text-slate-600 ml-1 font-mono">
                  Current: {latestReading?.soilMoisturePercent == null ? 'Unavailable' : `${latestReading.soilMoisturePercent}%`} · Trigger ON &le; {automation.dryThresholdPercent}% · Cutoff OFF &ge; {automation.targetWetPercent}%
                </span>
              </div>
            </div>

            {/* Gate 5 */}
            <div className="flex items-center gap-3 p-2 bg-slate-50 rounded-lg">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
              <div className="flex-1">
                <span className="font-semibold text-slate-900">5. Safety Caps & Limits:</span>
                <span className="text-slate-600 ml-1">
                  Max runtime: {automation.maxRuntimeMinutes}m · Spacing: {automation.minIntervalHours}h · Soak cooldown: {automation.cooldownMinutes}m
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* 3. Automation Threshold & Interlock Parameters */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs space-y-4">
        <h3 className="text-sm font-bold text-slate-900 border-b border-slate-100 pb-2">
          Threshold & Interlock Configurations
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {/* Dry Threshold Slider */}
          <div className="p-3 bg-slate-50 rounded-lg space-y-1">
            <div className="flex justify-between items-center text-xs">
              <span className="font-semibold text-slate-700">Dry Threshold (ON Trigger)</span>
              <span className="font-mono font-bold text-rose-600">{automation.dryThresholdPercent}%</span>
            </div>
            <input
              type="range"
              min="15"
              max="50"
              value={automation.dryThresholdPercent}
              onChange={e => onUpdateAutomation({ ...automation, dryThresholdPercent: parseInt(e.target.value) || 35 })}
              className="w-full accent-rose-600"
            />
            <div className="text-[10px] text-slate-400">
              Pump triggers ON when soil drops to or below this level.
            </div>
          </div>

          {/* Wet Target Slider */}
          <div className="p-3 bg-slate-50 rounded-lg space-y-1">
            <div className="flex justify-between items-center text-xs">
              <span className="font-semibold text-slate-700">Target Wet (OFF Cutoff)</span>
              <span className="font-mono font-bold text-emerald-700">{automation.targetWetPercent}%</span>
            </div>
            <input
              type="range"
              min="55"
              max="85"
              value={automation.targetWetPercent}
              onChange={e => onUpdateAutomation({ ...automation, targetWetPercent: parseInt(e.target.value) || 65 })}
              className="w-full accent-emerald-700"
            />
            <div className="text-[10px] text-slate-400">
              Pump shuts off once moisture recovers to this level.
            </div>
          </div>

          {/* Max Runtime */}
          <div className="p-3 bg-slate-50 rounded-lg space-y-1">
            <div className="flex justify-between items-center text-xs">
              <span className="font-semibold text-slate-700">Max Pump Runtime</span>
              <span className="font-mono font-bold text-slate-900">{automation.maxRuntimeMinutes} min</span>
            </div>
            <input
              type="range"
              min="3"
              max="30"
              value={automation.maxRuntimeMinutes}
              onChange={e => onUpdateAutomation({ ...automation, maxRuntimeMinutes: parseInt(e.target.value) || 15 })}
              className="w-full accent-slate-700"
            />
            <div className="text-[10px] text-slate-400">
              Hard electrical & water logging safety limit per cycle.
            </div>
          </div>

          {/* Infiltration Cooldown */}
          <div className="p-3 bg-slate-50 rounded-lg space-y-1">
            <div className="flex justify-between items-center text-xs">
              <span className="font-semibold text-slate-700">Infiltration Cooldown</span>
              <span className="font-mono font-bold text-slate-900">{automation.cooldownMinutes} min</span>
            </div>
            <input
              type="range"
              min="10"
              max="120"
              step="5"
              value={automation.cooldownMinutes}
              onChange={e => onUpdateAutomation({ ...automation, cooldownMinutes: parseInt(e.target.value) || 30 })}
              className="w-full accent-slate-700"
            />
            <div className="text-[10px] text-slate-400">
              Percolation soak period before any subsequent re-trigger.
            </div>
          </div>
        </div>

        {/* Rain Policy & Daily Limit */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
          <div className="flex items-center justify-between p-3 bg-slate-50 rounded-lg">
            <div>
              <div className="text-xs font-semibold text-slate-900">Rain Inhibition Interlock</div>
              <div className="text-[11px] text-slate-500">Block or stop pump immediately if rain sensor is wet</div>
            </div>
            <button
              onClick={handleRainInhibitToggle}
              className={`px-3 py-1 text-xs font-bold rounded ${
                automation.rainInhibitionEnabled
                  ? 'bg-blue-600 text-white'
                  : 'bg-slate-200 text-slate-700'
              }`}
            >
              {automation.rainInhibitionEnabled ? 'ENABLED' : 'DISABLED'}
            </button>
          </div>

          <div className="flex items-center justify-between p-3 bg-slate-50 rounded-lg">
            <div>
              <div className="text-xs font-semibold text-slate-900">Daily Volume Cap</div>
              <div className="text-[11px] text-slate-500">Maximum allowable water volume in 24h</div>
            </div>
            <div className="flex items-center gap-1">
              <input
                type="number"
                min="20"
                max="500"
                value={automation.dailyMaxVolumeLiters}
                onChange={e => onUpdateAutomation({ ...automation, dailyMaxVolumeLiters: parseInt(e.target.value) || 150 })}
                className="w-20 px-2 py-1 text-xs font-mono bg-white border border-slate-300 rounded text-right font-bold"
              />
              <span className="text-xs text-slate-500">Liters</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
