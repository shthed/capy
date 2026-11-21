import React, { useId, useState } from 'react';
import { ChevronDown } from 'lucide-react';

export interface SettingSwitchRowProps {
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

export const SettingSwitchRow: React.FC<SettingSwitchRowProps> = ({
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

export interface SettingSectionCardProps {
  title: string;
  icon?: React.ReactNode;
  testId?: string;
  badge?: React.ReactNode;
  columns?: 1 | 2;
  children: React.ReactNode;
  className?: string;
}

export const SettingSectionCard: React.FC<SettingSectionCardProps> = ({
  title,
  icon,
  testId,
  badge,
  columns = 1,
  children,
  className = '',
}) => {
  return (
    <section data-testid={testId} className={`space-y-2 ${className}`}>
      <div className="flex items-center justify-between gap-2 px-0.5">
        <h3 className="flex items-center gap-1.5 text-[11px] sm:text-xs font-bold uppercase tracking-wider text-slate-400">
          {icon && <span className="text-amber-400/90 flex-shrink-0">{icon}</span>}
          <span>{title}</span>
        </h3>
        {badge}
      </div>
      <div
        className={`rounded-xl bg-slate-950/45 border border-slate-800/80 p-2.5 sm:p-3 ${
          columns === 2 ? 'grid grid-cols-1 md:grid-cols-2 gap-2.5' : 'space-y-2.5'
        }`}
      >
        {children}
      </div>
    </section>
  );
};

export interface CollapsibleSettingSectionProps {
  title: string;
  summary: string;
  icon?: React.ReactNode;
  testId?: string;
  defaultOpen?: boolean;
  disabled?: boolean;
  disabledNote?: string;
  children: React.ReactNode;
}

export const CollapsibleSettingSection: React.FC<CollapsibleSettingSectionProps> = ({
  title,
  summary,
  icon,
  testId,
  defaultOpen = false,
  disabled = false,
  disabledNote,
  children,
}) => {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  const contentId = useId();

  return (
    <section
      data-testid={testId}
      className="rounded-xl bg-slate-950/45 border border-slate-800/80 overflow-hidden"
    >
      <button
        type="button"
        data-testid={testId ? `${testId}-toggle` : undefined}
        aria-expanded={isOpen}
        aria-controls={contentId}
        onClick={() => setIsOpen((prev) => !prev)}
        className="w-full min-h-[44px] flex items-center justify-between gap-2 px-3 py-2.5 text-left hover:bg-slate-800/35 transition-colors cursor-pointer"
      >
        <div className="flex items-center gap-2 min-w-0">
          {icon && <span className="text-amber-400/90 flex-shrink-0">{icon}</span>}
          <span className="text-xs sm:text-sm font-bold text-slate-200 truncate">{title}</span>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <span
            data-testid={testId ? `${testId}-summary` : undefined}
            className="text-[11px] font-mono font-semibold text-amber-400/95 bg-slate-900/90 border border-slate-800 px-2 py-0.5 rounded-md"
          >
            {summary}
          </span>
          <ChevronDown
            size={16}
            className={`text-slate-400 transition-transform duration-200 ${
              isOpen ? 'rotate-180' : 'rotate-0'
            }`}
          />
        </div>
      </button>
      {isOpen && (
        <div
          id={contentId}
          className="px-2.5 sm:px-3 pb-3 pt-2 border-t border-slate-800/70 space-y-2.5"
        >
          {disabled && disabledNote && (
            <div className="text-[11px] text-amber-300/90 bg-amber-500/10 border border-amber-400/30 rounded-lg px-2.5 py-1.5">
              {disabledNote}
            </div>
          )}
          <div className={disabled ? 'opacity-50 pointer-events-none space-y-2.5' : 'space-y-2.5'}>
            {children}
          </div>
        </div>
      )}
    </section>
  );
};
