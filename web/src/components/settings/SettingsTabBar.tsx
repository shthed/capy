import React from 'react';
import { HelpCircle, Info, RefreshCw, Save, Sliders, Sparkles, X } from 'lucide-react';

export const SETTINGS_TABS = [
  { id: 0, label: 'About', icon: Info },
  { id: 1, label: 'Settings', icon: Sliders },
  { id: 2, label: 'Hints', icon: Sparkles },
  { id: 3, label: 'Create', icon: RefreshCw },
  { id: 4, label: 'Saves', icon: Save },
] as const;

export interface SettingsTabBarProps {
  activeTab: number;
  onSelectTab: (tabId: number) => void;
  onStartTour?: () => void;
  onStartTutorial?: () => void;
  onClose: () => void;
}

export const SettingsTabBar: React.FC<SettingsTabBarProps> = ({
  activeTab,
  onSelectTab,
  onStartTour,
  onStartTutorial,
  onClose,
}) => (
  <div
    className="flex items-center justify-between border-b border-slate-800 bg-slate-950/90 px-2 sm:px-3 flex-shrink-0"
    style={{
      paddingTop: 'max(0.6rem, calc(var(--sat, 0px) + 0.5rem))',
      paddingLeft: 'max(0.5rem, calc(var(--sal, 0px) + 0.5rem))',
      paddingRight: 'max(0.5rem, calc(var(--sar, 0px) + 0.5rem))',
    }}
  >
    <div
      role="tablist"
      aria-label="Settings sections"
      data-testid="settings-modal-tabs"
      className="min-w-0 flex-1 flex flex-wrap md:flex-nowrap items-center gap-0.5 sm:gap-1.5 overflow-x-auto no-scrollbar py-1.5"
    >
      {SETTINGS_TABS.map((tab) => {
        const Icon = tab.icon;
        const isActive = activeTab === tab.id;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={isActive}
            data-testid={`settings-tab-${tab.label.toLowerCase()}`}
            onClick={() => onSelectTab(tab.id)}
            className={`flex-shrink-0 flex items-center gap-0.5 sm:gap-2 min-h-[38px] sm:min-h-[40px] px-1.5 sm:px-3.5 py-1.5 sm:py-2 text-[11px] sm:text-sm font-bold rounded-lg transition-colors cursor-pointer ${
              isActive
                ? 'bg-amber-400 text-slate-950 shadow-sm'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
            }`}
          >
            <Icon className="w-3 h-3 sm:w-[15px] sm:h-[15px]" />
            <span>{tab.label}</span>
          </button>
        );
      })}
    </div>

    <div className="flex items-center gap-1 ml-1 flex-shrink-0">
      {(onStartTour || onStartTutorial) && (
        <button
          type="button"
          data-testid="settings-tour-btn"
          aria-label="Open interactive guide"
          onClick={() => {
            if (onStartTour) {
              onStartTour();
            } else if (onStartTutorial) {
              onClose();
              onStartTutorial();
            }
          }}
          className="capy-icon-btn inline-flex items-center justify-center min-w-[38px] min-h-[38px] rounded-lg text-amber-300/90 hover:text-amber-200 hover:bg-slate-800 transition-colors cursor-pointer"
          title="Interactive Guide"
        >
          <HelpCircle size={19} />
        </button>
      )}

      <button
        type="button"
        data-testid="settings-modal-close"
        aria-label="Close settings"
        onClick={onClose}
        className="capy-icon-btn inline-flex items-center justify-center min-w-[40px] min-h-[40px] rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
        title="Close"
      >
        <X size={20} />
      </button>
    </div>
  </div>
);
