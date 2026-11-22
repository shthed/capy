import React, { useId } from 'react';

export interface SettingSliderRowProps {
  label: string;
  ariaLabel?: string;
  valueLabel: React.ReactNode;
  valueTestId?: string;
  testId?: string;
  containerTestId?: string;
  min: number | string;
  max: number | string;
  step: number | string;
  value: number;
  onChange: (value: number, event: React.ChangeEvent<HTMLInputElement>) => void;
  description?: React.ReactNode;
  disabled?: boolean;
  dimmed?: boolean;
  headerAdornment?: React.ReactNode;
  callout?: React.ReactNode;
  children?: React.ReactNode;
  containerClassName?: string;
  labelClassName?: string;
  valueClassName?: string;
}

export const SettingSliderRow: React.FC<SettingSliderRowProps> = ({
  label,
  ariaLabel,
  valueLabel,
  valueTestId,
  testId,
  containerTestId,
  min,
  max,
  step,
  value,
  onChange,
  description,
  disabled = false,
  dimmed = false,
  headerAdornment,
  callout,
  children,
  containerClassName = 'space-y-1 p-2.5 rounded-xl bg-slate-900/55 border border-slate-800/75',
  labelClassName = 'text-slate-200 font-semibold',
  valueClassName = 'text-amber-400 font-mono font-bold',
}) => {
  const sliderId = useId();
  const isVisuallyMuted = disabled || dimmed;

  return (
    <div
      data-testid={containerTestId}
      className={`${containerClassName} transition-opacity ${
        isVisuallyMuted ? 'opacity-50' : 'opacity-100'
      }`}
    >
      <div className="flex justify-between items-center text-xs gap-2">
        <div className="flex items-center gap-1.5 min-w-0">
          <label htmlFor={sliderId} className={labelClassName}>
            {label}
          </label>
          {headerAdornment}
        </div>
        <span data-testid={valueTestId} className={valueClassName}>
          {valueLabel}
        </span>
      </div>
      {callout}
      <input
        id={sliderId}
        type="range"
        min={min}
        max={max}
        step={step}
        aria-label={ariaLabel ?? label}
        disabled={disabled}
        data-testid={testId}
        data-dimmed={dimmed ? 'true' : undefined}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value), e)}
        className={`w-full h-1.5 bg-slate-800 rounded-lg ${
          disabled
            ? 'accent-slate-500 cursor-not-allowed'
            : dimmed
              ? 'accent-slate-500 opacity-75 cursor-pointer'
              : 'accent-amber-400 cursor-pointer'
        }`}
      />
      {description && <div className="text-[11px] text-slate-400">{description}</div>}
      {children}
    </div>
  );
};
