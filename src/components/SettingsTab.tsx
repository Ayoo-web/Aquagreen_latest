import React, { useState } from 'react';
import { AlertCircle, Check, HelpCircle, RotateCcw, Save, Sliders } from 'lucide-react';
import { CalibrationSettings, WaterTankSettings } from '../types';
import { DEFAULT_CALIBRATION } from '../services/storage';

interface SettingsTabProps {
  calibration: CalibrationSettings;
  onSaveCalibration: (updated: CalibrationSettings) => void;
  waterTanks: WaterTankSettings;
  onSaveWaterTanks: (updated: WaterTankSettings) => Promise<boolean>;
  currentAdcReading?: number;
}

export const SettingsTab: React.FC<SettingsTabProps> = ({
  calibration,
  onSaveCalibration,
  waterTanks,
  onSaveWaterTanks,
  currentAdcReading = 2100
}) => {
  const [formData, setFormData] = useState<CalibrationSettings>(calibration);
  const [tankForm, setTankForm] = useState<WaterTankSettings>(waterTanks);
  const [tankSaveMessage, setTankSaveMessage] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState<boolean>(false);
  const [validationError, setValidationError] = useState<string | null>(null);

  React.useEffect(() => {
    setTankForm(waterTanks);
  }, [waterTanks]);

  const handleChange = (field: keyof CalibrationSettings, value: any) => {
    setFormData(prev => ({ ...prev, [field]: value }));
    setSaveSuccess(false);
    setValidationError(null);
  };

  const handleCaptureDry = () => {
    handleChange('soilDryAdc', currentAdcReading);
  };

  const handleCaptureWet = () => {
    handleChange('soilWetAdc', currentAdcReading);
  };

  const handleResetDefaults = () => {
    setFormData(DEFAULT_CALIBRATION);
    setSaveSuccess(false);
    setValidationError(null);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    // Validation
    if (formData.soilDryAdc <= formData.soilWetAdc) {
      setValidationError('Dry ADC value must be greater than Wet ADC value for analog resistive/capacitive soil probes.');
      return;
    }

    if (formData.latitude < -90 || formData.latitude > 90) {
      setValidationError('Latitude must be between -90° and +90°.');
      return;
    }

    if (formData.elevation < -100 || formData.elevation > 8000) {
      setValidationError('Elevation must be within valid terrestrial bounds (-100m to 8000m).');
      return;
    }

    if (formData.anemometerHeight <= 0.2 || formData.anemometerHeight > 20) {
      setValidationError('Anemometer installation height must be between 0.2m and 20m.');
      return;
    }

    if (formData.pumpFlowRate <= 0.1) {
      setValidationError('Pump flow rate must be greater than 0.1 Liters/min.');
      return;
    }

    onSaveCalibration(formData);
    setSaveSuccess(true);
    setTimeout(() => setSaveSuccess(false), 3000);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* 1. Header with Save Action */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-base font-bold text-slate-900">
            System Calibration & Experimental Site Constants
          </h2>
          <p className="text-xs text-slate-500 mt-1">
            Empirical hardware scaling parameters used by the FAO-56 Penman-Monteith engine and safety controllers.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={handleResetDefaults}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition-colors"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Reset Defaults</span>
          </button>

          <button
            type="submit"
            className="flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg transition-colors shadow-xs"
          >
            {saveSuccess ? <Check className="w-4 h-4" /> : <Save className="w-4 h-4" />}
            <span>{saveSuccess ? 'Changes Saved' : 'Save Calibration'}</span>
          </button>
        </div>
      </div>

      {/* Validation alert */}
      {validationError && (
        <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-800 flex items-center gap-2">
          <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
          <span>{validationError}</span>
        </div>
      )}

      {/* Water tank warning thresholds */}
      <section className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs space-y-4">
        <div>
          <h3 className="text-sm font-bold text-slate-900">Water Tank Notification Thresholds</h3>
          <p className="text-xs text-slate-500 mt-1">These thresholds control cloud dashboard alerts. The ESP32 must be calibrated separately with the empty and full sensor distances.</p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <label className="block text-xs font-semibold text-slate-700">
            Supply tank: warn at or below (%)
            <input type="number" min="1" max="50" step="1" value={tankForm.supplyLowThresholdPercent} onChange={e => { setTankForm(prev => ({ ...prev, supplyLowThresholdPercent: Number(e.target.value) })); setTankSaveMessage(null); }} className="mt-1 block w-full px-3 py-2 text-sm font-mono bg-slate-50 border border-slate-300 rounded-md" />
            <span className="block font-normal text-[11px] text-slate-500 mt-1">Default: 20% remaining</span>
          </label>
          <label className="block text-xs font-semibold text-slate-700">
            Collection tank: warn at or above (%)
            <input type="number" min="50" max="99" step="1" value={tankForm.collectionHighThresholdPercent} onChange={e => { setTankForm(prev => ({ ...prev, collectionHighThresholdPercent: Number(e.target.value) })); setTankSaveMessage(null); }} className="mt-1 block w-full px-3 py-2 text-sm font-mono bg-slate-50 border border-slate-300 rounded-md" />
            <span className="block font-normal text-[11px] text-slate-500 mt-1">Default: 90% full</span>
          </label>
        </div>
        {tankSaveMessage && <p className="text-xs text-emerald-700 font-semibold">{tankSaveMessage}</p>}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-[11px] text-slate-500">A 5% hysteresis is applied so small fluctuations around a threshold do not create repeated alerts.</p>
          <button type="button" onClick={async () => {
            if (!Number.isFinite(tankForm.supplyLowThresholdPercent) || tankForm.supplyLowThresholdPercent < 1 || tankForm.supplyLowThresholdPercent > 50) { setTankSaveMessage('Supply warning must be between 1% and 50%.'); return; }
            if (!Number.isFinite(tankForm.collectionHighThresholdPercent) || tankForm.collectionHighThresholdPercent < 50 || tankForm.collectionHighThresholdPercent > 99 || tankForm.collectionHighThresholdPercent <= tankForm.supplyLowThresholdPercent) { setTankSaveMessage('Collection warning must be 50–99% and higher than the supply threshold.'); return; }
            const updated = { ...tankForm, alertHysteresisPercent: 5 };
            setTankSaveMessage('Saving thresholds…');
            const saved = await onSaveWaterTanks(updated);
            if (saved) {
              setTankForm(updated);
              setTankSaveMessage('Water tank thresholds saved to the cloud.');
            } else {
              setTankSaveMessage('Save failed. Check the API connection and dashboard key, then retry.');
            }
          }} className="px-4 py-2 text-xs font-semibold text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg transition-colors">Save Tank Thresholds</button>
        </div>
      </section>

      {/* 2. Calibration Sections */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Soil Moisture ADC 2-Point Calibration */}
        <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs space-y-4">
          <h3 className="text-sm font-bold text-slate-900 border-b border-slate-100 pb-2">
            Soil Moisture Probe 2-Point ADC Calibration
          </h3>

          <div className="p-3 bg-slate-50 rounded-lg text-xs space-y-2">
            <div className="flex justify-between items-center">
              <span className="text-slate-600">Live ESP32 ADC Reading:</span>
              <span className="font-mono font-bold text-slate-900">{currentAdcReading}</span>
            </div>
            <div className="text-[11px] text-slate-500">
              Analog soil probes exhibit inverted ADC response: high values (~3200) in dry air, low values (~1400) in saturated soil.
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Dry Air ADC (0% Moisture)
              </label>
              <div className="flex gap-2">
                <input
                  type="number"
                  min="1500"
                  max="4090"
                  value={formData.soilDryAdc}
                  onChange={e => handleChange('soilDryAdc', parseInt(e.target.value) || 3200)}
                  className="w-full px-2.5 py-1.5 text-xs font-mono bg-slate-50 border border-slate-300 rounded-md"
                />
                <button
                  type="button"
                  onClick={handleCaptureDry}
                  className="px-2 py-1 text-[10px] font-semibold bg-slate-200 hover:bg-slate-300 rounded shrink-0"
                  title="Capture current reading as Dry calibration"
                >
                  Set Live
                </button>
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Saturated ADC (100% Moisture)
              </label>
              <div className="flex gap-2">
                <input
                  type="number"
                  min="200"
                  max="3000"
                  value={formData.soilWetAdc}
                  onChange={e => handleChange('soilWetAdc', parseInt(e.target.value) || 1400)}
                  className="w-full px-2.5 py-1.5 text-xs font-mono bg-slate-50 border border-slate-300 rounded-md"
                />
                <button
                  type="button"
                  onClick={handleCaptureWet}
                  className="px-2 py-1 text-[10px] font-semibold bg-slate-200 hover:bg-slate-300 rounded shrink-0"
                  title="Capture current reading as Wet calibration"
                >
                  Set Live
                </button>
              </div>
            </div>
          </div>

          <div className="text-[11px] text-slate-400">
            Fault guard: Readings at ADC 4095 trigger an automatic sensor open-circuit safety fault.
          </div>
        </div>

        {/* Geographic & Atmospheric Site Constants */}
        <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs space-y-4">
          <h3 className="text-sm font-bold text-slate-900 border-b border-slate-100 pb-2">
            Site Coordinates & Extraterrestrial Radiation Parameters
          </h3>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Latitude (° Dec. Deg. North)
              </label>
              <input
                type="number"
                step="0.0001"
                min="-90"
                max="90"
                value={formData.latitude}
                onChange={e => handleChange('latitude', parseFloat(e.target.value) || 14.5995)}
                className="w-full px-2.5 py-1.5 text-xs font-mono bg-slate-50 border border-slate-300 rounded-md"
              />
              <div className="text-[10px] text-slate-400 mt-1">Used for solar declination δ & Ra</div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Site Elevation (m ASL)
              </label>
              <input
                type="number"
                step="1"
                min="-100"
                max="8000"
                value={formData.elevation}
                onChange={e => handleChange('elevation', parseFloat(e.target.value) || 25.0)}
                className="w-full px-2.5 py-1.5 text-xs font-mono bg-slate-50 border border-slate-300 rounded-md"
              />
              <div className="text-[10px] text-slate-400 mt-1">Governs atmospheric pressure P & γ</div>
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Hargreaves Radiation Adjustment Coefficient (kRs)
            </label>
            <div className="flex items-center gap-3">
              <input
                type="number"
                step="0.01"
                min="0.10"
                max="0.25"
                value={formData.kRs}
                onChange={e => handleChange('kRs', parseFloat(e.target.value) || 0.16)}
                className="w-28 px-2.5 py-1.5 text-xs font-mono bg-slate-50 border border-slate-300 rounded-md"
              />
              <span className="text-xs text-slate-500">
                0.16 for interior locations · 0.19 for coastal island sites
              </span>
            </div>
          </div>
        </div>

        {/* Wind Sensor Calibration & Installation Height */}
        <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs space-y-4">
          <h3 className="text-sm font-bold text-slate-900 border-b border-slate-100 pb-2">
            Anemometer Mounting Height & Profile
          </h3>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Mounting Height (zw in meters)
              </label>
              <input
                type="number"
                step="0.1"
                min="0.3"
                max="10"
                value={formData.anemometerHeight}
                onChange={e => handleChange('anemometerHeight', parseFloat(e.target.value) || 1.0)}
                className="w-full px-2.5 py-1.5 text-xs font-mono bg-slate-50 border border-slate-300 rounded-md"
              />
              <div className="text-[10px] text-slate-400 mt-1">Standard height for crop canopy is 2.0m</div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Pulse Scaling Factor
              </label>
              <input
                type="number"
                step="0.001"
                value={formData.anemometerFactor}
                onChange={e => handleChange('anemometerFactor', parseFloat(e.target.value) || 0.0875)}
                className="w-full px-2.5 py-1.5 text-xs font-mono bg-slate-50 border border-slate-300 rounded-md"
              />
              <div className="text-[10px] text-slate-400 mt-1">Converts pulses/sec into m/s</div>
            </div>
          </div>
        </div>

        {/* Pump Flow Rate & Physical Hardware Polarity */}
        <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs space-y-4">
          <h3 className="text-sm font-bold text-slate-900 border-b border-slate-100 pb-2">
            Hydraulic Pump Flow & Relay Polarity
          </h3>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Pump Flow Rate (Liters / Minute)
              </label>
              <input
                type="number"
                step="0.5"
                min="0.5"
                max="100"
                value={formData.pumpFlowRate}
                onChange={e => handleChange('pumpFlowRate', parseFloat(e.target.value) || 12.0)}
                className="w-full px-2.5 py-1.5 text-xs font-mono bg-slate-50 border border-slate-300 rounded-md"
              />
              <div className="text-[10px] text-slate-400 mt-1">Calibrated bucket test delivery rate</div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Relay Polarity on GPIO17
              </label>
              <div className="mt-1 flex items-center gap-2">
                <input
                  type="checkbox"
                  id="relayActiveLow"
                  checked={formData.relayActiveLow}
                  onChange={e => handleChange('relayActiveLow', e.target.checked)}
                  className="w-4 h-4 text-emerald-600 rounded"
                />
                <label htmlFor="relayActiveLow" className="text-xs text-slate-700">
                  Active-LOW (LOW=ON, HIGH=OFF)
                </label>
              </div>
              <div className="text-[10px] text-slate-400 mt-1">Matches optocoupler relay module</div>
            </div>
          </div>
        </div>

        {/* Dashboard Security & Operator Access Key */}
        <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs space-y-4 md:col-span-2">
          <h3 className="text-sm font-bold text-slate-900 border-b border-slate-100 pb-2">
            Public Deployment Security & Remote Access Key
          </h3>
          <p className="text-xs text-slate-600">
            If your Vercel deployment has configured <code className="bg-slate-100 px-1 py-0.5 rounded text-slate-800">DASHBOARD_API_KEY</code>, enter your authorization secret below so this browser session can submit remote pump controls and update shared system settings.
          </p>

          <div className="flex flex-wrap items-center gap-3">
            <input
              type="password"
              placeholder="Enter DASHBOARD_API_KEY secret..."
              defaultValue={localStorage.getItem('aquagreen_dashboard_key') || ''}
              onChange={e => {
                const val = e.target.value.trim();
                if (val) localStorage.setItem('aquagreen_dashboard_key', val);
                else localStorage.removeItem('aquagreen_dashboard_key');
              }}
              className="w-full max-w-md px-3 py-2 text-xs font-mono bg-slate-50 border border-slate-300 rounded-md focus:bg-white focus:outline-none focus:ring-1 focus:ring-emerald-600"
            />
            <span className="text-[11px] text-slate-500">
              Stored securely in browser session only; never committed to code.
            </span>
          </div>
        </div>
      </div>
    </form>
  );
};
