import React from 'react';
import {
  Check,
  Compass,
  Film,
  Gamepad2,
  Hand,
  Palette,
  Pipette,
  Type,
  Volume2,
} from 'lucide-react';
import { NativeBridge } from '../../services/NativeBridge';
import {
  argbToHex,
  CANVAS_BG_MAP,
  hexToArgb,
  PaletteSortOrder,
  PresetCanvasBgColor,
  UserSettings,
} from '../../types';
import { REPLAY_SPEED_OPTIONS } from '../ReplayControls';
import { SettingSliderRow } from './SettingSliderRow';
import {
  CollapsibleSettingSection,
  SettingSectionCard,
  SettingToggleRow,
} from './SettingToggleRow';

export interface SettingsTabProps {
  settings: UserSettings;
  isFullscreen?: boolean;
  onUpdateSettings: (newSettings: UserSettings) => void;
  onToggleFullscreen?: () => void;
}

const TOUCH_REACH_PRESETS = [
  { px: 12, label: 'Compact 12px' },
  { px: 22, label: 'Standard 22px' },
  { px: 34, label: 'Large 34px' },
] as const;

const PALETTE_SORT_OPTIONS = [
  { key: 'NUMBER', label: 'By Number' },
  { key: 'REMAINING', label: 'Remaining' },
  { key: 'HUE', label: 'Rainbow' },
  { key: 'LIGHTNESS', label: 'Lightness' },
] as const;

interface AccessibilitySectionProps {
  settings: UserSettings;
  updateSettings: (patch: Partial<UserSettings>) => void;
  updateSetting: <K extends keyof UserSettings>(key: K, value: UserSettings[K]) => void;
}

