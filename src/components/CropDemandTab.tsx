import React from 'react';
import { AlertCircle, Clock, Droplets, Layers, Maximize2, Percent } from 'lucide-react';
import { CalibrationSettings, CropSettings, FAO56Calculation } from '../types';

interface CropDemandTabProps {
  crop: CropSettings;
  onUpdateCrop: (updated: CropSettings) => void;
  calculation: FAO56Calculation | null;
  calibration: CalibrationSettings;
}

export const CropDemandTab: React.FC<CropDemandTabProps> = ({
  crop,
  onUpdateCrop,
  calculation,
  calibration
}) => {
  const et0 = calculation?.et0 ?? 3.5;

  // Active Kc based on stage
  let currentKc = crop.kcMid;
  if (crop.stage === 'initial') currentKc = crop.kcInitial;
  if (crop.stage === 'end') currentKc = crop.kcEnd;

  // ETc in mm/day
  const etc = Number((et0 * currentKc).toFixed(2));

  // Net Volume: 1 mm over 1 m² = 1 Liter
  const netVolumeLiters = Number((etc * crop.irrigatedAreaSqM).toFixed(1));

  // Gross Volume: Net / Efficiency
  const efficiency = Math.max(0.3, Math.min(1.0, crop.irrigationEfficiency || 0.85));
  const grossVolumeLiters = Number((netVolumeLiters / efficiency).toFixed(1));

  // Pump Runtime = Gross / FlowRate
  const flowRate = Math.max(0.5, calibration.pumpFlowRate || 12.0);
  const runtimeMinutes = Number((grossVolumeLiters / flowRate).toFixed(1));

  const handleStageChange = (stage: 'initial' | 'mid' | 'end') => {
    onUpdateCrop({ ...crop, stage });
  };

  return (
    <div className="space-y-6">
      {/* 1. Header & Summary Grid */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="text-base font-bold text-slate-900">Crop Water Demand (ETc) & Runtime Engine</h2>
            <p className="text-xs text-slate-500 mt-1">
              Transforms physical ET₀ into volumetric field irrigation requirements and pump runtimes.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-500">Growth Stage:</span>
            <div className="flex items-center bg-slate-100 p-0.5 rounded-lg">
              {(['initial', 'mid', 'end'] as const).map(s => (
                <button
                  key={s}
                  onClick={() => handleStageChange(s)}
                  className={`px-3 py-1 text-xs font-semibold rounded-md capitalize transition-colors ${
                    crop.stage === s
                      ? 'bg-white text-emerald-800 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* 3 Metric Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-5">
          <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4">
            <div className="text-[11px] font-bold text-emerald-700 uppercase tracking-wide flex items-center justify-between">
              <span>Crop ETc</span>
              <Droplets className="w-4 h-4" />
            </div>
            <div className="text-3xl font-bold font-mono text-emerald-950 mt-2 tabular-nums">
              {etc} <span className="text-xs font-normal text-emerald-700">mm/day</span>
            </div>
            <div className="text-xs text-emerald-800 mt-2 font-mono">
              ETc = {currentKc} (Kc) × {et0} (ET₀)
            </div>
          </div>

          <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
            <div className="text-[11px] font-bold text-blue-700 uppercase tracking-wide flex items-center justify-between">
              <span>Gross Irrigation Demand</span>
              <Maximize2 className="w-4 h-4" />
            </div>
            <div className="text-3xl font-bold font-mono text-blue-950 mt-2 tabular-nums">
              {grossVolumeLiters} <span className="text-xs font-normal text-blue-700">Liters/day</span>
            </div>
            <div className="text-xs text-blue-800 mt-2 font-mono">
              Net {netVolumeLiters} L / {(efficiency * 100).toFixed(0)}% eff.
            </div>
          </div>

          <div className="bg-indigo-50 border border-indigo-200 rounded-xl p-4">
            <div className="text-[11px] font-bold text-indigo-700 uppercase tracking-wide flex items-center justify-between">
              <span>Estimated Pump Runtime</span>
              <Clock className="w-4 h-4" />
            </div>
            <div className="text-3xl font-bold font-mono text-indigo-950 mt-2 tabular-nums">
              {runtimeMinutes} <span className="text-xs font-normal text-indigo-700">minutes</span>
            </div>
            <div className="text-xs text-indigo-800 mt-2 font-mono">
              Flow Rate: {flowRate} L/min
            </div>
          </div>
        </div>
      </div>

      {/* 2. Crop & Field Parameter Configuration Form */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs space-y-4">
          <h3 className="text-sm font-bold text-slate-900 border-b border-slate-100 pb-2">
            Research Crop Profile & Coefficients
          </h3>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Crop Name / Cultivar
            </label>
            <input
              type="text"
              value={crop.cropName}
              onChange={e => onUpdateCrop({ ...crop, cropName: e.target.value })}
              className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-300 rounded-md focus:bg-white focus:outline-none focus:ring-1 focus:ring-emerald-600"
            />
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-[11px] text-slate-600 mb-1">
                Kc Initial (Germination)
              </label>
              <input
                type="number"
                step="0.05"
                min="0.1"
                max="1.5"
                value={crop.kcInitial}
                onChange={e => onUpdateCrop({ ...crop, kcInitial: parseFloat(e.target.value) || 0.5 })}
                className="w-full px-2.5 py-1.5 text-xs font-mono bg-slate-50 border border-slate-300 rounded-md"
              />
            </div>
            <div>
              <label className="block text-[11px] text-slate-600 mb-1">
                Kc Mid (Peak Canopy)
              </label>
              <input
                type="number"
                step="0.05"
                min="0.1"
                max="1.5"
                value={crop.kcMid}
                onChange={e => onUpdateCrop({ ...crop, kcMid: parseFloat(e.target.value) || 1.05 })}
                className="w-full px-2.5 py-1.5 text-xs font-mono bg-slate-50 border border-slate-300 rounded-md font-semibold text-emerald-800"
              />
            </div>
            <div>
              <label className="block text-[11px] text-slate-600 mb-1">
                Kc End (Maturity)
              </label>
              <input
                type="number"
                step="0.05"
                min="0.1"
                max="1.5"
                value={crop.kcEnd}
                onChange={e => onUpdateCrop({ ...crop, kcEnd: parseFloat(e.target.value) || 0.65 })}
                className="w-full px-2.5 py-1.5 text-xs font-mono bg-slate-50 border border-slate-300 rounded-md"
              />
            </div>
          </div>

          <div className="pt-2 text-xs text-slate-500">
            Current Stage Kc active in model: <span className="font-mono font-bold text-slate-900">{currentKc}</span>
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs space-y-4">
          <h3 className="text-sm font-bold text-slate-900 border-b border-slate-100 pb-2">
            Field Plot Geometry & Irrigation Efficiency
          </h3>

          <div>
            <div className="flex justify-between items-center mb-1">
              <label className="text-xs font-semibold text-slate-700">
                Plot Irrigated Surface Area (m²)
              </label>
              <span className="text-xs font-mono font-bold text-slate-900">{crop.irrigatedAreaSqM} m²</span>
            </div>
            <input
              type="number"
              min="1"
              max="10000"
              step="1"
              value={crop.irrigatedAreaSqM}
              onChange={e => onUpdateCrop({ ...crop, irrigatedAreaSqM: parseFloat(e.target.value) || 20 })}
              className="w-full px-3 py-2 text-xs font-mono bg-slate-50 border border-slate-300 rounded-md"
            />
            <div className="text-[11px] text-slate-400 mt-1">
              Conversion principle: 1.0 mm depth across 1.0 m² area = 1.0 Liter of pure water.
            </div>
          </div>

          <div>
            <div className="flex justify-between items-center mb-1">
              <label className="text-xs font-semibold text-slate-700">
                Irrigation System Application Efficiency (η)
              </label>
              <span className="text-xs font-mono font-bold text-slate-900">
                {(crop.irrigationEfficiency * 100).toFixed(0)}%
              </span>
            </div>
            <input
              type="range"
              min="0.5"
              max="0.95"
              step="0.05"
              value={crop.irrigationEfficiency}
              onChange={e => onUpdateCrop({ ...crop, irrigationEfficiency: parseFloat(e.target.value) || 0.85 })}
              className="w-full accent-emerald-700"
            />
            <div className="flex justify-between text-[10px] text-slate-400 font-mono mt-1">
              <span>Furrow (60%)</span>
              <span>Sprinkler (75%)</span>
              <span>Drip System (85-90%)</span>
            </div>
          </div>

          <div className="p-3 bg-slate-50 rounded-lg text-xs space-y-1 text-slate-600">
            <div className="flex justify-between">
              <span>Calibrated Pump Flow Rate:</span>
              <span className="font-mono font-semibold text-slate-900">{flowRate} L/min</span>
            </div>
            <div className="flex justify-between">
              <span>Net Crop Demand:</span>
              <span className="font-mono text-slate-800">{netVolumeLiters} Liters</span>
            </div>
            <div className="flex justify-between border-t border-slate-200 pt-1 font-semibold text-slate-900">
              <span>Gross Field Delivery:</span>
              <span className="font-mono text-emerald-800">{grossVolumeLiters} Liters</span>
            </div>
          </div>
        </div>
      </div>

      {/* 3. Rain Sensor Non-Quantification Transparency Notice */}
      <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-xs text-amber-900 flex items-start gap-3">
        <AlertCircle className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
        <div className="space-y-1">
          <div className="font-bold">Agricultural Engineering Research Note: Rain Sensor Qualification</div>
          <p className="leading-relaxed">
            The installed rain sensor utilizes an analog conductive tracking surface that detects the presence of surface wetness or active precipitation, but does not quantify rainfall depth in millimetres. Therefore, AquaGreen does not fabricate or subtract hypothetical rain depths from the daily ETc equation; instead, active rain detection triggers the nonblocking <strong>Rain Inhibition Policy</strong> to pause automated irrigation events.
          </p>
        </div>
      </div>
    </div>
  );
};
