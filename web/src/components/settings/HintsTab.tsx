import React from 'react';
import { Check, Gamepad2, Lightbulb, Pipette, Sparkles } from 'lucide-react';
import {
  argbToHex,
  Difficulty,
  hexToArgb,
  HintFillStyle,
  RegionColorMode,
  RegionHighlightStyle,
  UserSettings,
} from '../../types';
import { SettingSliderRow } from './SettingSliderRow';
import { SettingSectionCard, SettingToggleRow } from './SettingToggleRow';

export interface HintsTabProps {
  settings: UserSettings;
  onUpdateSettings: (newSettings: UserSettings) => void;
}

const HIGHLIGHT_STYLES = [
  {
    key: 'CENTROID_GLOW',
    label: 'Center Glow',
    desc: 'Pulsing circle at the center',
  },
  {
    key: 'NUMBER_ONLY',
    label: 'Number Color',
    desc: 'Highlights matching number text',
  },
  {
    key: 'FULL_REGION',
    label: 'Entire Region Fill',
    desc: 'Highlights the whole region',
  },
  {
    key: 'BOUNDARY_ONLY',
    label: 'Boundary Outline',
    desc: 'Glowing outline around matching shapes',
  },
] as const;

const HINT_COLOR_PRESETS = [
  { label: 'Amber', hex: '#f59e0b' },
  { label: 'Yellow', hex: '#eab308' },
  { label: 'Orange', hex: '#f97316' },
  { label: 'Cyan', hex: '#06b6d4' },
  { label: 'Emerald', hex: '#10b981' },
  { label: 'Rose', hex: '#ec4899' },
  { label: 'Purple', hex: '#a855f7' },
  { label: 'White', hex: '#ffffff' },
] as const;

const HINT_FILL_PATTERNS = [
  { key: 'SOLID', label: 'Solid' },
  { key: 'CHECKER', label: 'Checker' },
  { key: 'STRIPES', label: 'Diagonal' },
] as const;

const DIFFICULTY_OPTIONS = [
  {
    key: 'EASY',
    label: 'Auto-Select Color (Easy)',
    desc: 'Tap any shape to select and paint its color',
  },
  {
    key: 'NORMAL',
    label: 'Precise (Standard)',
    desc: 'Only paints shapes matching your selected color',
  },
] as const;

const COLOR_MODE_OPTIONS = [
  {
    key: 'DETAIL',
    label: 'Original Detail',
    desc: 'Reveals full photo and line detail',
  },
  {
    key: 'SOLID',
    label: 'Solid Palette',
    desc: 'Fills with a uniform palette color',
  },
] as const;

