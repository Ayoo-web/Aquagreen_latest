import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { Navbar } from './components/Navbar';
import { OverviewTab } from './components/OverviewTab';
import { Fao56Tab } from './components/Fao56Tab';
import { CropDemandTab } from './components/CropDemandTab';
import { AutomationTab } from './components/AutomationTab';
import { PredictionTab } from './components/PredictionTab';
import { HistoryTab } from './components/HistoryTab';
import { SettingsTab } from './components/SettingsTab';
import { SimulatorDrawer } from './components/SimulatorDrawer';
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
} from './types';
import { ApiService } from './services/api';
import { DEFAULT_AUTOMATION, DEFAULT_CALIBRATION, DEFAULT_CROP, DEFAULT_WATER_TANKS } from './services/storage';
import { calculateFAO56 } from './services/fao56';
import { evaluateAutomationDecision } from './services/irrigationEngine';
import { calculateSoilMoisturePrediction } from './services/predictionEngine';
import { AlertCircle, CheckCircle, Database, ShieldAlert, Wifi } from 'lucide-react';

export default function App() {
  // Navigation State
  const [activeTab, setActiveTab] = useState<string>('overview');
  const [isSimulatorOpen, setIsSimulatorOpen] = useState<boolean>(false);

  // Backend Connection & Health State
  const [backendStatus, setBackendStatus] = useState<{
    online: boolean;
    database: string;
    lastTelemetry?: string;
  }>({
    online: false,
    database: 'connecting...',
  });

  // Authoritative Domain State from Backend API
  const [latestReading, setLatestReading] = useState<SensorReading | null>(null);
  const [isStaleReading, setIsStaleReading] = useState<boolean>(false);
  const [readingAgeSeconds, setReadingAgeSeconds] = useState<number | null>(null);
  const [readingsHistory, setReadingsHistory] = useState<SensorReading[]>([]);
  const [calibration, setCalibration] = useState<CalibrationSettings>(DEFAULT_CALIBRATION);
  const [automation, setAutomation] = useState<AutomationSettings>(DEFAULT_AUTOMATION);
  const [crop, setCrop] = useState<CropSettings>(DEFAULT_CROP);
  const [waterTanks, setWaterTanks] = useState<WaterTankSettings>(DEFAULT_WATER_TANKS);
  const [events, setEvents] = useState<IrrigationEvent[]>([]);
  const [notifications, setNotifications] = useState<AlertNotification[]>([]);

  // Remote Hardware Relay State & Command Queue Tracker
  const [actualPumpRunning, setActualPumpRunning] = useState<boolean>(false);
  const [pendingCommand, setPendingCommand] = useState<any>(null);
  const [commandFeedbackMessage, setCommandFeedbackMessage] = useState<string | null>(null);

  // Active pump duration tracking
  const [activePumpDurationSeconds, setActivePumpDurationSeconds] = useState<number>(0);
  const pumpStartTimestampRef = useRef<number | null>(null);
  const lastStopTimeRef = useRef<number | null>(null);

  // ----------------------------------------------------------------------------
  // Polling Loop & Data Fetching from Live Backend
  // ----------------------------------------------------------------------------
  const fetchLiveData = useCallback(async () => {
    try {
      // 1. Health & DB Status
      const health = await ApiService.checkHealth().catch(() => null);
      if (health) {
        setBackendStatus({
          online: true,
          database: health.database,
          lastTelemetry: health.last_telemetry_timestamp
        });
      } else {
        setBackendStatus(prev => ({ ...prev, online: false }));
      }

      // 2. Latest Telemetry
      const { reading, isStale, ageSeconds } = await ApiService.getLatestTelemetry();
      setLatestReading(reading);
      setIsStaleReading(isStale);
      setReadingAgeSeconds(ageSeconds);

      // 3. Pump Status & Pending Commands
      const pumpInfo = await ApiService.getPumpStatus().catch(() => null);
      if (pumpInfo) {
        setActualPumpRunning(pumpInfo.actualPumpRunning);
        setPendingCommand(pumpInfo.pendingCommand);
        // Clear feedback message once command is acknowledged
        if (!pumpInfo.pendingCommand && commandFeedbackMessage?.includes('Waiting for ESP32')) {
          setCommandFeedbackMessage('Command completed and verified on ESP32!');
          setTimeout(() => setCommandFeedbackMessage(null), 4000);
        }
      }

      // 4. Notifications
      const notifs = await ApiService.getNotifications(20).catch(() => []);
      setNotifications(notifs);

    } catch (err) {
      console.warn('API polling error:', err);
    }
  }, [commandFeedbackMessage]);

  // Initial load: Fetch settings, history, and current reading
  useEffect(() => {
    async function loadInitial() {
      try {
        await fetchLiveData();

        // Load Settings
        const settingsData = await ApiService.getSettings().catch(() => ({}));
        if (settingsData.calibration) {
          setCalibration(prev => ({ ...prev, ...settingsData.calibration }));
        }
        if (settingsData.automation) {
          setAutomation(prev => ({ ...prev, ...settingsData.automation }));
        }
        if (settingsData.crop) {
          setCrop(prev => ({ ...prev, ...settingsData.crop }));
        }
        if (settingsData.waterTanks) {
          setWaterTanks(prev => ({ ...prev, ...settingsData.waterTanks }));
        }

        // Load History
        const history = await ApiService.getTelemetryHistory(50).catch(() => []);
        setReadingsHistory(history);
      } catch (e) {
        console.error('Initial load failure:', e);
      }
    }

    loadInitial();
    const interval = setInterval(fetchLiveData, 3500);
    return () => clearInterval(interval);
  }, [fetchLiveData]);

  // Active pump duration counter
  useEffect(() => {
    if (!actualPumpRunning) {
      setActivePumpDurationSeconds(0);
      pumpStartTimestampRef.current = null;
      return;
    }

    if (!pumpStartTimestampRef.current) {
      pumpStartTimestampRef.current = Date.now();
    }

    const interval = setInterval(() => {
      if (pumpStartTimestampRef.current) {
        const elapsed = Math.round((Date.now() - pumpStartTimestampRef.current) / 1000);
        setActivePumpDurationSeconds(elapsed);
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [actualPumpRunning]);

  // Combined readings list for historical charts
  const combinedReadings = useMemo(() => {
    if (readingsHistory.length === 0 && latestReading) {
      return [latestReading];
    }
    return readingsHistory;
  }, [readingsHistory, latestReading]);

  // Compute FAO-56 Penman-Monteith
  const faoCalculation = useMemo<FAO56Calculation | null>(() => {
    return calculateFAO56(combinedReadings, calibration, crop);
  }, [combinedReadings, calibration, crop]);

  // Compute Soil Moisture Trend Prediction
  const prediction = useMemo<PredictionResult>(() => {
    return calculateSoilMoisturePrediction(combinedReadings, automation.dryThresholdPercent);
  }, [combinedReadings, automation.dryThresholdPercent]);

  // Evaluate Automation Decision State
  const decisionState = useMemo(() => {
    return evaluateAutomationDecision(
      latestReading,
      automation,
      calibration,
      activePumpDurationSeconds,
      events,
      lastStopTimeRef.current
    );
  }, [latestReading, automation, calibration, activePumpDurationSeconds, events]);

  // ----------------------------------------------------------------------------
  // Real Backend Remote Pump Control
  // ----------------------------------------------------------------------------
  const handleTogglePumpManual = async () => {
    if (automation.emergencyStop) {
      setCommandFeedbackMessage('Emergency Stop is engaged! Reset E-STOP before activating pump.');
      setTimeout(() => setCommandFeedbackMessage(null), 4000);
      return;
    }

    const targetAction = actualPumpRunning ? 'PUMP_OFF' : 'PUMP_ON';
    setCommandFeedbackMessage(`Queuing ${targetAction} command... Waiting for ESP32 Physical Acknowledgment.`);

    try {
      const res = await ApiService.sendPumpControl(
        targetAction,
        5,
        `Manual ${targetAction} triggered from public dashboard`
      );
      setPendingCommand(res.command);
      setCommandFeedbackMessage(
        `Command Queued (${res.command.command_id}). Dispatched to ESP32 over HTTPS. Waiting for relay confirmation...`
      );
      // Immediate poll update
      setTimeout(fetchLiveData, 1000);
    } catch (err: any) {
      setCommandFeedbackMessage(`Failed to submit pump control command: ${err.message}`);
      setTimeout(() => setCommandFeedbackMessage(null), 5000);
    }
  };

  const handleEmergencyStop = async () => {
    const nextEStop = !automation.emergencyStop;
    try {
      // 1. Submit emergency stop command to backend
      if (nextEStop) {
        await ApiService.sendPumpControl('EMERGENCY_STOP', 0, 'OPERATOR ENGAGED EMERGENCY STOP');
      }

      // 2. Persist emergency stop flag
      const updated = { ...automation, emergencyStop: nextEStop };
      setAutomation(updated);
      await ApiService.updateSettings({ automation: updated, emergencyStop: nextEStop });

      setCommandFeedbackMessage(
        nextEStop ? 'EMERGENCY STOP ENGAGED. Pump power disabled.' : 'Emergency Stop latch disengaged.'
      );
      setTimeout(fetchLiveData, 1000);
    } catch (err: any) {
      setCommandFeedbackMessage(`Failed to toggle emergency stop: ${err.message}`);
      setTimeout(() => setCommandFeedbackMessage(null), 5000);
    }
  };

  // Telemetry Injector Handler (from simulator)
  const handleInjectReading = async (reading: SensorReading) => {
    try {
      await ApiService.injectSimulatorReading(reading);
      setCommandFeedbackMessage('Simulated telemetry sample recorded (isolated from physical data).');
      setTimeout(() => setCommandFeedbackMessage(null), 3000);
      // Reload live data
      await fetchLiveData();
      const updatedHistory = await ApiService.getTelemetryHistory(50);
      setReadingsHistory(updatedHistory);
    } catch (err: any) {
      setCommandFeedbackMessage(`Simulator injection failed: ${err.message}`);
      setTimeout(() => setCommandFeedbackMessage(null), 4000);
    }
  };

  // Settings Save Handlers
  const handleSaveCalibration = async (updated: CalibrationSettings) => {
    setCalibration(updated);
    try {
      await ApiService.updateSettings({
        calibration: updated,
        soilDryAdc: updated.soilDryAdc,
        soilWetAdc: updated.soilWetAdc,
        latitude: updated.latitude,
        elevation: updated.elevation,
        anemometerHeight: updated.anemometerHeight,
        anemometerFactor: updated.anemometerFactor,
        kRs: updated.kRs,
        pumpFlowRate: updated.pumpFlowRate,
        relayActiveLow: updated.relayActiveLow
      });
      setCommandFeedbackMessage('Calibration settings saved successfully to production database!');
      setTimeout(() => setCommandFeedbackMessage(null), 4000);
    } catch (err: any) {
      setCommandFeedbackMessage(`Failed to save calibration settings: ${err.message}`);
      setTimeout(() => setCommandFeedbackMessage(null), 5000);
    }
  };


  const handleSaveWaterTanks = async (updated: WaterTankSettings): Promise<boolean> => {
    try {
      await ApiService.updateSettings({ waterTanks: updated });
      setWaterTanks(updated);
      setCommandFeedbackMessage('Water tank alert thresholds saved to the cloud.');
      setTimeout(() => setCommandFeedbackMessage(null), 3500);
      return true;
    } catch (err: any) {
      setCommandFeedbackMessage(`Failed to save water tank settings: ${err.message}`);
      setTimeout(() => setCommandFeedbackMessage(null), 5000);
      return false;
    }
  };

  const handleUpdateAutomation = async (updated: AutomationSettings) => {
    setAutomation(updated);
    try {
      await ApiService.updateSettings({
        automation: updated,
        dryThresholdPercent: updated.dryThresholdPercent,
        targetWetPercent: updated.targetWetPercent,
        maxRuntimeMinutes: updated.maxRuntimeMinutes,
        rainInhibitionEnabled: updated.rainInhibitionEnabled,
        emergencyStop: updated.emergencyStop
      });
      setCommandFeedbackMessage('Automation settings synchronized with backend.');
      setTimeout(() => setCommandFeedbackMessage(null), 3000);
    } catch (err: any) {
      console.error('Failed to update automation:', err);
    }
  };

  const handleUpdateCrop = async (updated: CropSettings) => {
    setCrop(updated);
    try {
      await ApiService.updateSettings({ crop: updated });
      setCommandFeedbackMessage('Crop parameters saved.');
      setTimeout(() => setCommandFeedbackMessage(null), 3000);
    } catch (err: any) {
      console.error('Failed to update crop settings:', err);
    }
  };

  const handleAcknowledgeNotification = async (id: string) => {
    try {
      await ApiService.acknowledgeNotification(id);
      const updated = await ApiService.getNotifications(20);
      setNotifications(updated);
    } catch (err: any) {
      console.error('Failed to acknowledge notification:', err);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col text-slate-900">
      {/* 1. Header Navigation Bar */}
      <Navbar
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        notifications={notifications}
        emergencyStop={automation.emergencyStop}
        onEmergencyStop={handleEmergencyStop}
        onOpenSimulator={() => setIsSimulatorOpen(true)}
        esp32Online={backendStatus.online && !isStaleReading}
        pumpRunning={actualPumpRunning}
      />

      {/* Production Deployment Status Strip */}
      <div className="bg-white border-b border-slate-200 py-1.5 px-4 text-xs font-mono text-slate-500">
        <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <span className="flex items-center gap-1.5 font-semibold text-slate-700">
              <span className={`w-2 h-2 rounded-full ${backendStatus.online ? 'bg-emerald-500' : 'bg-rose-500'}`} />
              API: {backendStatus.online ? 'Connected' : 'Offline'}
            </span>
            <span className="flex items-center gap-1.5">
              <Database className="w-3.5 h-3.5 text-slate-400" />
              Storage: <span className="font-semibold text-slate-700">{backendStatus.database}</span>
            </span>
          </div>

          <div className="flex items-center gap-3">
            {pendingCommand && (
              <span className="text-blue-700 font-semibold animate-pulse flex items-center gap-1">
                <span>Pending Dispatch: {pendingCommand.command_type}</span>
              </span>
            )}
            {commandFeedbackMessage && (
              <span className="text-indigo-700 font-semibold">
                {commandFeedbackMessage}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* 2. Main Page Content Viewport */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {activeTab === 'overview' && (
          <OverviewTab
            latestReading={latestReading}
            readings={combinedReadings}
            faoCalculation={faoCalculation}
            calibration={calibration}
            automation={automation}
            waterTanks={waterTanks}
            decisionState={decisionState}
            onTogglePumpManual={handleTogglePumpManual}
            onOpenSettings={() => setActiveTab('settings')}
            esp32Online={backendStatus.online && !isStaleReading}
            activePumpDurationSeconds={activePumpDurationSeconds}
          />
        )}

        {activeTab === 'fao56' && (
          <Fao56Tab
            calculation={faoCalculation}
            calibration={calibration}
            crop={crop}
          />
        )}

        {activeTab === 'crop' && (
          <CropDemandTab
            crop={crop}
            onUpdateCrop={handleUpdateCrop}
            calculation={faoCalculation}
            calibration={calibration}
          />
        )}

        {activeTab === 'automation' && (
          <AutomationTab
            automation={automation}
            onUpdateAutomation={handleUpdateAutomation}
            calibration={calibration}
            latestReading={latestReading}
            decisionState={decisionState}
            onTogglePumpManual={handleTogglePumpManual}
            onEmergencyStop={handleEmergencyStop}
            activePumpDurationSeconds={activePumpDurationSeconds}
          />
        )}

        {activeTab === 'predictions' && (
          <PredictionTab
            prediction={prediction}
            readings={combinedReadings}
            automation={automation}
            calculation={faoCalculation}
          />
        )}

        {activeTab === 'history' && (
          <HistoryTab
            readings={combinedReadings}
            events={events}
            notifications={notifications}
            onAcknowledgeNotification={handleAcknowledgeNotification}
            onClearAllNotifications={() => setNotifications([])}
          />
        )}

        {activeTab === 'settings' && (
          <SettingsTab
            calibration={calibration}
            onSaveCalibration={handleSaveCalibration}
            waterTanks={waterTanks}
            onSaveWaterTanks={handleSaveWaterTanks}
            currentAdcReading={latestReading?.soilMoistureRaw ?? 2100}
          />
        )}
      </main>

      {/* 3. Interactive Hardware Simulator Drawer */}
      <SimulatorDrawer
        isOpen={isSimulatorOpen}
        onClose={() => setIsSimulatorOpen(false)}
        onInjectReading={handleInjectReading}
        latestReading={latestReading}
        calibration={calibration}
        pumpRunning={actualPumpRunning}
      />

      {/* 4. Academic Research Footer */}
      <footer className="border-t border-slate-200 bg-white py-4 mt-auto">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-wrap items-center justify-between gap-4 text-xs text-slate-500">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-slate-700">AquaGreen Public Vercel Deployment</span>
            <span>·</span>
            <span>FAO-56 Evapotranspiration Architecture</span>
          </div>
          <div className="flex items-center gap-4 font-mono text-[11px]">
            <span>Database: Supabase PostgreSQL</span>
            <span>·</span>
            <span>Relay: GPIO17 Active-LOW</span>
            <span>·</span>
            <span>Device Token Security Enabled</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
