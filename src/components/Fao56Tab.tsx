import React from 'react';
import { AlertCircle, BookOpen, CheckCircle, Info } from 'lucide-react';
import { CalibrationSettings, CropSettings, FAO56Calculation } from '../types';

interface Fao56TabProps {
  calculation: FAO56Calculation | null;
  calibration: CalibrationSettings;
  crop: CropSettings;
}

export const Fao56Tab: React.FC<Fao56TabProps> = ({
  calculation,
  calibration,
  crop
}) => {
  if (!calculation) {
    return (
      <div className="p-8 text-center bg-white border border-slate-200 rounded-xl">
        <AlertCircle className="w-8 h-8 mx-auto text-amber-500 mb-2" />
        <h3 className="text-sm font-semibold text-slate-900">Calculation Engine Initializing</h3>
        <p className="text-xs text-slate-500 mt-1">FAO-56 Penman–Monteith requires valid measured wind data. The calculation will remain unavailable until at least one valid wind-speed sample is received; no substitute wind speed is inserted.</p>
      </div>
    );
  }

  const {
    tMean, tMin, tMax, rhMean, rhMin, rhMax,
    windSpeed2m, rawWindSpeed, windSensorHeight,
    pressureKPa, delta, gamma, es, ea, vpd,
    dayOfYear, ra, rso, rsEstimated, rns, rnl, rn, g,
    et0, kc, etc, dataCompletenessPercent, sampleCount,
    isDailyAverage, warnings, methodLimitations
  } = calculation;

  return (
    <div className="space-y-6">
      {/* 1. Header & Dataset Completeness Card */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <BookOpen className="w-5 h-5 text-emerald-700" />
              <h2 className="text-base font-bold text-slate-900">
                FAO-56 Penman–Monteith Reference Evapotranspiration
              </h2>
            </div>
            <p className="text-xs text-slate-500 mt-1">
              Standardized physical formulation (Allen et al., 1998, FAO Irrigation and Drainage Paper No. 56)
            </p>
          </div>

          <div className="flex items-center gap-6">
            <div className="text-right">
              <div className="text-xs font-semibold text-slate-900">
                Dataset Integrity: {dataCompletenessPercent}%
              </div>
              <div className="text-[11px] text-slate-500 font-mono">
                {sampleCount} validated samples · {isDailyAverage ? '24h Daily Average' : 'Single / Partial Record'}
              </div>
            </div>
            <div className="bg-emerald-50 border border-emerald-200 px-4 py-2 rounded-lg text-right">
              <div className="text-[10px] text-emerald-700 font-bold tracking-wider uppercase">Reference ET₀</div>
              <div className="text-2xl font-bold font-mono text-emerald-900 tabular-nums">
                {et0} <span className="text-xs font-normal">mm/day</span>
              </div>
            </div>
          </div>
        </div>

        {/* Completeness Warning if Partial */}
        {warnings.length > 0 && (
          <div className="mt-4 p-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-800 flex items-start gap-2">
            <AlertCircle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
            <div className="space-y-0.5">
              <div className="font-semibold">Dataset Note:</div>
              {warnings.map((w, i) => (
                <div key={i}>{w}</div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* 2. Master Mathematical Equation Presentation */}
      <div className="bg-slate-900 text-white rounded-xl p-5 shadow-xs">
        <div className="text-xs font-mono text-emerald-400 font-semibold tracking-wider uppercase mb-2">
          Master FAO-56 Penman-Monteith Formulation (Eq. 6)
        </div>
        <div className="bg-slate-950 p-4 rounded-lg font-mono text-xs sm:text-sm overflow-x-auto text-slate-200 leading-relaxed border border-slate-800">
          ET₀ = [ 0.408·Δ·(Rn − G) + γ·[900 / (T + 273)]·u₂·(es − ea) ] / [ Δ + γ·(1 + 0.34·u₂) ]
        </div>

        {/* Live Numerical Substitution */}
        <div className="mt-4 pt-4 border-t border-slate-800">
          <div className="text-xs font-mono text-slate-400 mb-1">Live Parameter Substitution:</div>
          <div className="bg-slate-950/60 p-3 rounded font-mono text-xs text-emerald-300 overflow-x-auto">
            ET₀ = [ 0.408·({delta})·({rn} − {g}) + ({gamma})·[900 / ({tMean} + 273)]·({windSpeed2m})·({es} − {ea}) ]
            <br />
            &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; / [ {delta} + ({gamma})·(1 + 0.34·{windSpeed2m}) ]
            <br />
            <span className="text-white font-bold">
              ET₀ = {et0} mm/day
            </span>
          </div>
        </div>
      </div>

      {/* 3. Step-by-Step Intermediate Terms Breakdown Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {/* Step 1: Temperature & Vapor Pressures */}
        <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
          <div className="flex items-center justify-between border-b border-slate-100 pb-2">
            <span className="text-xs font-bold text-slate-900 uppercase">1. Temperature & Vapor</span>
            <span className="text-[10px] font-mono text-slate-400">DHT22</span>
          </div>
          <div className="space-y-1.5 text-xs">
            <div className="flex justify-between">
              <span className="text-slate-500">T Mean (T):</span>
              <span className="font-mono font-semibold text-slate-900">{tMean} °C</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">T Min / Max:</span>
              <span className="font-mono text-slate-700">{tMin} / {tMax} °C</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">RH Mean:</span>
              <span className="font-mono text-slate-700">{rhMean}%</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">Saturation VP (es):</span>
              <span className="font-mono font-semibold text-slate-900">{es} kPa</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">Actual VP (ea):</span>
              <span className="font-mono font-semibold text-slate-900">{ea} kPa</span>
            </div>
            <div className="flex justify-between text-blue-700 pt-1 border-t border-slate-100">
              <span>VPD (es − ea):</span>
              <span className="font-mono font-bold">{vpd} kPa</span>
            </div>
          </div>
        </div>

        {/* Step 2: Atmospheric & Psychrometric */}
        <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
          <div className="flex items-center justify-between border-b border-slate-100 pb-2">
            <span className="text-xs font-bold text-slate-900 uppercase">2. Pressure & Psychrometric</span>
            <span className="text-[10px] font-mono text-slate-400">BMP280 / Site</span>
          </div>
          <div className="space-y-1.5 text-xs">
            <div className="flex justify-between">
              <span className="text-slate-500">Site Elevation (z):</span>
              <span className="font-mono text-slate-700">{calibration.elevation} m</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">Pressure (P):</span>
              <span className="font-mono font-semibold text-slate-900">{pressureKPa} kPa</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">Slope Curve (Δ):</span>
              <span className="font-mono font-semibold text-slate-900">{delta} kPa/°C</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">Psychrometric (γ):</span>
              <span className="font-mono font-semibold text-slate-900">{gamma} kPa/°C</span>
            </div>
            <div className="flex justify-between pt-1 border-t border-slate-100">
              <span className="text-slate-500">Δ / (Δ + γ):</span>
              <span className="font-mono font-bold text-slate-900">
                {(delta / (delta + gamma)).toFixed(3)}
              </span>
            </div>
          </div>
        </div>

        {/* Step 3: Wind Measurement & Height Correction */}
        <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
          <div className="flex items-center justify-between border-b border-slate-100 pb-2">
            <span className="text-xs font-bold text-slate-900 uppercase">3. Wind Speed Correction</span>
            <span className="text-[10px] font-mono text-slate-400">Anemometer</span>
          </div>
          <div className="space-y-1.5 text-xs">
            <div className="flex justify-between">
              <span className="text-slate-500">Measured Wind (uz):</span>
              <span className="font-mono text-slate-700">{rawWindSpeed} m/s</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">Sensor Height (zw):</span>
              <span className="font-mono text-slate-700">{windSensorHeight} m</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">Height Formula:</span>
              <span className="font-mono text-[11px] text-slate-500">4.87 / ln(67.8·z − 5.42)</span>
            </div>
            <div className="flex justify-between text-teal-700 pt-1 border-t border-slate-100">
              <span className="font-semibold">Corrected u₂ (2.0 m):</span>
              <span className="font-mono font-bold">{windSpeed2m} m/s</span>
            </div>
          </div>
        </div>

        {/* Step 4: Solar Radiation Estimation (Hargreaves Method) */}
        <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
          <div className="flex items-center justify-between border-b border-slate-100 pb-2">
            <span className="text-xs font-bold text-slate-900 uppercase">4. Solar Radiation (Rs)</span>
            <span className="text-[10px] font-mono text-amber-700 bg-amber-50 px-1 rounded">ESTIMATED</span>
          </div>
          <div className="space-y-1.5 text-xs">
            <div className="flex justify-between">
              <span className="text-slate-500">Day of Year (J):</span>
              <span className="font-mono text-slate-700">{dayOfYear}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">Extraterrestrial (Ra):</span>
              <span className="font-mono text-slate-700">{ra} MJ/m²/d</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">Clear-Sky (Rso):</span>
              <span className="font-mono text-slate-700">{rso} MJ/m²/d</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">Coeff kRs (interior):</span>
              <span className="font-mono text-slate-700">{calibration.kRs}</span>
            </div>
            <div className="flex justify-between text-amber-900 font-semibold pt-1 border-t border-slate-100">
              <span>Estimated Rs:</span>
              <span className="font-mono font-bold">{rsEstimated} MJ/m²/d</span>
            </div>
          </div>
        </div>

        {/* Step 5: Net Radiation & Soil Heat Flux */}
        <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
          <div className="flex items-center justify-between border-b border-slate-100 pb-2">
            <span className="text-xs font-bold text-slate-900 uppercase">5. Net Radiation Balance</span>
            <span className="text-[10px] font-mono text-slate-400">Energy</span>
          </div>
          <div className="space-y-1.5 text-xs">
            <div className="flex justify-between">
              <span className="text-slate-500">Albedo (α):</span>
              <span className="font-mono text-slate-700">0.23 (Grass)</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">Net Shortwave (Rns):</span>
              <span className="font-mono text-slate-700">{rns} MJ/m²/d</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">Net Longwave (Rnl):</span>
              <span className="font-mono text-slate-700">{rnl} MJ/m²/d</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">Soil Heat Flux (G):</span>
              <span className="font-mono text-slate-700">0.00 MJ/m²/d</span>
            </div>
            <div className="flex justify-between text-emerald-800 font-semibold pt-1 border-t border-slate-100">
              <span>Net Radiation (Rn):</span>
              <span className="font-mono font-bold">{rn} MJ/m²/d</span>
            </div>
          </div>
        </div>

        {/* Step 6: Crop ETc Synthesis */}
        <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
          <div className="flex items-center justify-between border-b border-slate-100 pb-2">
            <span className="text-xs font-bold text-slate-900 uppercase">6. Crop ETc Output</span>
            <span className="text-[10px] font-mono text-emerald-700 bg-emerald-50 px-1 rounded">FINAL</span>
          </div>
          <div className="space-y-1.5 text-xs">
            <div className="flex justify-between">
              <span className="text-slate-500">Reference ET₀:</span>
              <span className="font-mono font-semibold text-slate-900">{et0} mm/day</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">Selected Crop:</span>
              <span className="font-medium text-slate-900">{crop.cropName}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">Growth Stage:</span>
              <span className="capitalize font-medium text-slate-700">{crop.stage} Stage</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">Crop Coeff (Kc):</span>
              <span className="font-mono text-slate-900">{kc}</span>
            </div>
            <div className="flex justify-between text-emerald-900 font-bold pt-1 border-t border-slate-100 text-sm">
              <span>Crop ETc (Kc · ET₀):</span>
              <span className="font-mono">{etc} mm/day</span>
            </div>
          </div>
        </div>
      </div>

      {/* 4. Methodology & Sensor Limitations Documentation (Research Transparency) */}
      <div className="bg-slate-50 border border-slate-200 rounded-xl p-5 space-y-3">
        <div className="flex items-center gap-2 text-slate-900 font-semibold text-xs uppercase tracking-wide">
          <Info className="w-4 h-4 text-slate-600" />
          <span>Scientific Methodology & Hardware Constraints (FAO-56 Annex Compliance)</span>
        </div>
        <ul className="space-y-2 text-xs text-slate-600 list-disc list-inside">
          {methodLimitations.map((lim, index) => (
            <li key={index} className="leading-relaxed">
              {lim}
            </li>
          ))}
          <li className="leading-relaxed">
            <span className="font-semibold text-slate-900">Psychrometric Formulation:</span> Barometric pressure P is derived strictly from site elevation ({calibration.elevation} m) according to the standard FAO-56 atmospheric equation rather than relying on raw uncorrected sensor drift.
          </li>
        </ul>
      </div>
    </div>
  );
};