export const HintsTab: React.FC<HintsTabProps> = ({ settings, onUpdateSettings }) => {
  const updateSetting = <K extends keyof UserSettings>(key: K, value: UserSettings[K]) => {
    onUpdateSettings({ ...settings, [key]: value });
  };

  const hintColorHex = argbToHex(settings.hintColorArgb);
  const currentHintHexLower = hintColorHex.toLowerCase();
  const isFullRegionStyle = settings.highlightStyle === 'FULL_REGION';

  return (
    <div className="space-y-4">
      <SettingSectionCard
        title="Hint Appearance"
        icon={<Sparkles size={13} />}
        testId="hints-section-style"
      >
        {/* Highlight Style */}
        <div className="space-y-1.5">
          <span className="text-xs font-semibold text-slate-300">Highlight Style</span>
          <div className="grid grid-cols-2 gap-2">
            {HIGHLIGHT_STYLES.map((style) => (
              <button
                key={style.key}
                type="button"
                onClick={() => updateSetting('highlightStyle', style.key as RegionHighlightStyle)}
                className={`flex flex-col text-left p-2.5 rounded-lg border transition-all cursor-pointer ${
                  settings.highlightStyle === style.key
                    ? 'border-amber-400 bg-slate-800/80 text-white ring-1 ring-amber-400'
                    : 'border-slate-800 bg-slate-900/50 text-slate-400 hover:bg-slate-800/50'
                }`}
              >
                <span className="text-xs sm:text-sm font-bold text-slate-100">{style.label}</span>
                <span className="text-[11px] text-slate-400 mt-0.5 leading-snug">{style.desc}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Hint Highlight Color */}
        <div className="space-y-1.5 pt-1 border-t border-slate-800/60">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-300">Hint Highlight Color</span>
            <span className="text-[11px] font-mono font-semibold text-amber-400">
              {hintColorHex.toUpperCase()}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {HINT_COLOR_PRESETS.map((col) => {
              const isSelected = currentHintHexLower === col.hex.toLowerCase();
              return (
                <button
                  key={col.hex}
                  type="button"
                  title={col.label}
                  aria-label={`Hint color: ${col.label}`}
                  onClick={() => updateSetting('hintColorArgb', hexToArgb(col.hex))}
                  className={`capy-color-dot w-8 h-8 sm:w-9 sm:h-9 rounded-full border-2 transition-all flex items-center justify-center cursor-pointer ${
                    isSelected
                      ? 'border-white scale-110 shadow-lg ring-2 ring-amber-400'
                      : 'border-slate-700/80 hover:scale-105'
                  }`}
                  style={{ backgroundColor: col.hex }}
                >
                  {isSelected && (
                    <Check
                      className={`w-3.5 h-3.5 ${
                        col.hex === '#ffffff' || col.hex === '#eab308'
                          ? 'text-slate-900'
                          : 'text-white'
                      }`}
                    />
                  )}
                </button>
              );
            })}
            {/* Custom Hint Color Picker */}
            <label
              title="Custom Hint Color"
              aria-label="Custom Hint Color"
              className="capy-color-dot relative w-8 h-8 sm:w-9 sm:h-9 rounded-full border-2 border-slate-700/80 hover:border-slate-500 flex items-center justify-center cursor-pointer transition-all hover:scale-105 overflow-hidden bg-slate-800"
            >
              <input
                type="color"
                aria-label="Choose custom hint color"
                value={hintColorHex}
                onChange={(e) => updateSetting('hintColorArgb', hexToArgb(e.target.value))}
                className="absolute inset-0 opacity-0 w-full h-full cursor-pointer"
              />
              <div
                className="w-full h-full flex items-center justify-center"
                style={{ backgroundColor: hintColorHex }}
              >
                <Pipette className="w-3.5 h-3.5 text-slate-900 drop-shadow-[0_1px_1px_rgba(255,255,255,0.8)]" />
              </div>
            </label>
          </div>
        </div>

        {/* Hint Fill Pattern (applies to Entire Region Fill) */}
        <div
          className={`space-y-1.5 pt-1 border-t border-slate-800/60 transition-opacity ${
            isFullRegionStyle ? 'opacity-100' : 'opacity-50'
          }`}
        >
          <div className="flex flex-wrap items-center justify-between gap-1">
            <span className="text-xs font-semibold text-slate-300">Hint Fill Pattern</span>
            {!isFullRegionStyle && (
              <span className="text-[10px] text-slate-400">
                Applies when Entire Region Fill is selected
              </span>
            )}
          </div>
          <div className="grid grid-cols-3 gap-1.5 sm:gap-2">
            {HINT_FILL_PATTERNS.map((pat) => (
              <button
                key={pat.key}
                type="button"
                disabled={!isFullRegionStyle}
                onClick={() => updateSetting('hintFillStyle', pat.key as HintFillStyle)}
                className={`min-h-[38px] py-2 px-1.5 rounded-lg border text-xs font-bold text-center transition-all ${
                  !isFullRegionStyle ? 'cursor-not-allowed' : 'cursor-pointer'
                } ${
                  settings.hintFillStyle === pat.key
                    ? 'border-amber-400 bg-slate-800 text-amber-300 ring-1 ring-amber-400'
                    : 'border-slate-800 bg-slate-900/50 text-slate-400 hover:bg-slate-800/50'
                }`}
              >
                {pat.label}
              </button>
            ))}
          </div>
        </div>

        {/* Hint Intensity Slider */}
        <SettingSliderRow
          label="Hint Intensity"
          ariaLabel="Hint Intensity"
          valueLabel={`${Math.round(settings.hintIntensity * 100)}%`}
          min="0.2"
          max="1.0"
          step="0.05"
          value={settings.hintIntensity}
          onChange={(val) => updateSetting('hintIntensity', val)}
          containerClassName="space-y-1.5 p-2.5 rounded-xl bg-slate-900/55 border border-slate-800/75"
          labelClassName="text-xs sm:text-sm font-semibold text-slate-200"
        />
      </SettingSectionCard>

      <SettingSectionCard
        title="Assistance & Animation"
        icon={<Lightbulb size={13} />}
        testId="hints-section-assist"
        columns={2}
      >
        <SettingToggleRow
          label="Highlight Every Matching Region"
          description="Highlight all unfinished shapes of the active color"
          checked={Boolean(settings.highlightMatching)}
          onToggle={() => updateSetting('highlightMatching', !settings.highlightMatching)}
          testId="setting-highlight-matching"
        />
        <SettingToggleRow
          label="Animate Hint Pulse"
          description="Add a gentle breathing pulse to hints and active swatches"
          checked={Boolean(settings.animateHint)}
          onToggle={() => updateSetting('animateHint', !settings.animateHint)}
          testId="setting-animate-hint"
        />
        <SettingToggleRow
          label="Pan to Center Region"
          description="Smoothly pan to the next hinted shape when zoomed in"
          checked={Boolean(settings.showNextRegionHint)}
          onToggle={() => updateSetting('showNextRegionHint', !settings.showNextRegionHint)}
          testId="setting-show-next-region-hint"
        />
      </SettingSectionCard>

      <SettingSectionCard
        title="Coloring Mode & Difficulty"
        icon={<Gamepad2 size={13} />}
        testId="hints-section-mode-difficulty"
      >
        {/* Tap Behavior / Difficulty */}
        <div className="space-y-1.5">
          <span className="text-xs font-semibold text-slate-300">Tap Behavior</span>
          <div className="grid grid-cols-2 gap-2">
            {DIFFICULTY_OPTIONS.map((diff) => (
              <button
                key={diff.key}
                type="button"
                onClick={() => updateSetting('difficulty', diff.key as Difficulty)}
                className={`flex flex-col text-left p-2.5 rounded-lg border transition-all cursor-pointer ${
                  settings.difficulty === diff.key
                    ? 'border-amber-400 bg-slate-800/80 text-white ring-1 ring-amber-400'
                    : 'border-slate-800 bg-slate-900/50 text-slate-400 hover:bg-slate-800/50'
                }`}
              >
                <span className="text-xs sm:text-sm font-bold text-slate-100">{diff.label}</span>
                <span className="text-[11px] text-slate-400 mt-0.5 leading-snug">{diff.desc}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Color Mode */}
        <div className="space-y-1.5 pt-1 border-t border-slate-800/60">
          <span className="text-xs font-semibold text-slate-300">Color Mode</span>
          <div className="grid grid-cols-2 gap-2">
            {COLOR_MODE_OPTIONS.map((mode) => (
              <button
                key={mode.key}
                type="button"
                onClick={() => updateSetting('regionColorMode', mode.key as RegionColorMode)}
                className={`flex flex-col text-left p-2.5 rounded-lg border transition-all cursor-pointer ${
                  settings.regionColorMode === mode.key
                    ? 'border-amber-400 bg-slate-800/80 text-white ring-1 ring-amber-400'
                    : 'border-slate-800 bg-slate-900/50 text-slate-400 hover:bg-slate-800/50'
                }`}
              >
                <span className="text-xs sm:text-sm font-bold text-slate-100">{mode.label}</span>
                <span className="text-[11px] text-slate-400 mt-0.5 leading-snug">{mode.desc}</span>
              </button>
            ))}
          </div>
        </div>
      </SettingSectionCard>
    </div>
  );
};
