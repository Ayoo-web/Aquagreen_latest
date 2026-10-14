import React, { useState, useEffect } from 'react';
import {
  AlertTriangle,
  CheckCircle,
  CloudRain,
  Cpu,
  Droplets,
  Gauge,
  Play,
  RotateCcw,
  Square,
  Sun,
  Thermometer,
  Wind,
  X
} from 'lucide-react';
import { CalibrationSettings, SensorReading } from '../types';
import { rawAdcToMoisturePercent } from '../services/irrigationEngine';

interface SimulatorDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  onInjectReading: (reading: SensorReading) => void;
  latestReading: SensorReading | null;
  calibration: CalibrationSettings;
  pumpRunning: boolean;
}

export const SimulatorDrawer: React.FC<SimulatorDrawerProps> = ({
  isOpen,
  onClose,
  onInjectReading,
  latestReading,
  calibration,
  pumpRunning
}) => {
  const [temp, setTemp] = useState<number>(latestReading?.temperature ?? 28.5);
  const [humidity, setHumidity] = useState<number>(latestReading?.humidity ?? 68);
  const [rawAdc, setRawAdc] = useState<number>(latestReading?.soilMoistureRaw ?? 2450);
  const [pressure, setPressure] = useState<number>(latestReading?.pressure ?? 1010.5);
  const [wind, setWind] = useState<number>(latestReading?.windSpeed ?? 1.8);
  const [lux, setLux] = useState<number>(latestReading?.lux ?? 35000);
  const [rain, setRain] = useState<boolean>(latestReading?.rainDetected ?? false);
  const [supplyTankPercent, setSupplyTankPercent] = useState<number>(latestReading?.supplyTankPercent ?? 68);
  const [collectionTankPercent, setCollectionTankPercent] = useState<number>(latestReading?.collectionTankPercent ?? 42);
  const [isAutoStreaming, setIsAutoStreaming] = useState<boolean>(false);

  // Calibrate moisture from current rawAdc
  const { percent: calculatedMoisture, isFault: isAdcFault } = rawAdcToMoisturePercent(rawAdc, calibration);

  // Periodic automatic streaming loop
  useEffect(() => {
    if (!isAutoStreaming) return;

    const interval = setInterval(() => {
      // If pump is running, simulate infiltration increase
      let nextAdc = rawAdc;
      if (pumpRunning) {
        // Move towards wet ADC
        nextAdc = Math.max(calibration.soilWetAdc + 50, rawAdc - 25);
        setRawAdc(nextAdc);
      } else {
        // Natural gradual drying towards dry ADC
        nextAdc = Math.min(calibration.soilDryAdc - 50, rawAdc + 5);
        setRawAdc(nextAdc);
      }

      const { percent } = rawAdcToMoisturePercent(nextAdc, calibration);

      const injected: SensorReading = {
        timestamp: new Date().toISOString(),
        temperature: Number((temp + (Math.random() * 0.4 - 0.2)).toFixed(1)),
        humidity: Number(Math.max(20, Math.min(95, humidity + (Math.random() * 1.0 - 0.5))).toFixed(1)),
        soilMoistureRaw: nextAdc,
        soilMoisturePercent: percent,
        pressure: Number((pressure + (Math.random() * 0.2 - 0.1)).toFixed(1)),
        windSpeed: Number(Math.max(0.2, wind + (Math.random() * 0.4 - 0.2)).toFixed(2)),
        lux: Math.max(0, Math.round(lux + (Math.random() * 200 - 100))),
        rainDetected: rain,
        pumpState: pumpRunning,
        supplyTankDistanceCm: null,
        supplyTankPercent,
        supplyTankSensorOk: true,
        collectionTankDistanceCm: null,
        collectionTankPercent,
        collectionTankSensorOk: true,
        isSimulated: true
      };

      onInjectReading(injected);
    }, 3000);

    return () => clearInterval(interval);
  }, [isAutoStreaming, temp, humidity, rawAdc, pressure, wind, lux, rain, supplyTankPercent, collectionTankPercent, pumpRunning, calibration]);

  if (!isOpen) return null;

  const handleManualInject = () => {
    const injected: SensorReading = {
      timestamp: new Date().toISOString(),
      temperature: temp,
      humidity,
      soilMoistureRaw: rawAdc,
      soilMoisturePercent: calculatedMoisture,
      pressure,
      windSpeed: wind,
      lux,
      rainDetected: rain,
      pumpState: pumpRunning,
      supplyTankDistanceCm: null,
      supplyTankPercent,
      supplyTankSensorOk: true,
      collectionTankDistanceCm: null,
      collectionTankPercent,
      collectionTankSensorOk: true,
      isSimulated: true
    };
    onInjectReading(injected);
  };

  const handleSimulateOpenCircuit = () => {
    setRawAdc(4095);
  };

  const handleSimulateDryStress = () => {
    // ADC set to dry threshold equivalent
    const dryTargetAdc = Math.round(calibration.soilDryAdc - 0.30 * (calibration.soilDryAdc - calibration.soilWetAdc));
    setRawAdc(dryTargetAdc);
  };

  const handleSimulateSaturated = () => {
    const wetTargetAdc = Math.round(calibration.soilDryAdc - 0.75 * (calibration.soilDryAdc - calibration.soilWetAdc));
    setRawAdc(wetTargetAdc);
  };

  return (
    <div className="fixed inset-y-0 right-0 z-50 w-full max-w-md bg-white shadow-2xl border-l border-slate-200 flex flex-col">
      {/* Drawer Header */}
      <div className="p-4 border-b border-slate-200 flex items-center justify-between bg-slate-50">
        <div className="flex items-center gap-2">
          <Cpu className="w-5 h-5 text-emerald-700" />
          <div>
            <h3 className="text-sm font-bold text-slate-900">ESP32 Hardware Testbed</h3>
            <p className="text-[11px] text-slate-500">Live sensor synthesis & relay loop emulator</p>
          </div>
        </div>
        <button
          onClick={onClose}
          className="p-1 rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-200"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Controls Form Area */}
      <div className="flex-1 overflow-y-auto p-5 space-y-5">
        {/* Stream Toggle Bar */}
        <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl flex items-center justify-between">
          <div>
            <div className="text-xs font-bold text-emerald-900">Continuous Telemetry Loop</div>
            <div className="text-[11px] text-emerald-700">Simulates ESP32 HTTP POST every 3s</div>
          </div>
          <button
            onClick={() => setIsAutoStreaming(!isAutoStreaming)}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-lg transition-colors ${
              isAutoStreaming
                ? 'bg-rose-600 hover:bg-rose-700 text-white'
                : 'bg-emerald-700 hover:bg-emerald-800 text-white'
            }`}
          >
            {isAutoStreaming ? <Square className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
            <span>{isAutoStreaming ? 'Halt Loop' : 'Start Loop'}</span>
          </button>
        </div>

        {/* Quick Scenario Preset Chips */}
        <div className="space-y-1.5">
          <div className="text-xs font-semibold text-slate-700">Quick Test Scenarios</div>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={handleSimulateDryStress}
              className="px-2.5 py-1 text-[11px] font-medium bg-rose-50 text-rose-700 border border-rose-200 rounded hover:bg-rose-100"
            >
              Trigger Dry Stress (30%)
            </button>
            <button
              onClick={handleSimulateSaturated}
              className="px-2.5 py-1 text-[11px] font-medium bg-blue-50 text-blue-700 border border-blue-200 rounded hover:bg-blue-100"
            >
              Saturated Soil (75%)
            </button>
            <button
              onClick={handleSimulateOpenCircuit}
              className="px-2.5 py-1 text-[11px] font-medium bg-amber-50 text-amber-800 border border-amber-200 rounded hover:bg-amber-100"
            >
              Fault: ADC 4095 Open
            </button>
          </div>
        </div>

        {/* Water Tank Level Simulator — simulator-only values */}
        <div className="p-3 bg-cyan-50 border border-cyan-200 rounded-xl space-y-4">
          <div>
            <div className="text-xs font-bold text-cyan-950">Water Tank Levels (Simulator Only)</div>
            <div className="text-[10px] text-cyan-800 mt-1">These test values are marked simulated and must not be treated as physical research measurements.</div>
          </div>
          <div className="space-y-2">
            <div className="flex justify-between text-xs"><span className="font-semibold text-slate-700">Supply tank</span><span className={`font-mono font-bold ${supplyTankPercent <= 20 ? 'text-rose-700' : 'text-slate-900'}`}>{supplyTankPercent}%</span></div>
            <input type="range" min="0" max="100" value={supplyTankPercent} onChange={e => setSupplyTankPercent(parseInt(e.target.value) || 0)} className="w-full accent-cyan-700" />
            <div className="text-[10px] text-slate-500">Use ≤20% to test low-supply warnings.</div>
          </div>
          <div className="space-y-2">
            <div className="flex justify-between text-xs"><span className="font-semibold text-slate-700">Collection tank</span><span className={`font-mono font-bold ${collectionTankPercent >= 90 ? 'text-amber-700' : 'text-slate-900'}`}>{collectionTankPercent}%</span></div>
            <input type="range" min="0" max="100" value={collectionTankPercent} onChange={e => setCollectionTankPercent(parseInt(e.target.value) || 0)} className="w-full accent-cyan-700" />
            <div className="text-[10px] text-slate-500">Use ≥90% to test near-full warnings.</div>
          </div>
        </div>

        {/* 1. Soil Sensor ADC */}
        <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl space-y-2">
          <div className="flex justify-between items-center text-xs">
            <span className="font-semibold text-slate-700 flex items-center gap-1">
              <Droplets className="w-3.5 h-3.5 text-blue-600" />
              Soil ADC (0-4095)
            </span>
            <span className="font-mono font-bold text-slate-900">
              ADC {rawAdc} ({calculatedMoisture}%)
            </span>
          </div>
          <input
            type="range"
            min="1000"
            max="4095"
            value={rawAdc}
            onChange={e => setRawAdc(parseInt(e.target.value) || 2400)}
            className="w-full accent-blue-600"
          />
          {isAdcFault && (
            <div className="text-[11px] text-rose-600 font-semibold flex items-center gap-1">
              <AlertTriangle className="w-3.5 h-3.5" />
              Open-circuit fault state active!
            </div>
          )}
        </div>

        {/* 2. Temperature */}
        <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl space-y-2">
          <div className="flex justify-between items-center text-xs">
            <span className="font-semibold text-slate-700 flex items-center gap-1">
              <Thermometer className="w-3.5 h-3.5 text-amber-600" />
              Air Temperature (°C)
            </span>
            <span className="font-mono font-bold text-slate-900">{temp}°C</span>
          </div>
          <input
            type="range"
            min="10"
            max="45"
            step="0.5"
            value={temp}
            onChange={e => setTemp(parseFloat(e.target.value) || 25)}
            className="w-full accent-amber-600"
          />
        </div>

        {/* 3. Relative Humidity */}
        <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl space-y-2">
          <div className="flex justify-between items-center text-xs">
            <span className="font-semibold text-slate-700">Relative Humidity (%)</span>
            <span className="font-mono font-bold text-slate-900">{humidity}%</span>
          </div>
          <input
            type="range"
            min="20"
            max="95"
            value={humidity}
            onChange={e => setHumidity(parseInt(e.target.value) || 70)}
            className="w-full accent-cyan-600"
          />
        </div>

        {/* 4. Wind Speed */}
        <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl space-y-2">
          <div className="flex justify-between items-center text-xs">
            <span className="font-semibold text-slate-700 flex items-center gap-1">
              <Wind className="w-3.5 h-3.5 text-teal-600" />
              Wind Speed (m/s)
            </span>
            <span className="font-mono font-bold text-slate-900">{wind} m/s</span>
          </div>
          <input
            type="range"
            min="0"
            max="12"
            step="0.1"
            value={wind}
            onChange={e => setWind(parseFloat(e.target.value) || 1.5)}
            className="w-full accent-teal-600"
          />
        </div>

        {/* 5. Rain Sensor Toggle */}
        <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CloudRain className="w-4 h-4 text-blue-600" />
            <div>
              <div className="text-xs font-semibold text-slate-900">Rain Surface Wetness</div>
              <div className="text-[10px] text-slate-500">Conductive rain detector (GPIO34)</div>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setRain(!rain)}
            className={`px-3 py-1 text-xs font-bold rounded ${
              rain ? 'bg-blue-600 text-white' : 'bg-slate-200 text-slate-700'
            }`}
          >
            {rain ? 'DETECTED' : 'DRY'}
          </button>
        </div>

        {/* 6. Lux */}
        <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl space-y-2">
          <div className="flex justify-between items-center text-xs">
            <span className="font-semibold text-slate-700 flex items-center gap-1">
              <Sun className="w-3.5 h-3.5 text-amber-500" />
              Illuminance (Lux)
            </span>
            <span className="font-mono font-bold text-slate-900">{lux.toLocaleString()} lux</span>
          </div>
          <input
            type="range"
            min="0"
            max="65000"
            step="1000"
            value={lux}
            onChange={e => setLux(parseInt(e.target.value) || 30000)}
            className="w-full accent-amber-500"
          />
        </div>
      </div>

      {/* Drawer Footer Actions */}
      <div className="p-4 border-t border-slate-200 bg-slate-50 flex items-center justify-between gap-3">
        <button
          onClick={handleManualInject}
          className="flex-1 py-2 px-4 text-xs font-bold text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg transition-colors shadow-xs"
        >
          Inject Single Snapshot
        </button>
        <button
          onClick={onClose}
          className="py-2 px-4 text-xs font-semibold text-slate-600 hover:text-slate-900 hover:bg-slate-200 rounded-lg transition-colors"
        >
          Close
        </button>
      </div>
    </div>
  );
};