const AccessibilitySection: React.FC<AccessibilitySectionProps> = ({
  settings,
  updateSettings,
  updateSetting,
}) => {
  const currentReachPx = Math.round(settings.touchReachRadiusPx ?? 22);
  const reachValueLabel =
    settings.fatFingerAssist && (settings.uiScale ?? 1.0) > 1.0 && currentReachPx < 34
      ? `34px (Large UI • saved ${currentReachPx}px)`
      : `${currentReachPx}px`;

  return (
    <SettingSectionCard
      title="Accessibility"
      icon={<Type size={13} />}
      testId="settings-section-accessibility"
    >
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
        <SettingToggleRow
          label="Large Text & Buttons"
          description="Enlarge text, buttons, and numbers, and turn on Tap Assist"
          checked={Boolean(settings.largeText)}
          onToggle={() => {
            if (!settings.largeText) {
              updateSettings({
                largeText: true,
                textScale: Math.max(settings.textScale ?? 1.0, 1.25),
                uiScale: Math.max(settings.uiScale ?? 1.0, 1.25),
                fatFingerAssist: true,
              });
            } else {
              updateSettings({
                largeText: false,
                textScale: 1.0,
                uiScale: 1.0,
              });
            }
          }}
          testId="setting-large-text"
        />
        <SettingToggleRow
          label="Reduced Motion"
          description="Skip confetti bursts, camera glides, and pulsing hints"
          checked={Boolean(settings.reducedMotion)}
          onToggle={() => updateSetting('reducedMotion', !settings.reducedMotion)}
          testId="setting-reduced-motion"
        />
      </div>

      {/* Independent Text Size & UI Size Sliders */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
        <SettingSliderRow
          label="Text Size"
          ariaLabel="Text Size"
          valueLabel={`${Math.round((settings.textScale ?? 1.0) * 100)}%`}
          valueTestId="setting-text-size-value"
          testId="setting-text-size"
          min="0.85"
          max="1.5"
          step="0.05"
          value={settings.textScale ?? 1.0}
          onChange={(raw) => {
            const nextTextScale =
              Math.round(Math.min(1.5, Math.max(0.85, Number.isFinite(raw) ? raw : 1.0)) * 100) /
              100;
            const curUiScale = settings.uiScale ?? 1.0;
            updateSettings({
              textScale: nextTextScale,
              largeText: nextTextScale > 1.0 || curUiScale > 1.0,
            });
          }}
          description="Adjust label and menu text size independently (85%–150%)"
        />

        <SettingSliderRow
          label="UI Size"
          ariaLabel="UI Size"
          valueLabel={`${Math.round((settings.uiScale ?? 1.0) * 100)}%`}
          valueTestId="setting-ui-size-value"
          testId="setting-ui-size"
          min="0.85"
          max="1.4"
          step="0.05"
          value={settings.uiScale ?? 1.0}
          onChange={(raw) => {
            const nextUiScale =
              Math.round(Math.min(1.4, Math.max(0.85, Number.isFinite(raw) ? raw : 1.0)) * 100) /
              100;
            const curTextScale = settings.textScale ?? 1.0;
            updateSettings({
              uiScale: nextUiScale,
              largeText: curTextScale > 1.0 || nextUiScale > 1.0,
            });
          }}
          description="Adjust button, switch, and color swatch size independently (85%–140%)"
        />
      </div>

      {/* Fat-Finger Tap Assist & Finger Reach Radius */}
      <div className="p-2.5 rounded-xl bg-slate-900/55 border border-slate-800/75 space-y-2.5">
        <SettingToggleRow
          label="Fat-Finger Tap Assist"
          description="Snaps near-miss taps to nearby unfilled shapes"
          checked={Boolean(settings.fatFingerAssist)}
          onToggle={() => updateSetting('fatFingerAssist', !settings.fatFingerAssist)}
          testId="setting-fat-finger-assist"
          className="!bg-transparent !border-0 !p-0 !min-h-0"
        />

        <SettingSliderRow
          label="Finger Reach Radius"
          ariaLabel="Finger Reach Radius"
          valueLabel={reachValueLabel}
          valueTestId="setting-touch-reach-value"
          testId="setting-touch-reach-radius"
          containerTestId="setting-touch-reach-controls"
          containerClassName="space-y-1.5 pt-2 border-t border-slate-800/60"
          labelClassName="text-slate-300 font-semibold"
          valueClassName="text-amber-400 font-mono font-bold text-right"
          min="8"
          max="40"
          step="1"
          value={currentReachPx}
          dimmed={!settings.fatFingerAssist}
          onChange={(_raw, e) =>
            updateSettings({
              fatFingerAssist: true,
              touchReachRadiusPx: Math.round(
                Math.min(40, Math.max(8, parseInt(e.target.value, 10) || 22))
              ),
            })
          }
        >
          <div className="grid grid-cols-3 gap-1.5 pt-0.5">
            {TOUCH_REACH_PRESETS.map((preset) => (
              <button
                key={preset.px}
                type="button"
                data-testid={`setting-touch-reach-preset-${preset.px}`}
                onClick={() =>
                  updateSettings({
                    fatFingerAssist: true,
                    touchReachRadiusPx: preset.px,
                  })
                }
                className={`py-1.5 px-2 rounded-lg border text-[11px] font-bold text-center transition-all cursor-pointer ${
                  currentReachPx === preset.px
                    ? 'border-amber-400 bg-slate-800/80 text-amber-300 ring-1 ring-amber-400'
                    : 'border-slate-800 bg-slate-950/40 text-slate-400 hover:bg-slate-800/50'
                }`}
              >
                {preset.label}
              </button>
            ))}
          </div>
        </SettingSliderRow>
      </div>
    </SettingSectionCard>
  );
};

export const SettingsTab: React.FC<SettingsTabProps> = ({
  settings,
  isFullscreen,
  onUpdateSettings,
  onToggleFullscreen,
}) => {
  const updateSettings = (patch: Partial<UserSettings>) => {
    onUpdateSettings({ ...settings, ...patch });
  };

  const updateSetting = <K extends keyof UserSettings>(key: K, value: UserSettings[K]) => {
    onUpdateSettings({ ...settings, [key]: value });
  };

  const canvasBgHex = argbToHex(settings.canvasBgArgb);
  const isLightCanvasBg =
    canvasBgHex.toLowerCase() === '#ffffff' || canvasBgHex.toLowerCase() === '#e2e8f0';

  return (
    <div className="space-y-4">
      <AccessibilitySection
        settings={settings}
        updateSettings={updateSettings}
        updateSetting={updateSetting}
      />

      {/* 2. UI */}
      <SettingSectionCard title="UI" icon={<Palette size={13} />} testId="settings-section-ui">
        {/* Canvas Background */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-300">Canvas Background</span>
            <span className="text-[11px] font-mono font-semibold text-amber-400">
              {canvasBgHex.toUpperCase()}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {(Object.keys(CANVAS_BG_MAP) as PresetCanvasBgColor[]).map((key) => {
              const item = CANVAS_BG_MAP[key];
              const isSelected = settings.canvasBgColor === key;
              return (
                <button
                  key={key}
                  type="button"
                  title={item.label}
                  aria-label={`Canvas background: ${item.label}`}
                  onClick={() => {
                    updateSettings({ canvasBgColor: key, canvasBgArgb: item.argb });
                  }}
                  className={`capy-color-dot w-8 h-8 sm:w-9 sm:h-9 rounded-full border-2 transition-all flex items-center justify-center cursor-pointer ${
                    isSelected
                      ? 'border-white scale-110 shadow-lg ring-2 ring-amber-400'
                      : 'border-slate-700/80 hover:scale-105'
                  }`}
                  style={{ backgroundColor: item.hex }}
                >
                  {isSelected && (
                    <Check
                      className={`w-3.5 h-3.5 ${
                        item.hex === '#ffffff' || item.hex === '#e2e8f0'
                          ? 'text-slate-900'
                          : 'text-white'
                      }`}
                    />
                  )}
                </button>
              );
            })}
            {/* Custom Background Color Picker */}
            <label
              title="Custom Background Color"
              aria-label="Custom Background Color"
              className={`capy-color-dot relative w-8 h-8 sm:w-9 sm:h-9 rounded-full border-2 transition-all hover:scale-105 flex items-center justify-center cursor-pointer overflow-hidden bg-slate-800 ${
                settings.canvasBgColor === 'CUSTOM'
                  ? 'border-white scale-110 shadow-lg ring-2 ring-amber-400'
                  : 'border-slate-700/80 hover:border-slate-500'
              }`}
            >
              <input
                type="color"
                aria-label="Choose custom background color"
                value={canvasBgHex}
                onChange={(e) => {
                  updateSettings({
                    canvasBgColor: 'CUSTOM',
                    canvasBgArgb: hexToArgb(e.target.value),
                  });
                }}
                className="absolute inset-0 opacity-0 w-full h-full cursor-pointer"
              />
              <div
                className="w-full h-full flex items-center justify-center"
                style={{ backgroundColor: canvasBgHex }}
              >
                <Pipette
                  className={`w-3.5 h-3.5 ${
                    isLightCanvasBg ? 'text-slate-900' : 'text-white'
                  } drop-shadow-[0_1px_1px_rgba(0,0,0,0.8)]`}
                />
              </div>
            </label>
          </div>
        </div>

        {/* Palette Order */}
        <div className="space-y-1.5 pt-1 border-t border-slate-800/60">
          <span className="text-xs font-semibold text-slate-300">Palette Order</span>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5 sm:gap-2">
            {PALETTE_SORT_OPTIONS.map((item) => (
              <button
                key={item.key}
                type="button"
                onClick={() => updateSetting('paletteSort', item.key as PaletteSortOrder)}
                className={`min-h-[38px] py-2 px-1.5 rounded-lg border text-xs font-bold text-center transition-all cursor-pointer ${
                  settings.paletteSort === item.key
                    ? 'border-amber-400 bg-slate-800 text-amber-300 ring-1 ring-amber-400'
                    : 'border-slate-800 bg-slate-900/50 text-slate-400 hover:bg-slate-800/50'
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>

        {/* UI Toggles */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5 pt-1 border-t border-slate-800/60">
          <SettingToggleRow
            label="Show Numbers on Regions"
            description="Show number labels inside uncolored shapes"
            checked={Boolean(settings.showRegionLabels)}
            onToggle={() => updateSetting('showRegionLabels', !settings.showRegionLabels)}
            testId="setting-show-region-labels"
          />
          <SettingToggleRow
            label="Show Borders in Preview"
            description="Keep thin outlines visible while peeking at artwork"
            checked={Boolean(settings.showPreviewBorders)}
            onToggle={() => updateSetting('showPreviewBorders', !settings.showPreviewBorders)}
            testId="setting-show-preview-borders"
          />
        </div>
      </SettingSectionCard>

      {/* 3. Gameplay */}
      <SettingSectionCard
        title="Gameplay"
        icon={<Gamepad2 size={13} />}
        testId="settings-section-gameplay"
        columns={2}
      >
        <SettingToggleRow
          label="Auto-Advance Color"
          description="Switch to the next unfinished color automatically"
          checked={Boolean(settings.autoAdvance)}
          onToggle={() => updateSetting('autoAdvance', !settings.autoAdvance)}
          testId="setting-auto-advance"
        />
        <SettingToggleRow
          label="Free Color Mode"
          description="Pick any color freely and paint without number limits"
          checked={Boolean(settings.isFreeColorMode)}
          onToggle={() => updateSetting('isFreeColorMode', !settings.isFreeColorMode)}
          testId="setting-free-color-mode"
        />
        <SettingToggleRow
          label="Custom Color Picker for All Puzzles"
          description="Allow custom colors on every puzzle, not just coloring pages"
          checked={Boolean(settings.enableCustomColorForAllPuzzles)}
          onToggle={() =>
            updateSetting(
              'enableCustomColorForAllPuzzles',
              !settings.enableCustomColorForAllPuzzles
            )
          }
          testId="setting-custom-color-all"
        />
      </SettingSectionCard>

      {/* 4. Controls & On-Screen Buttons */}
      <SettingSectionCard
        title="Controls & On-Screen Buttons"
        icon={<Hand size={13} />}
        testId="settings-section-controls"
        columns={2}
      >
        <SettingToggleRow
          label="Raise Palette Dock"
          description="Add extra bottom spacing for mobile gesture bars"
          checked={Boolean(settings.raisePaletteDock)}
          onToggle={() => updateSetting('raisePaletteDock', !settings.raisePaletteDock)}
          testId="setting-raise-palette-dock"
        />
        <SettingToggleRow
          label="Undo Button"
          description="Show an Undo button above the palette to step back"
          checked={Boolean(settings.enableUndo)}
          onToggle={() => updateSetting('enableUndo', !settings.enableUndo)}
          testId="setting-enable-undo"
        />
        <SettingToggleRow
          label="Zoom (+ / -) Buttons"
          description="Show floating zoom in and out buttons on screen"
          checked={Boolean(settings.showZoomButtons)}
          onToggle={() => updateSetting('showZoomButtons', !settings.showZoomButtons)}
          testId="setting-show-zoom-buttons"
        />
        <SettingToggleRow
          label="Reset View Button"
          description="Show a quick button to fit the puzzle to your screen"
          checked={Boolean(settings.showResetViewButton)}
          onToggle={() => updateSetting('showResetViewButton', !settings.showResetViewButton)}
          testId="setting-show-reset-view-button"
        />
        {!NativeBridge.isAndroid && onToggleFullscreen && (
          <SettingToggleRow
            label="Full Screen Mode"
            badge={isFullscreen ? 'Active' : undefined}
            description={
              isFullscreen
                ? 'Tap to exit full screen'
                : 'Expand the canvas to fill your browser window'
            }
            checked={Boolean(isFullscreen)}
            onToggle={onToggleFullscreen}
            testId="setting-fullscreen"
            title={isFullscreen ? 'Exit Full Screen' : 'Enter Full Screen'}
          />
        )}
      </SettingSectionCard>

      {/* 5. Navigation & Zoom */}
      <SettingSectionCard
        title="Navigation & Zoom"
        icon={<Compass size={13} />}
        testId="settings-section-navigation"
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
          <SettingToggleRow
            label="Smooth Pan Momentum"
            description="Let the canvas glide smoothly after a quick flick"
            checked={Boolean(settings.panMomentum)}
            onToggle={() => updateSetting('panMomentum', !settings.panMomentum)}
            testId="setting-pan-momentum"
          />
          <SettingToggleRow
            label="Invert Double-Tap Zoom"
            description="Drag up to zoom in and drag down to zoom out"
            checked={Boolean(settings.reverseDoubleTapZoom)}
            onToggle={() => updateSetting('reverseDoubleTapZoom', !settings.reverseDoubleTapZoom)}
            testId="setting-reverse-double-tap-zoom"
          />
          <SettingToggleRow
            label="Snap to Zoom Stops"
            description="Gently snap to 1x, 2x, 4x, 8x, and 12x zoom levels"
            checked={Boolean(settings.snapZoomLevels)}
            onToggle={() => updateSetting('snapZoomLevels', !settings.snapZoomLevels)}
            testId="setting-snap-zoom-levels"
          />
        </div>

        <SettingSliderRow
          label="Zoom Sensitivity"
          ariaLabel="Zoom Sensitivity"
          valueLabel={`${(settings.zoomSensitivity ?? 1.0).toFixed(1)}x`}
          testId="setting-zoom-sensitivity"
          min="0.5"
          max="2.0"
          step="0.1"
          value={settings.zoomSensitivity ?? 1.0}
          onChange={(val) => updateSetting('zoomSensitivity', Math.round(val * 10) / 10)}
          description={
            NativeBridge.isAndroid
              ? 'Adjust pinch and double-tap drag zoom speed'
              : 'Adjust scroll, pinch, and double-tap drag zoom speed'
          }
        />
      </SettingSectionCard>

      {/* 6. Sound & Haptics */}
      <SettingSectionCard
        title="Sound & Haptics"
        icon={<Volume2 size={13} />}
        testId="settings-section-audio"
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
          <SettingToggleRow
            label="Sound Effects"
            description="Soft woodblock and brush tap sounds while painting"
            checked={settings.soundEnabled !== false}
            onToggle={() => updateSetting('soundEnabled', !(settings.soundEnabled !== false))}
            testId="setting-sound-enabled"
          />
          <SettingToggleRow
            label="Haptic Feedback"
            description="Gentle vibration feedback when painting and finishing colors"
            checked={Boolean(settings.hapticsEnabled)}
            onToggle={() => updateSetting('hapticsEnabled', !settings.hapticsEnabled)}
            testId="setting-haptics"
          />
        </div>

        <SettingSliderRow
          label="Sound Volume"
          ariaLabel="Sound Volume"
          valueLabel={
            settings.soundEnabled === false
              ? 'Muted'
              : `${Math.round((settings.soundVolume ?? 0.7) * 100)}%`
          }
          testId="setting-sound-volume"
          min="0"
          max="1"
          step="0.05"
          disabled={settings.soundEnabled === false}
          value={settings.soundVolume ?? 0.7}
          onChange={(val) => updateSetting('soundVolume', Math.round(val * 100) / 100)}
        />
      </SettingSectionCard>

      {/* 7a. Collapsible Replay Settings */}
      <CollapsibleSettingSection
        title="Replay"
        summary={`${settings.replaySpeed || 1}x • Auto-replay ${settings.autoReplayOnLoad ? 'On' : 'Off'}`}
        icon={<Film size={14} />}
        testId="settings-section-replay"
      >
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-xs">
            <span className="font-semibold text-slate-300">Replay Speed</span>
            <span className="font-mono font-bold text-amber-400">{settings.replaySpeed || 1}x</span>
          </div>
          <div className="grid grid-cols-3 sm:grid-cols-6 gap-1.5">
            {REPLAY_SPEED_OPTIONS.map((spd) => (
              <button
                key={spd}
                type="button"
                onClick={() => updateSetting('replaySpeed', spd)}
                className={`min-h-[36px] py-1.5 rounded-lg text-xs font-bold border transition-all cursor-pointer ${
                  (settings.replaySpeed || 1) === spd
                    ? 'bg-amber-400 text-slate-950 border-amber-300 shadow'
                    : 'bg-slate-900/60 text-slate-300 border-slate-800 hover:bg-slate-800'
                }`}
              >
                {spd}x
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
          <SettingToggleRow
            label="Replay on Load"
            description="Play back your painting progress when opening a save"
            checked={Boolean(settings.autoReplayOnLoad)}
            onToggle={() => updateSetting('autoReplayOnLoad', !settings.autoReplayOnLoad)}
            testId="toggle-auto-replay-btn"
          />
          <SettingToggleRow
            label="Follow Painting"
            description="Pan the camera smoothly to follow each painted shape"
            checked={Boolean(settings.replayFollow)}
            onToggle={() => updateSetting('replayFollow', !settings.replayFollow)}
            testId="toggle-replay-follow-btn"
          />
          <SettingToggleRow
            label="Auto-Loop Replay"
            description="Restart the replay automatically when it finishes"
            checked={Boolean(settings.replayLoop)}
            onToggle={() => updateSetting('replayLoop', !settings.replayLoop)}
            testId="toggle-replay-loop-btn"
          />
        </div>
      </CollapsibleSettingSection>

      {/* 7b. Collapsible Number Label Sizing */}
      <CollapsibleSettingSection
        title="Number Label Sizing"
        summary={`${settings.minLabelSize ?? 6}–${settings.maxLabelSize ?? 18}px • ${Math.round(settings.labelScale * 100)}%`}
        icon={<Type size={14} />}
        testId="settings-section-labels"
        disabled={!settings.showRegionLabels}
        disabledNote="Turn on Show Numbers on Regions in UI to adjust label sizing."
      >
        <SettingSliderRow
          label="Minimum Label Size"
          ariaLabel="Minimum Label Size"
          valueLabel={`${settings.minLabelSize ?? 6} px`}
          min="2"
          max="14"
          step="1"
          disabled={!settings.showRegionLabels}
          value={settings.minLabelSize ?? 6}
          onChange={(_raw, e) => {
            const val = parseInt(e.target.value, 10);
            const maxVal = settings.maxLabelSize ?? 18;
            updateSettings(
              val > maxVal ? { minLabelSize: val, maxLabelSize: val } : { minLabelSize: val }
            );
          }}
          description="Show tiny numbers earlier on high-res screens before zooming"
        />

        <SettingSliderRow
          label="Maximum Label Size"
          ariaLabel="Maximum Label Size"
          valueLabel={`${settings.maxLabelSize ?? 18} px`}
          min="10"
          max="36"
          step="1"
          disabled={!settings.showRegionLabels}
          value={settings.maxLabelSize ?? 18}
          onChange={(_raw, e) => {
            const val = parseInt(e.target.value, 10);
            const minVal = settings.minLabelSize ?? 6;
            updateSettings(
              val < minVal ? { maxLabelSize: val, minLabelSize: val } : { maxLabelSize: val }
            );
          }}
          description="Cap number size inside large open shapes"
        />

        <SettingSliderRow
          label="Overall Scale"
          ariaLabel="Overall Label Scale"
          valueLabel={`${Math.round(settings.labelScale * 100)}%`}
          min="0.5"
          max="2.0"
          step="0.05"
          disabled={!settings.showRegionLabels}
          value={settings.labelScale}
          onChange={(val) => updateSetting('labelScale', val)}
          description="Scale all region numbers up or down together"
        />
      </CollapsibleSettingSection>
    </div>
  );
};
