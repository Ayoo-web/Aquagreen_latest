import React, { useState } from 'react';
import {
  AlertCircle,
  Check,
  CheckCheck,
  Download,
  Filter,
  Layers,
  Power,
  RotateCcw,
  Trash2
} from 'lucide-react';
import {
  AlertNotification,
  IrrigationEvent,
  SensorReading
} from '../types';
import { StorageService } from '../services/storage';

interface HistoryTabProps {
  readings: SensorReading[];
  events: IrrigationEvent[];
  notifications: AlertNotification[];
  onAcknowledgeNotification: (id: string) => void;
  onClearAllNotifications: () => void;
}

export const HistoryTab: React.FC<HistoryTabProps> = ({
  readings,
  events,
  notifications,
  onAcknowledgeNotification,
  onClearAllNotifications
}) => {
  const [activeSubTab, setActiveSubTab] = useState<'TELEMETRY' | 'PUMP_EVENTS' | 'ALERTS'>('TELEMETRY');
  const [filterType, setFilterType] = useState<string>('ALL');

  const handleDownloadCsv = () => {
    const csvData = StorageService.exportCsv(readings);
    const blob = new Blob([csvData], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `aquagreen_research_telemetry_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      {/* 1. Header with Export CTA */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="text-base font-bold text-slate-900">
              Research Data Log & Audit Trail
            </h2>
            <p className="text-xs text-slate-500 mt-1">
              Raw 12-bit ADC values preserved alongside calibrated parameters and event records.
            </p>
          </div>

          <div className="flex items-center gap-3">
            {/* Sub-tab selection */}
            <div className="flex items-center bg-slate-100 p-1 rounded-lg">
              <button
                onClick={() => setActiveSubTab('TELEMETRY')}
                className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors ${
                  activeSubTab === 'TELEMETRY'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Telemetry ({readings.length})
              </button>
              <button
                onClick={() => setActiveSubTab('PUMP_EVENTS')}
                className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors ${
                  activeSubTab === 'PUMP_EVENTS'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Irrigation Events ({events.length})
              </button>
              <button
                onClick={() => setActiveSubTab('ALERTS')}
                className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors ${
                  activeSubTab === 'ALERTS'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Alerts ({notifications.length})
              </button>
            </div>

            {/* CSV Export Button */}
            <button
              onClick={handleDownloadCsv}
              className="flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg transition-colors shadow-xs"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Export CSV</span>
            </button>
          </div>
        </div>
      </div>

      {/* 2. Sub-Tab Content: Telemetry Table */}
      {activeSubTab === 'TELEMETRY' && (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-xs">
          <div className="px-5 py-3 border-b border-slate-200 flex justify-between items-center bg-slate-50/50">
            <span className="text-xs font-bold text-slate-700 uppercase tracking-wide">
              Logged Sensor Measurements
            </span>
            <span className="text-xs font-mono text-slate-500">
              Showing latest {Math.min(50, readings.length)} rows
            </span>
          </div>

          <div className="overflow-x-auto max-h-[520px]">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 text-slate-500 font-mono text-[11px] border-b border-slate-200 sticky top-0">
                <tr>
                  <th className="py-2.5 px-4 font-semibold">Timestamp</th>
                  <th className="py-2.5 px-4 font-semibold">Temp (°C)</th>
                  <th className="py-2.5 px-4 font-semibold">Humidity (%)</th>
                  <th className="py-2.5 px-4 font-semibold">Soil Raw ADC</th>
                  <th className="py-2.5 px-4 font-semibold">Moisture (%)</th>
                  <th className="py-2.5 px-4 font-semibold">Pressure (hPa)</th>
                  <th className="py-2.5 px-4 font-semibold">Wind (m/s)</th>
                  <th className="py-2.5 px-4 font-semibold">Lux</th>
                  <th className="py-2.5 px-4 font-semibold">Rain</th>
                  <th className="py-2.5 px-4 font-semibold">Pump</th>
                  <th className="py-2.5 px-4 font-semibold">Supply Tank (%)</th>
                  <th className="py-2.5 px-4 font-semibold">Collection Tank (%)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-mono text-slate-700">
                {readings.slice(-50).reverse().map((r, i) => (
                  <tr key={r.id || i} className="hover:bg-slate-50/80 transition-colors">
                    <td className="py-2.5 px-4 whitespace-nowrap text-slate-500">
                      {new Date(r.timestamp).toLocaleTimeString()}
                    </td>
                    <td className="py-2.5 px-4 font-semibold text-slate-900">{r.temperature}°C</td>
                    <td className="py-2.5 px-4">{r.humidity}%</td>
                    <td className="py-2.5 px-4 text-slate-500">{r.soilMoistureRaw}</td>
                    <td className="py-2.5 px-4 font-semibold text-blue-700">{r.soilMoisturePercent}%</td>
                    <td className="py-2.5 px-4">{r.pressure}</td>
                    <td className="py-2.5 px-4">{r.windSpeed}</td>
                    <td className="py-2.5 px-4 text-amber-700">{r.lux}</td>
                    <td className="py-2.5 px-4">
                      {r.rainDetected ? (
                        <span className="text-blue-600 font-semibold">WET</span>
                      ) : (
                        <span className="text-slate-400">DRY</span>
                      )}
                    </td>
                    <td className="py-2.5 px-4">
                      {r.pumpState ? (
                        <span className="text-blue-600 font-bold">ON</span>
                      ) : (
                        <span className="text-slate-400">OFF</span>
                      )}
                    </td>
                    <td className="py-2.5 px-4 font-semibold text-cyan-700">
                      {r.supplyTankPercent == null || r.supplyTankSensorOk !== true ? '—' : `${Number(r.supplyTankPercent).toFixed(1)}%`}
                    </td>
                    <td className="py-2.5 px-4 font-semibold text-amber-700">
                      {r.collectionTankPercent == null || r.collectionTankSensorOk !== true ? '—' : `${Number(r.collectionTankPercent).toFixed(1)}%`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 3. Sub-Tab Content: Irrigation Events */}
      {activeSubTab === 'PUMP_EVENTS' && (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-xs">
          <div className="px-5 py-3 border-b border-slate-200 flex justify-between items-center bg-slate-50/50">
            <span className="text-xs font-bold text-slate-700 uppercase tracking-wide">
              Pump Activation & Interlock Event History
            </span>
            <span className="text-xs text-slate-500">
              {events.length} recorded events
            </span>
          </div>

          {events.length === 0 ? (
            <div className="p-8 text-center text-slate-400 text-xs">
              No irrigation switching events recorded yet.
            </div>
          ) : (
            <div className="overflow-x-auto max-h-[520px]">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 text-slate-500 font-mono text-[11px] border-b border-slate-200 sticky top-0">
                  <tr>
                    <th className="py-2.5 px-4 font-semibold">Timestamp</th>
                    <th className="py-2.5 px-4 font-semibold">Event Type</th>
                    <th className="py-2.5 px-4 font-semibold">Reason</th>
                    <th className="py-2.5 px-4 font-semibold">Source</th>
                    <th className="py-2.5 px-4 font-semibold">Duration</th>
                    <th className="py-2.5 px-4 font-semibold">Est. Volume</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-slate-700">
                  {events.map((e, idx) => (
                    <tr key={e.id || idx} className="hover:bg-slate-50/80 transition-colors">
                      <td className="py-2.5 px-4 font-mono text-slate-500 whitespace-nowrap">
                        {new Date(e.timestamp).toLocaleTimeString()}
                      </td>
                      <td className="py-2.5 px-4 font-mono font-bold">
                        <span className={`px-2 py-0.5 rounded text-[11px] ${
                          e.eventType === 'START'
                            ? 'bg-blue-100 text-blue-800'
                            : e.eventType === 'STOP'
                            ? 'bg-slate-100 text-slate-800'
                            : e.eventType === 'EMERGENCY_STOP'
                            ? 'bg-rose-100 text-rose-800'
                            : 'bg-amber-100 text-amber-800'
                        }`}>
                          {e.eventType}
                        </span>
                      </td>
                      <td className="py-2.5 px-4 max-w-xs truncate" title={e.triggerReason}>
                        {e.triggerReason}
                      </td>
                      <td className="py-2.5 px-4 font-mono text-[11px] text-slate-500">
                        {e.commandSource}
                      </td>
                      <td className="py-2.5 px-4 font-mono">
                        {e.durationSeconds ? `${e.durationSeconds}s` : '—'}
                      </td>
                      <td className="py-2.5 px-4 font-mono text-slate-900">
                        {e.estimatedVolumeLiters ? `${e.estimatedVolumeLiters} L` : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* 4. Sub-Tab Content: Notifications Log */}
      {activeSubTab === 'ALERTS' && (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-xs space-y-4 p-5">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <div>
              <h3 className="text-sm font-bold text-slate-900">System Notification & Fault Log</h3>
              <p className="text-xs text-slate-500">Deduplicated event notifications with cooldown tracking.</p>
            </div>
            {notifications.length > 0 && (
              <button
                onClick={onClearAllNotifications}
                className="flex items-center gap-1 px-3 py-1 text-xs text-rose-700 hover:bg-rose-50 rounded transition-colors"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Clear All</span>
              </button>
            )}
          </div>

          {notifications.length === 0 ? (
            <div className="text-center py-8 text-slate-400 text-xs">
              No active or historical alerts. All systems nominal.
            </div>
          ) : (
            <div className="space-y-2">
              {notifications.map(notif => (
                <div
                  key={notif.id}
                  className={`p-3 rounded-lg border flex items-start justify-between gap-4 ${
                    notif.acknowledged
                      ? 'bg-slate-50 border-slate-200 opacity-60'
                      : notif.severity === 'CRITICAL'
                      ? 'bg-rose-50 border-rose-200'
                      : notif.severity === 'WARNING'
                      ? 'bg-amber-50 border-amber-200'
                      : 'bg-blue-50 border-blue-200'
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <span className={`w-2 h-2 rounded-full shrink-0 mt-1.5 ${
                      notif.severity === 'CRITICAL'
                        ? 'bg-rose-600'
                        : notif.severity === 'WARNING'
                        ? 'bg-amber-600'
                        : 'bg-blue-600'
                    }`} />
                    <div>
                      <div className="flex items-baseline gap-2">
                        <span className="text-xs font-bold text-slate-900">{notif.title}</span>
                        <span className="text-[11px] font-mono text-slate-400">
                          {new Date(notif.timestamp).toLocaleTimeString()}
                        </span>
                      </div>
                      <div className="text-xs text-slate-600 mt-0.5">{notif.message}</div>
                    </div>
                  </div>

                  {!notif.acknowledged && (
                    <button
                      onClick={() => onAcknowledgeNotification(notif.id)}
                      className="px-2.5 py-1 text-[11px] font-semibold text-slate-700 bg-white border border-slate-300 rounded hover:bg-slate-50 transition-colors shrink-0"
                    >
                      Acknowledge
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
