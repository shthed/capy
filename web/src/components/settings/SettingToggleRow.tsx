import React from 'react';
export {
  CollapsibleSettingSection,
  SettingSectionCard,
  type CollapsibleSettingSectionProps,
  type SettingSectionCardProps,
} from '../SettingsControls';

export interface SettingToggleRowProps {
  label: string;
  description?: string;
  checked: boolean;
  onToggle: () => void;
  testId?: string;
  disabled?: boolean;
  badge?: string;
  title?: string;
  className?: string;
}

export const SettingToggleRow: React.FC<SettingToggleRowProps> = ({
  label,
  description,
  checked,
  onToggle,
  testId,
  disabled = false,
  badge,
  title,
  className = '',
}) => {
  return (
    <div
      className={`flex items-center justify-between gap-3 min-h-[44px] px-3 py-2 rounded-xl bg-slate-900/55 border border-slate-800/75 transition-colors ${
        disabled ? 'opacity-50 pointer-events-none' : 'hover:bg-slate-800/35'
      } ${className}`}
    >
      <div className="min-w-0 flex-1">
        <div className="text-xs sm:text-sm font-semibold text-slate-200 flex items-center gap-1.5 flex-wrap">
          <span>{label}</span>
          {badge && (
            <span className="text-[9px] font-black uppercase px-1.5 py-0.5 rounded bg-amber-400 text-slate-950">
              {badge}
            </span>
          )}
        </div>
        {description && (
          <div className="text-[11px] text-slate-400 leading-snug mt-0.5">{description}</div>
        )}
      </div>
      <button
        type="button"
        role="switch"
        data-testid={testId}
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        title={title}
        onClick={() => {
          if (!disabled) onToggle();
        }}
        className={`capy-switch w-10 h-5.5 flex items-center rounded-full p-0.5 flex-shrink-0 transition-colors ${
          disabled ? 'cursor-not-allowed' : 'cursor-pointer'
        } ${checked ? 'bg-amber-500' : 'bg-slate-700'}`}
      >
        <div
          className={`capy-switch-knob bg-white w-4.5 h-4.5 rounded-full shadow-md transform transition-transform ${
            checked ? 'translate-x-4.5' : 'translate-x-0'
          }`}
        />
      </button>
    </div>
  );
};
