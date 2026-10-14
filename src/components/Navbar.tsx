import React from 'react';
import { AlertCircle, Cpu, Droplets, ShieldAlert } from 'lucide-react';
import { AlertNotification } from '../types';

interface NavbarProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
  notifications: AlertNotification[];
  emergencyStop: boolean;
  onEmergencyStop: () => void;
  onOpenSimulator: () => void;
  esp32Online: boolean;
  pumpRunning: boolean;
}

export const Navbar: React.FC<NavbarProps> = ({
  activeTab,
  setActiveTab,
  notifications,
  emergencyStop,
  onEmergencyStop,
  onOpenSimulator,
  esp32Online,
  pumpRunning
}) => {
  const unreadAlerts = notifications.filter(n => !n.acknowledged).length;

  const navItems = [
    { id: 'overview', label: 'Overview' },
    { id: 'fao56', label: 'FAO-56 Equations' },
    { id: 'crop', label: 'Crop Demand' },
    { id: 'automation', label: 'Automations & Controls' },
    { id: 'predictions', label: 'Predictions' },
    { id: 'history', label: 'History & Data' },
    { id: 'settings', label: 'Calibration' }
  ];

  return (
    <header className="sticky top-0 z-40 bg-white border-b border-slate-200">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between gap-8 h-16">
          {/* Zone 1: Brand Wordmark (Single text element wordmark) */}
          <div className="flex items-center gap-3 shrink-0">
            <div className="w-9 h-9 rounded-lg bg-emerald-700 flex items-center justify-center text-white shadow-sm">
              <Droplets className="w-5 h-5" />
            </div>
            <div>
              <span className="text-base font-bold tracking-tight text-slate-900 whitespace-nowrap">
                AquaGreen Irrigation
              </span>
              <div className="text-[11px] text-slate-500 font-medium">
                FAO-56 Smart Automation
              </div>
            </div>
          </div>

          {/* Zone 2: Navigation Links (Clean single-line prose links) */}
          <nav className="hidden lg:flex items-center gap-1 overflow-x-auto py-1">
            {navItems.map(item => {
              const isActive = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => setActiveTab(item.id)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md whitespace-nowrap transition-colors ${
                    isActive
                      ? 'bg-emerald-50 text-emerald-800 font-semibold'
                      : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
                  }`}
                >
                  {item.label}
                </button>
              );
            })}
          </nav>

          {/* Zone 3: Primary Action & Hardware Tools */}
          <div className="flex items-center gap-3 shrink-0">
            {/* Quick Simulator Tool */}
            <button
              onClick={onOpenSimulator}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-md transition-colors whitespace-nowrap"
              title="Open ESP32 Hardware Simulator & Telemetry Injector"
            >
              <Cpu className="w-3.5 h-3.5 text-slate-600" />
              <span>ESP32 Simulator</span>
            </button>

            {/* Notification Drawer Shortcut */}
            <button
              onClick={() => setActiveTab('history')}
              className="relative p-1.5 text-slate-600 hover:text-slate-900 rounded-md transition-colors"
              title={`${unreadAlerts} unacknowledged alerts`}
            >
              <AlertCircle className="w-4 h-4" />
              {unreadAlerts > 0 && (
                <span className="absolute -top-1 -right-1 flex items-center justify-center min-w-4 h-4 px-1 text-[10px] font-mono font-bold text-white bg-rose-600 rounded-full">
                  {unreadAlerts}
                </span>
              )}
            </button>

            {/* Emergency Stop Primary Button */}
            <button
              onClick={onEmergencyStop}
              className={`flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold rounded-md transition-colors whitespace-nowrap ${
                emergencyStop
                  ? 'bg-rose-700 text-white hover:bg-rose-800 ring-2 ring-rose-400'
                  : 'bg-rose-50 text-rose-700 hover:bg-rose-100 border border-rose-200'
              }`}
            >
              <ShieldAlert className="w-3.5 h-3.5" />
              <span>{emergencyStop ? 'E-STOP ENGAGED' : 'E-STOP'}</span>
            </button>
          </div>
        </div>
      </div>

      {/* Mobile Sub-Navigation Bar */}
      <div className="lg:hidden flex items-center gap-1 px-4 py-2 bg-slate-50 border-t border-slate-200 overflow-x-auto">
        {navItems.map(item => (
          <button
            key={item.id}
            onClick={() => setActiveTab(item.id)}
            className={`px-2.5 py-1 text-xs font-medium rounded whitespace-nowrap ${
              activeTab === item.id
                ? 'bg-emerald-700 text-white'
                : 'text-slate-600 hover:bg-slate-200'
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>
    </header>
  );
};
