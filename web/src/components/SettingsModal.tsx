import React, { useState, useEffect, useRef } from 'react';
import {
  X,
  Sliders,
  Sparkles,
  RefreshCw,
  Save,
  Check,
  Trash2,
  Edit2,
  RotateCcw,
  Image as ImageIcon,
  Pipette,
  Play,
  Download,
  Upload,
  ExternalLink,
  Smartphone,
} from 'lucide-react';
import {
  CANVAS_BG_MAP,
  CanvasBgColor,
  PresetCanvasBgColor,
  argbToHex,
  hexToArgb,
  Difficulty,
  GeneratorAlgorithm,
  GeneratorConfig,
  HintFillStyle,
  ImageType,
  LineHandlingMode,
  PaletteDetail,
  PaletteSortOrder,
  RegionColorMode,
  RegionHighlightStyle,
  SAMPLE_GALLERY,
  SampleArtwork,
  SavedSnapshot,
  SaveSortOrder,
  UserSettings,
} from '../types';
import { REPLAY_SPEED_OPTIONS } from './ReplayControls';

interface SettingsModalProps {
  isOpen: boolean;
  initialTab?: number;
  settings: UserSettings;
  snapshots: SavedSnapshot[];
  activeSnapshotId: string | null;
  sourceImage?: HTMLImageElement | null;
  isFullscreen?: boolean;
  onClose: () => void;
  onUpdateSettings: (newSettings: UserSettings) => void;
  onToggleFullscreen?: () => void;
  onLoadSnapshot: (snapshot: SavedSnapshot) => void;
  onReplaySnapshot?: (snapshot: SavedSnapshot) => void;
  onRenameSnapshot: (id: string, newTitle: string) => void;
  onDeleteSnapshot: (id: string) => void;
  onClearAllSnapshots: () => void;
  onResetProgress: () => void;
  onRegenerate: (config: GeneratorConfig) => void;
  onSelectSample: (sample: SampleArtwork) => void;
  onUploadImage: () => void;
  onExportSnapshot?: (id: string, title: string) => void;
  onExportAllSnapshots?: () => void;
  onImportSnapshots?: (file: File) => void;
}

const LAST_SETTINGS_TAB_KEY = 'capy_last_settings_tab';

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  initialTab,
  settings,
  snapshots,
  activeSnapshotId,
  sourceImage,
  isFullscreen,
  onClose,
  onUpdateSettings,
  onToggleFullscreen,
  onLoadSnapshot,
  onReplaySnapshot,
  onRenameSnapshot,
  onDeleteSnapshot,
  onClearAllSnapshots,
  onResetProgress,
  onRegenerate,
  onSelectSample,
  onUploadImage,
  onExportSnapshot,
  onExportAllSnapshots,
  onImportSnapshots,
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [activeTab, setActiveTab] = useState<number>(() => {
    if (initialTab !== undefined) return initialTab;
    try {
      const saved = localStorage.getItem(LAST_SETTINGS_TAB_KEY);
      if (saved !== null) {
        const parsed = parseInt(saved, 10);
        if (!isNaN(parsed) && parsed >= 0 && parsed <= 3) return parsed;
      }
    } catch {
      // Ignored
    }
    return 0;
  });
  const [localConfig, setLocalConfig] = useState<GeneratorConfig>(settings.generatorConfig);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameText, setRenameText] = useState<string>('');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [confirmClearAll, setConfirmClearAll] = useState(false);

  // Sync activeTab when modal opens with explicit initialTab or restore last active
  useEffect(() => {
    if (isOpen) {
      if (initialTab !== undefined) {
        setActiveTab(initialTab);
        try {
          localStorage.setItem(LAST_SETTINGS_TAB_KEY, String(initialTab));
        } catch {
          // Ignored
        }
      } else {
        try {
          const saved = localStorage.getItem(LAST_SETTINGS_TAB_KEY);
          if (saved !== null) {
            const parsed = parseInt(saved, 10);
            if (!isNaN(parsed) && parsed >= 0 && parsed <= 3) {
              setActiveTab(parsed);
            }
          }
        } catch {
          // Ignored
        }
      }
    }
  }, [isOpen, initialTab]);

  // Close on Escape key
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  // Artwork resolution and snapping calculations
  const nativeW = sourceImage?.naturalWidth || sourceImage?.width || 0;
  const nativeH = sourceImage?.naturalHeight || sourceImage?.height || 0;
  const nativeMax = Math.max(nativeW, nativeH);

  const STANDARD_RESOLUTIONS = [
    { label: '512p (Fast)', val: 512 },
    { label: '720p (HD)', val: 720 },
    { label: '1024p (Std)', val: 1024 },
    { label: '1280p (Sharp)', val: 1280 },
    { label: '1440p (2K)', val: 1440 },
    { label: '2048p (Ultra)', val: 2048 },
  ];

  const PERCENTAGE_SNAPS = nativeMax > 0 ? [
    { label: '25%', val: Math.max(256, Math.round(nativeMax * 0.25)) },
    { label: '33%', val: Math.max(320, Math.round(nativeMax * 0.33)) },
    { label: '50%', val: Math.max(480, Math.round(nativeMax * 0.50)) },
    { label: '75%', val: Math.max(640, Math.round(nativeMax * 0.75)) },
    { label: '100% (Native)', val: nativeMax },
  ] : [];

  const ALL_SNAP_VALUES = Array.from(new Set([
    ...STANDARD_RESOLUTIONS.map((s) => s.val),
    ...PERCENTAGE_SNAPS.map((p) => p.val),
  ])).sort((a, b) => a - b);

  const snapResolution = (rawVal: number) => {
    let closest = rawVal;
    let minDiff = 40;
    for (const snap of ALL_SNAP_VALUES) {
      const diff = Math.abs(rawVal - snap);
      if (diff < minDiff) {
        minDiff = diff;
        closest = snap;
      }
    }
    return closest;
  };

  if (!isOpen) return null;

  const updateSetting = <K extends keyof UserSettings>(key: K, value: UserSettings[K]) => {
    onUpdateSettings({ ...settings, [key]: value });
  };

  const tabs = [
    { id: 0, label: 'Settings', icon: Sliders },
    { id: 1, label: 'Hints', icon: Sparkles },
    { id: 2, label: 'Create', icon: RefreshCw },
    { id: 3, label: 'Saves', icon: Save },
  ];

  // Sort snapshots
  const sortedSnapshots = [...snapshots].sort((a, b) => {
    // Active save pinned first
    if (a.id === activeSnapshotId) return -1;
    if (b.id === activeSnapshotId) return 1;

    switch (settings.saveSortOrder) {
      case 'LAST_ACTIVE':
        return b.lastOpened - a.lastOpened;
      case 'DATE':
        return b.timestamp - a.timestamp;
      case 'PERCENT_COMPLETE': {
        const pctA = a.totalCount > 0 ? a.filledCount / a.totalCount : 0;
        const pctB = b.totalCount > 0 ? b.filledCount / b.totalCount : 0;
        return pctB - pctA;
      }
      default:
        return 0;
    }
  });

  return (
    <div
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
      className="fixed inset-0 z-50 flex sm:items-center sm:justify-center sm:p-4 md:p-6 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200 select-none cursor-pointer sm:cursor-default"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative w-full h-full sm:h-[88vh] sm:max-h-[860px] sm:max-w-2xl flex flex-col bg-slate-900 sm:border sm:border-slate-800 sm:rounded-2xl shadow-2xl overflow-hidden text-slate-100 cursor-auto"
      >
        {/* Top Tab Bar: Tab headings & close button directly at the top (no wasted space header) */}
        <div
          className="flex items-center justify-between border-b border-slate-800 bg-slate-950/90 px-2 sm:px-3 flex-shrink-0"
          style={{
            paddingTop: 'max(0.6rem, calc(var(--sat, 0px) + 0.5rem))',
            paddingLeft: 'max(0.5rem, calc(var(--sal, 0px) + 0.5rem))',
            paddingRight: 'max(0.5rem, calc(var(--sar, 0px) + 0.5rem))',
          }}
        >
          {/* Tab Navigation */}
          <div className="flex items-center gap-1 sm:gap-1.5 overflow-x-auto no-scrollbar py-2">
            {tabs.map((tab) => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => {
                    setActiveTab(tab.id);
                    try {
                      localStorage.setItem(LAST_SETTINGS_TAB_KEY, String(tab.id));
                    } catch {
                      // Ignored
                    }
                  }}
                  className={`flex-shrink-0 flex items-center gap-1.5 sm:gap-2 px-2.5 sm:px-3.5 py-1.5 sm:py-2 text-xs sm:text-sm font-bold rounded-lg transition-all ${
                    isActive
                      ? 'bg-amber-400 text-slate-950 shadow-sm'
                      : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
                  }`}
                >
                  <Icon size={15} />
                  <span>{tab.label}</span>
                </button>
              );
            })}
          </div>

          {/* Close button */}
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 ml-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors flex-shrink-0"
            title="Close"
          >
            <X size={20} />
          </button>
        </div>

        {/* Tab Contents */}
        <div
          className="flex-1 overflow-y-auto p-3.5 sm:p-5 space-y-4 sm:space-y-5"
          style={{
            paddingBottom: 'max(2.5rem, calc(var(--sab, 0px) + 1.75rem))',
            paddingLeft: 'max(0.875rem, calc(var(--sal, 0px) + 0.75rem))',
            paddingRight: 'max(0.875rem, calc(var(--sar, 0px) + 0.75rem))',
          }}
        >
          {/* TAB 0: SETTINGS */}
          {activeTab === 0 && (
            <div className="space-y-4 sm:space-y-5">
              {/* Canvas Background */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-[11px] sm:text-xs font-bold uppercase tracking-wider text-slate-400">
                    Canvas Background
                  </label>
                  <span className="text-[11px] font-mono font-semibold text-amber-400">
                    {argbToHex(settings.canvasBgArgb).toUpperCase()}
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
                        onClick={() => {
                          updateSetting('canvasBgColor', key);
                          updateSetting('canvasBgArgb', item.argb);
                        }}
                        className={`w-7 h-7 sm:w-8 sm:h-8 rounded-full border-2 transition-all flex items-center justify-center ${
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
                  {/* Custom Background Colour Picker */}
                  <label
                    title="Custom Background Colour"
                    className={`relative w-7 h-7 sm:w-8 sm:h-8 rounded-full border-2 transition-all hover:scale-105 flex items-center justify-center cursor-pointer overflow-hidden bg-slate-800 ${
                      settings.canvasBgColor === 'CUSTOM'
                        ? 'border-white scale-110 shadow-lg ring-2 ring-amber-400'
                        : 'border-slate-700/80 hover:border-slate-500'
                    }`}
                  >
                    <input
                      type="color"
                      value={argbToHex(settings.canvasBgArgb)}
                      onChange={(e) => {
                        updateSetting('canvasBgColor', 'CUSTOM');
                        updateSetting('canvasBgArgb', hexToArgb(e.target.value));
                      }}
                      className="absolute inset-0 opacity-0 w-full h-full cursor-pointer"
                    />
                    <div
                      className="w-full h-full flex items-center justify-center"
                      style={{ backgroundColor: argbToHex(settings.canvasBgArgb) }}
                    >
                      <Pipette
                        className={`w-3.5 h-3.5 ${
                          argbToHex(settings.canvasBgArgb).toLowerCase() === '#ffffff' ||
                          argbToHex(settings.canvasBgArgb).toLowerCase() === '#e2e8f0'
                            ? 'text-slate-900'
                            : 'text-white'
                        } drop-shadow-[0_1px_1px_rgba(0,0,0,0.8)]`}
                      />
                    </div>
                  </label>
                </div>
              </div>

              {/* Region Color Mode */}
              <div className="space-y-1.5">
                <label className="text-[11px] sm:text-xs font-bold uppercase tracking-wider text-slate-400">
                  Color Mode
                </label>
                <div className="grid grid-cols-2 gap-2">
                  {(
                    [
                      { key: 'DETAIL', label: 'Original Detail', desc: 'Reveals full photo/line detail' },
                      { key: 'SOLID', label: 'Solid Palette', desc: 'Fills with uniform palette colour' },
                    ] as const
                  ).map((mode) => (
                    <button
                      key={mode.key}
                      type="button"
                      onClick={() => updateSetting('regionColorMode', mode.key as RegionColorMode)}
                      className={`flex flex-col text-left p-2.5 rounded-lg border transition-all ${
                        settings.regionColorMode === mode.key
                          ? 'border-amber-400 bg-slate-800/80 text-white ring-1 ring-amber-400'
                          : 'border-slate-800 bg-slate-950/40 text-slate-400 hover:bg-slate-800/50'
                      }`}
                    >
                      <span className="text-xs sm:text-sm font-bold text-slate-100">{mode.label}</span>
                      <span className="text-[11px] text-slate-400 mt-0.5 leading-snug">{mode.desc}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Difficulty */}
              <div className="space-y-1.5">
                <label className="text-[11px] sm:text-xs font-bold uppercase tracking-wider text-slate-400">
                  Difficulty (Tap Forgiveness)
                </label>
                <div className="grid grid-cols-2 gap-2">
                  {(
                    [
                      { key: 'EASY', label: 'Auto-Select Colour (Easy)', desc: 'Tapping selects & paints colour' },
                      { key: 'NORMAL', label: 'Precise (Standard)', desc: 'Only fills matching active colour' },
                    ] as const
                  ).map((diff) => (
                    <button
                      key={diff.key}
                      type="button"
                      onClick={() => updateSetting('difficulty', diff.key as Difficulty)}
                      className={`flex flex-col text-left p-2.5 rounded-lg border transition-all ${
                        settings.difficulty === diff.key
                          ? 'border-amber-400 bg-slate-800/80 text-white ring-1 ring-amber-400'
                          : 'border-slate-800 bg-slate-950/40 text-slate-400 hover:bg-slate-800/50'
                      }`}
                    >
                      <span className="text-xs sm:text-sm font-bold text-slate-100">{diff.label}</span>
                      <span className="text-[11px] text-slate-400 mt-0.5 leading-snug">{diff.desc}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Palette Order */}
              <div className="space-y-1.5">
                <label className="text-[11px] sm:text-xs font-bold uppercase tracking-wider text-slate-400">
                  Palette Order
                </label>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5 sm:gap-2">
                  {(
                    [
                      { key: 'NUMBER', label: 'By Number' },
                      { key: 'REMAINING', label: 'Remaining' },
                      { key: 'HUE', label: 'Rainbow (Hue)' },
                      { key: 'LIGHTNESS', label: 'Lightness' },
                    ] as const
                  ).map((item) => (
                    <button
                      key={item.key}
                      type="button"
                      onClick={() => updateSetting('paletteSort', item.key as PaletteSortOrder)}
                      className={`py-2 px-1.5 rounded-lg border text-xs font-bold text-center transition-all ${
                        settings.paletteSort === item.key
                          ? 'border-amber-400 bg-slate-800 text-amber-300 ring-1 ring-amber-400'
                          : 'border-slate-800 bg-slate-950/40 text-slate-400 hover:bg-slate-800/50'
                      }`}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Toggles List */}
              <div className="space-y-1.5">
                <label className="text-[11px] sm:text-xs font-bold uppercase tracking-wider text-slate-400">
                  Preferences & Gameplay
                </label>
                <div className="rounded-xl bg-slate-950/40 border border-slate-800/80 divide-y divide-slate-800/60 overflow-hidden">
                  {onToggleFullscreen && (
                    <div className="flex items-center justify-between p-2.5 sm:p-3 px-3 sm:px-3.5 hover:bg-slate-800/20 transition-colors">
                      <div className="pr-3 min-w-0">
                        <div className="text-xs sm:text-sm font-semibold text-slate-200 flex items-center gap-1.5">
                          <span>Full Screen Mode</span>
                          {isFullscreen && (
                            <span className="text-[9px] font-black uppercase px-1.5 py-0.5 rounded bg-amber-400 text-slate-950">
                              Active
                            </span>
                          )}
                        </div>
                        <div className="text-[11px] text-slate-400 leading-tight">
                          {isFullscreen
                            ? 'Canvas occupies full display (tap to exit)'
                            : 'Expand game to fill entire screen and hide browser chrome'}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={onToggleFullscreen}
                        className={`w-10 h-5.5 flex items-center rounded-full p-0.5 flex-shrink-0 transition-colors ${
                          isFullscreen ? 'bg-amber-500' : 'bg-slate-700'
                        }`}
                        title={isFullscreen ? 'Exit Full Screen' : 'Enter Full Screen'}
                      >
                        <div
                          className={`bg-white w-4.5 h-4.5 rounded-full shadow-md transform transition-transform ${
                            isFullscreen ? 'translate-x-4.5' : 'translate-x-0'
                          }`}
                        />
                      </button>
                    </div>
                  )}
                  {[
                    {
                      key: 'isFreeColorMode' as const,
                      label: 'Free Colour Mode',
                      desc: 'Choose your own colours freely and paint any region without number restrictions',
                    },
                    {
                      key: 'prioritizeOnScreen' as const,
                      label: 'Prioritise On-Screen Colours',
                      desc: 'Brings visible viewport colours to front of dock',
                    },
                    {
                      key: 'autoAdvance' as const,
                      label: 'Auto-Advance When Completed',
                      desc: 'Jumps to next remaining colour automatically',
                    },
                    {
                      key: 'showRegionLabels' as const,
                      label: 'Show Numbers on Regions',
                      desc: 'Displays numbers inside region centroids',
                    },
                    {
                      key: 'showPreviewBorders' as const,
                      label: 'Show Borders in Preview Mode',
                      desc: 'Keeps hairline vector outlines visible in preview',
                    },
                    {
                      key: 'raisePaletteDock' as const,
                      label: 'Raise Palette Dock',
                      desc: 'Leaves extra gap at bottom for mobile gestures',
                    },
                    {
                      key: 'showZoomButtons' as const,
                      label: 'Show Zoom (+ / -) Buttons',
                      desc: 'Floating zoom in and out buttons in the bottom right',
                    },
                    {
                      key: 'showResetViewButton' as const,
                      label: 'Show Reset View (Extent) Button',
                      desc: 'Floating button with diagonal arrows to fit puzzle to screen (disabled by default)',
                    },
                    {
                      key: 'enableCustomColorForAllPuzzles' as const,
                      label: 'Enable Custom Colour Picker for All Puzzles',
                      desc: 'Show the custom colour chooser button for all puzzles, not just black and white coloring pages',
                    },
                    {
                      key: 'panMomentum' as const,
                      label: 'Smooth Pan Momentum',
                      desc: 'Flicking the canvas glides smoothly with momentum, like Google Maps',
                    },
                    {
                      key: 'reverseDoubleTapZoom' as const,
                      label: 'Invert Double-Tap Zoom Direction',
                      desc: 'By default, dragging down zooms in and dragging up zooms out. Turn on to drag up to zoom in',
                    },
                    {
                      key: 'hapticsEnabled' as const,
                      label: 'Haptic Vibration Feedback',
                      desc: 'Tactile vibration ticks when painting and completing colours',
                    },
                  ].map((item) => (
                    <div
                      key={item.key}
                      className="flex items-center justify-between p-2.5 sm:p-3 px-3 sm:px-3.5 hover:bg-slate-800/20 transition-colors"
                    >
                      <div className="pr-3 min-w-0">
                        <div className="text-xs sm:text-sm font-semibold text-slate-200">{item.label}</div>
                        <div className="text-[11px] text-slate-400 leading-tight">{item.desc}</div>
                      </div>
                      <button
                        type="button"
                        onClick={() => updateSetting(item.key, !settings[item.key])}
                        className={`w-10 h-5.5 flex items-center rounded-full p-0.5 flex-shrink-0 transition-colors ${
                          settings[item.key] ? 'bg-amber-500' : 'bg-slate-700'
                        }`}
                      >
                        <div
                          className={`bg-white w-4.5 h-4.5 rounded-full shadow-md transform transition-transform ${
                            settings[item.key] ? 'translate-x-4.5' : 'translate-x-0'
                          }`}
                        />
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              {/* Label Scale Slider */}
              <div className="space-y-1.5 p-3 rounded-xl bg-slate-950/40 border border-slate-800/80">
                <div className="flex justify-between items-center text-xs sm:text-sm font-semibold">
                  <span className="text-slate-200">Label Text Size</span>
                  <span className="text-amber-400 font-mono font-bold">
                    {Math.round(settings.labelScale * 100)}%
                  </span>
                </div>
                <input
                  type="range"
                  min="0.5"
                  max="2.0"
                  step="0.05"
                  value={settings.labelScale}
                  onChange={(e) => updateSetting('labelScale', parseFloat(e.target.value))}
                  className="w-full accent-amber-400 cursor-pointer h-1.5 bg-slate-800 rounded-lg"
                />
              </div>

              {/* Replay Speed & Auto-Replay on Load */}
              <div className="space-y-2.5 pt-2 border-t border-slate-800/80">
                <div className="flex items-center justify-between">
                  <label className="text-[11px] sm:text-xs font-bold uppercase tracking-wider text-slate-400">
                    Puzzle Replay Speed
                  </label>
                  <span className="text-[11px] font-bold text-amber-400">
                    {settings.replaySpeed || 1}x
                  </span>
                </div>
                <div className="grid grid-cols-5 gap-1.5">
                  {REPLAY_SPEED_OPTIONS.map((spd) => (
                    <button
                      key={spd}
                      type="button"
                      onClick={() => updateSetting('replaySpeed', spd)}
                      className={`py-1.5 rounded-lg text-xs font-bold border transition-all cursor-pointer ${
                        (settings.replaySpeed || 1) === spd
                          ? 'bg-amber-400 text-slate-950 border-amber-300 shadow'
                          : 'bg-slate-950/60 text-slate-300 border-slate-800 hover:bg-slate-800'
                      }`}
                    >
                      {spd}x
                    </button>
                  ))}
                </div>

                <div className="flex items-center justify-between p-2.5 rounded-xl bg-slate-950/40 border border-slate-800/80">
                  <div className="pr-3">
                    <div className="text-xs sm:text-sm font-bold text-slate-200">
                      Auto-Replay on Save Load
                    </div>
                    <div className="text-[11px] text-slate-400">
                      Automatically play region completion animation when opening a saved game
                    </div>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={settings.autoReplayOnLoad !== false}
                    onClick={() =>
                      updateSetting('autoReplayOnLoad', !(settings.autoReplayOnLoad !== false))
                    }
                    className={`w-11 h-6 rounded-full transition-colors relative flex-shrink-0 cursor-pointer ${
                      settings.autoReplayOnLoad !== false ? 'bg-amber-400' : 'bg-slate-700'
                    }`}
                  >
                    <span
                      className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-slate-950 transition-transform ${
                        settings.autoReplayOnLoad !== false ? 'translate-x-5' : 'translate-x-0'
                      }`}
                    />
                  </button>
                </div>
              </div>

              {/* Platform & External Application Links */}
              <div className="pt-3 border-t border-slate-800/80 space-y-2">
                <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                  Platforms & Applications
                </div>
                <div className="grid grid-cols-1 gap-2">
                  <a
                    href="capy.apk"
                    download="capy.apk"
                    className="flex items-center gap-2 p-2.5 rounded-xl bg-slate-950/60 border border-slate-800 hover:border-amber-400/50 hover:bg-slate-800/40 text-slate-200 transition-all text-xs font-semibold cursor-pointer"
                  >
                    <Smartphone size={16} className="text-amber-400 flex-shrink-0" />
                    <div className="min-w-0">
                      <div className="truncate font-bold text-slate-200">Android APK</div>
                      <div className="text-[10px] text-slate-400 truncate">Download standalone Android application</div>
                    </div>
                  </a>
                </div>
              </div>
            </div>
          )}

          {/* TAB 1: HINTS */}
          {activeTab === 1 && (
            <div className="space-y-4 sm:space-y-5">
              {/* Highlight Style */}
              <div className="space-y-1.5">
                <label className="text-[11px] sm:text-xs font-bold uppercase tracking-wider text-slate-400">
                  Highlight Style
                </label>
                <div className="grid grid-cols-2 gap-2">
                  {(
                    [
                      { key: 'CENTROID_GLOW', label: 'Centroid Glow', desc: 'Pulsing circle at center' },
                      { key: 'NUMBER_ONLY', label: 'Number Badge', desc: 'Glowing pill behind number' },
                      { key: 'FULL_REGION', label: 'Entire Region Fill', desc: 'Fills matching pixels' },
                      { key: 'BOUNDARY_ONLY', label: 'Boundary Outline', desc: 'Glowing perimeter outline' },
                    ] as const
                  ).map((style) => (
                    <button
                      key={style.key}
                      type="button"
                      onClick={() =>
                        updateSetting('highlightStyle', style.key as RegionHighlightStyle)
                      }
                      className={`flex flex-col text-left p-2.5 rounded-lg border transition-all ${
                        settings.highlightStyle === style.key
                          ? 'border-amber-400 bg-slate-800/80 text-white ring-1 ring-amber-400'
                          : 'border-slate-800 bg-slate-950/40 text-slate-400 hover:bg-slate-800/50'
                      }`}
                    >
                      <span className="text-xs sm:text-sm font-bold text-slate-100">{style.label}</span>
                      <span className="text-[11px] text-slate-400 mt-0.5 leading-snug">{style.desc}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Hint Highlight Colour */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-[11px] sm:text-xs font-bold uppercase tracking-wider text-slate-400">
                    Hint Highlight Colour
                  </label>
                  <span className="text-[11px] font-mono font-semibold text-amber-400">
                    {argbToHex(settings.hintColorArgb).toUpperCase()}
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {[
                    { label: 'Amber', hex: '#f59e0b' },
                    { label: 'Yellow', hex: '#eab308' },
                    { label: 'Orange', hex: '#f97316' },
                    { label: 'Cyan', hex: '#06b6d4' },
                    { label: 'Emerald', hex: '#10b981' },
                    { label: 'Rose', hex: '#ec4899' },
                    { label: 'Purple', hex: '#a855f7' },
                    { label: 'White', hex: '#ffffff' },
                  ].map((col) => {
                    const colHex = col.hex.toLowerCase();
                    const currentHex = argbToHex(settings.hintColorArgb).toLowerCase();
                    const isSelected = currentHex === colHex;
                    return (
                      <button
                        key={col.hex}
                        type="button"
                        title={col.label}
                        onClick={() => updateSetting('hintColorArgb', hexToArgb(col.hex))}
                        className={`w-7 h-7 sm:w-8 sm:h-8 rounded-full border-2 transition-all flex items-center justify-center ${
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
                  {/* Custom Hint Colour Picker */}
                  <label
                    title="Custom Hint Colour"
                    className="relative w-7 h-7 sm:w-8 sm:h-8 rounded-full border-2 border-slate-700/80 hover:border-slate-500 flex items-center justify-center cursor-pointer transition-all hover:scale-105 overflow-hidden bg-slate-800"
                  >
                    <input
                      type="color"
                      value={argbToHex(settings.hintColorArgb)}
                      onChange={(e) => updateSetting('hintColorArgb', hexToArgb(e.target.value))}
                      className="absolute inset-0 opacity-0 w-full h-full cursor-pointer"
                    />
                    <div
                      className="w-full h-full flex items-center justify-center"
                      style={{ backgroundColor: argbToHex(settings.hintColorArgb) }}
                    >
                      <Pipette className="w-3.5 h-3.5 text-slate-900 drop-shadow-[0_1px_1px_rgba(255,255,255,0.8)]" />
                    </div>
                  </label>
                </div>
              </div>

              {/* Hint Pattern (for Entire Region Fill) */}
              <div className="space-y-1.5">
                <label className="text-[11px] sm:text-xs font-bold uppercase tracking-wider text-slate-400">
                  Hint Fill Pattern
                </label>
                <div className="grid grid-cols-3 gap-1.5 sm:gap-2">
                  {(
                    [
                      { key: 'SOLID', label: 'Solid' },
                      { key: 'CHECKER', label: 'Checker' },
                      { key: 'STRIPES', label: 'Diagonal' },
                    ] as const
                  ).map((pat) => (
                    <button
                      key={pat.key}
                      type="button"
                      onClick={() => updateSetting('hintFillStyle', pat.key as HintFillStyle)}
                      className={`py-2 px-1.5 rounded-lg border text-xs font-bold text-center transition-all ${
                        settings.hintFillStyle === pat.key
                          ? 'border-amber-400 bg-slate-800 text-amber-300 ring-1 ring-amber-400'
                          : 'border-slate-800 bg-slate-950/40 text-slate-400 hover:bg-slate-800/50'
                      }`}
                    >
                      {pat.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Hint Intensity Slider */}
              <div className="space-y-1.5 p-3 rounded-xl bg-slate-950/40 border border-slate-800/80">
                <div className="flex justify-between items-center text-xs sm:text-sm font-semibold">
                  <span className="text-slate-200">Hint Intensity (Opacity)</span>
                  <span className="text-amber-400 font-mono font-bold">
                    {Math.round(settings.hintIntensity * 100)}%
                  </span>
                </div>
                <input
                  type="range"
                  min="0.2"
                  max="1.0"
                  step="0.05"
                  value={settings.hintIntensity}
                  onChange={(e) => updateSetting('hintIntensity', parseFloat(e.target.value))}
                  className="w-full accent-amber-400 cursor-pointer h-1.5 bg-slate-800 rounded-lg"
                />
              </div>

              {/* Toggles */}
              <div className="space-y-1.5">
                <label className="text-[11px] sm:text-xs font-bold uppercase tracking-wider text-slate-400">
                  Assistance & Animation
                </label>
                <div className="rounded-xl bg-slate-950/40 border border-slate-800/80 divide-y divide-slate-800/60 overflow-hidden">
                  {[
                    {
                      key: 'highlightMatching' as const,
                      label: 'Highlight Every Matching Region',
                      desc: 'Highlights all uncompleted regions of the active colour',
                    },
                    {
                      key: 'animateHint' as const,
                      label: 'Animate Hint Pulse',
                      desc: 'Smooth breathing pulse effect on hints and active swatches',
                    },
                    {
                      key: 'showNextRegionHint' as const,
                      label: 'Pan to Center Region (Hint Assist)',
                      desc: 'Automatically pans canvas when zoomed in to center hinted region',
                    },
                  ].map((item) => (
                    <div
                      key={item.key}
                      className="flex items-center justify-between p-2.5 sm:p-3 px-3 sm:px-3.5 hover:bg-slate-800/20 transition-colors"
                    >
                      <div className="pr-3 min-w-0">
                        <div className="text-xs sm:text-sm font-semibold text-slate-200">{item.label}</div>
                        <div className="text-[11px] text-slate-400 leading-tight">{item.desc}</div>
                      </div>
                      <button
                        type="button"
                        onClick={() => updateSetting(item.key, !settings[item.key])}
                        className={`w-10 h-5.5 flex items-center rounded-full p-0.5 flex-shrink-0 transition-colors ${
                          settings[item.key] ? 'bg-amber-500' : 'bg-slate-700'
                        }`}
                      >
                        <div
                          className={`bg-white w-4.5 h-4.5 rounded-full shadow-md transform transition-transform ${
                            settings[item.key] ? 'translate-x-4.5' : 'translate-x-0'
                          }`}
                        />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: CREATE / GENERATOR */}
          {activeTab === 2 && (
            <div className="space-y-4 sm:space-y-5">
              {/* Built-in Sample Artwork Gallery */}
              <div className="space-y-1.5">
                <label className="text-[11px] sm:text-xs font-bold uppercase tracking-wider text-slate-400">
                  Built-in Sample Artwork
                </label>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-3">
                  {SAMPLE_GALLERY.map((sample) => (
                    <div
                      key={sample.id}
                      className="group relative flex flex-col rounded-xl overflow-hidden border border-slate-800 bg-slate-950/60 hover:border-amber-400/60 transition-all shadow-md"
                    >
                      <div className="relative h-16 sm:h-24 w-full overflow-hidden bg-slate-900">
                        <img
                          src={sample.assetPath}
                          alt={sample.title}
                          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                        />
                        {sample.isFreeColor && (
                          <span className="absolute top-1 right-1 px-1.5 py-0.5 rounded text-[8px] font-black uppercase tracking-wider bg-amber-400 text-slate-950 shadow">
                            Free Colour
                          </span>
                        )}
                      </div>
                      <div className="p-1.5 sm:p-2 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1">
                        <div className="min-w-0">
                          <div className="text-[11px] sm:text-xs font-bold text-slate-200 truncate">{sample.title}</div>
                          <div className="text-[9px] text-slate-400 hidden sm:block">{sample.category}</div>
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            onSelectSample(sample);
                            onClose();
                          }}
                          className="w-full sm:w-auto px-2 py-1 text-[11px] sm:text-xs font-bold bg-amber-400 text-slate-950 rounded-md sm:rounded-lg hover:bg-amber-300 transition-colors shadow text-center"
                        >
                          Play
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Upload Custom Image Button */}
              <button
                type="button"
                onClick={() => {
                  onUploadImage();
                  onClose();
                }}
                className="w-full flex items-center justify-center gap-2 p-2.5 sm:p-3 rounded-xl border border-amber-400/40 bg-amber-400/10 text-amber-300 hover:bg-amber-400/20 text-xs sm:text-sm font-bold transition-colors"
              >
                <ImageIcon size={16} />
                <span>Choose Photo from Device</span>
              </button>

              {/* Generation Algorithm Strategy */}
              <div className="space-y-1.5">
                <label className="text-[11px] sm:text-xs font-bold uppercase tracking-wider text-slate-400">
                  Segmentation Algorithm
                </label>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5 sm:gap-2">
                  {(
                    [
                      { key: 'AUTO', label: 'Auto Detect', desc: 'Analyzes lines & photos' },
                      { key: 'LINE_ART', label: 'Line Art Tracer', desc: 'Traces black outlines accurately' },
                      { key: 'PAINTERLY', label: 'Painterly (Photo)', desc: 'Smooth Kuwahara cel-shading' },
                      { key: 'POSTERIZED', label: 'Posterized', desc: 'Crisp geometric color edges' },
                      { key: 'MOSAIC_CEL', label: 'Mosaic Cells', desc: 'Even stained-glass superpixels' },
                    ] as const
                  ).map((alg) => (
                    <button
                      key={alg.key}
                      type="button"
                      onClick={() =>
                        setLocalConfig((prev) => ({
                          ...prev,
                          algorithm: alg.key as GeneratorAlgorithm,
                          imageType: alg.key === 'PAINTERLY' ? 'PHOTO' : alg.key === 'LINE_ART' ? 'DRAWING' : 'AUTO',
                        }))
                      }
                      className={`p-2 sm:p-2.5 rounded-lg border text-left transition-all ${
                        (localConfig.algorithm || 'AUTO') === alg.key
                          ? 'border-amber-400 bg-slate-800 text-white ring-1 ring-amber-400'
                          : 'border-slate-800 bg-slate-950/40 text-slate-400 hover:bg-slate-800/50'
                      }`}
                    >
                      <div className="text-xs font-bold text-slate-100">{alg.label}</div>
                      <div className="text-[10px] text-slate-400 mt-0.5 leading-snug">{alg.desc}</div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Black Border & Outline Handling */}
              {((localConfig.algorithm || 'AUTO') === 'AUTO' || localConfig.algorithm === 'LINE_ART') && (
                <div className="space-y-1.5 p-2.5 sm:p-3 rounded-xl bg-slate-950/60 border border-slate-800">
                  <label className="text-[11px] sm:text-xs font-bold uppercase tracking-wider text-amber-400">
                    Artwork Black Border Handling
                  </label>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                    {(
                      [
                        {
                          key: 'ABSORB_LINES',
                          label: 'Boundaries Follow Artwork Lines',
                          desc: 'Symmetrically absorbs lines so region borders run along stroke centers',
                        },
                        {
                          key: 'UNIFIED_BLACK_REGION',
                          label: 'Continuous Black Line Region',
                          desc: 'Unifies black ink lines into a single playable line-art region with swatch',
                        },
                      ] as const
                    ).map((mode) => (
                      <button
                        key={mode.key}
                        type="button"
                        onClick={() =>
                          setLocalConfig((prev) => ({
                            ...prev,
                            lineHandling: mode.key as LineHandlingMode,
                          }))
                        }
                        className={`p-2 sm:p-2.5 rounded-lg border text-left transition-all ${
                          (localConfig.lineHandling || 'ABSORB_LINES') === mode.key
                            ? 'border-amber-400 bg-slate-800 text-white ring-1 ring-amber-400'
                            : 'border-slate-800 bg-slate-950/40 text-slate-400 hover:bg-slate-800/50'
                        }`}
                      >
                        <div className="text-xs font-bold text-slate-100">{mode.label}</div>
                        <div className="text-[10px] text-slate-400 mt-0.5 leading-snug">{mode.desc}</div>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Palette Detail Level */}
              <div className="space-y-1.5">
                <label className="text-[11px] sm:text-xs font-bold uppercase tracking-wider text-slate-400">
                  Detail Level Preset
                </label>
                <div className="grid grid-cols-3 sm:grid-cols-5 gap-1.5">
                  {(
                    [
                      { key: 'AUTO', label: 'Auto' },
                      { key: 'LOW', label: 'Low (~8-12)' },
                      { key: 'MEDIUM', label: 'Medium (~14-24)' },
                      { key: 'HIGH', label: 'High (~30-50)' },
                      { key: 'CUSTOM', label: 'Custom' },
                    ] as const
                  ).map((det) => (
                    <button
                      key={det.key}
                      type="button"
                      onClick={() => setLocalConfig((prev) => ({ ...prev, paletteDetail: det.key as PaletteDetail }))}
                      className={`py-1.5 px-1 rounded-lg border text-xs font-bold text-center transition-all ${
                        localConfig.paletteDetail === det.key
                          ? 'border-amber-400 bg-slate-800 text-amber-300 ring-1 ring-amber-400'
                          : 'border-slate-800 bg-slate-950/40 text-slate-400 hover:bg-slate-800/50'
                      }`}
                    >
                      {det.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Manual Fine-Tuning Sliders */}
              <div className="space-y-3.5 p-3 rounded-xl bg-slate-950/50 border border-slate-800">
                <div className="text-[11px] sm:text-xs font-bold uppercase tracking-wider text-slate-400">
                  Manual Fine-Tuning & Constraints
                </div>

                {/* Colors Count */}
                <div className="space-y-1">
                  <div className="flex justify-between text-xs font-semibold">
                    <span className="text-slate-300">Target Palette Colours</span>
                    <span className="text-amber-400 font-mono font-bold">{localConfig.colorCount} colours</span>
                  </div>
                  <input
                    type="range"
                    min="4"
                    max="64"
                    step="1"
                    value={localConfig.colorCount}
                    onChange={(e) =>
                      setLocalConfig((prev) => ({ ...prev, colorCount: parseInt(e.target.value) }))
                    }
                    className="w-full accent-amber-400 cursor-pointer h-1.5 bg-slate-800 rounded-lg"
                  />
                </div>

                {/* Max Regions (Piece Count) */}
                <div className="space-y-1.5">
                  <div className="flex justify-between text-xs font-semibold">
                    <span className="text-slate-300">Max Regions (Puzzle Pieces)</span>
                    <span className="text-amber-400 font-mono font-bold">
                      {localConfig.maxRegions || 200} max pieces
                    </span>
                  </div>
                  <input
                    type="range"
                    min="40"
                    max="2000"
                    step="20"
                    value={localConfig.maxRegions || 200}
                    onChange={(e) =>
                      setLocalConfig((prev) => ({
                        ...prev,
                        maxRegions: parseInt(e.target.value),
                      }))
                    }
                    className="w-full accent-amber-400 cursor-pointer h-1.5 bg-slate-800 rounded-lg"
                  />
                  <div className="grid grid-cols-3 sm:grid-cols-5 gap-1">
                    {[
                      { label: 'Simple (~100)', val: 100 },
                      { label: 'Standard (~250)', val: 250 },
                      { label: 'Detailed (~500)', val: 500 },
                      { label: 'Expert (~1000)', val: 1000 },
                      { label: 'Ultra (~2000)', val: 2000 },
                    ].map((rPreset) => (
                      <button
                        key={rPreset.val}
                        type="button"
                        onClick={() =>
                          setLocalConfig((prev) => ({ ...prev, maxRegions: rPreset.val }))
                        }
                        className={`px-1 py-1 rounded-md border text-[10px] font-bold text-center transition-all ${
                          (localConfig.maxRegions || 200) === rPreset.val
                            ? 'border-amber-400 bg-slate-800 text-amber-300 ring-1 ring-amber-400'
                            : 'border-slate-800 bg-slate-900/60 text-slate-400 hover:bg-slate-800/50'
                        }`}
                      >
                        {rPreset.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Minimum Region Area */}
                <div className="space-y-1.5">
                  <div className="flex justify-between text-xs font-semibold">
                    <span className="text-slate-300">Minimum Region Area</span>
                    <span className="text-amber-400 font-mono font-bold">
                      {localConfig.minRegionArea} px²
                    </span>
                  </div>
                  <input
                    type="range"
                    min="15"
                    max="300"
                    step="5"
                    value={localConfig.minRegionArea}
                    onChange={(e) =>
                      setLocalConfig((prev) => ({
                        ...prev,
                        minRegionArea: parseInt(e.target.value),
                      }))
                    }
                    className="w-full accent-amber-400 cursor-pointer h-1.5 bg-slate-800 rounded-lg"
                  />
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-1">
                    {[
                      { label: 'Fine (24 px²)', val: 24 },
                      { label: 'Balanced (48 px²)', val: 48 },
                      { label: 'Chunky (96 px²)', val: 96 },
                      { label: 'Relaxed (180 px²)', val: 180 },
                    ].map((aPreset) => (
                      <button
                        key={aPreset.val}
                        type="button"
                        onClick={() =>
                          setLocalConfig((prev) => ({ ...prev, minRegionArea: aPreset.val }))
                        }
                        className={`px-1.5 py-1 rounded-md border text-[10px] font-bold text-center transition-all ${
                          localConfig.minRegionArea === aPreset.val
                            ? 'border-amber-400 bg-slate-800 text-amber-300 ring-1 ring-amber-400'
                            : 'border-slate-800 bg-slate-900/60 text-slate-400 hover:bg-slate-800/50'
                        }`}
                      >
                        {aPreset.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Resolution with Snapping */}
                <div className="space-y-2">
                  <div className="flex justify-between items-center text-xs font-semibold">
                    <span className="text-slate-300">Max Canvas Resolution</span>
                    <span className="text-amber-400 font-mono font-bold">
                      {localConfig.resolution} px
                    </span>
                  </div>

                  {nativeMax > 0 && (
                    <div className="text-[11px] text-slate-400 flex items-center justify-between px-2.5 py-1 rounded-lg bg-slate-900/60 border border-slate-800/80">
                      <span>Source Artwork Resolution:</span>
                      <span className="font-mono text-amber-300 font-bold">
                        {nativeW} × {nativeH} px
                      </span>
                    </div>
                  )}

                  <input
                    type="range"
                    min="480"
                    max="2048"
                    step="16"
                    value={localConfig.resolution}
                    onChange={(e) => {
                      const snapped = snapResolution(parseInt(e.target.value));
                      setLocalConfig((prev) => ({ ...prev, resolution: snapped }));
                    }}
                    className="w-full accent-amber-400 cursor-pointer h-1.5 bg-slate-800 rounded-lg"
                  />

                  {/* Artwork percentage snaps */}
                  {PERCENTAGE_SNAPS.length > 0 && (
                    <div className="space-y-1">
                      <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                        Snap to Artwork Scale
                      </div>
                      <div className="grid grid-cols-5 gap-1">
                        {PERCENTAGE_SNAPS.map((snap) => (
                          <button
                            key={snap.label}
                            type="button"
                            onClick={() =>
                              setLocalConfig((prev) => ({ ...prev, resolution: snap.val }))
                            }
                            className={`px-1 py-1 rounded-md border text-[10px] font-bold text-center transition-all ${
                              localConfig.resolution === snap.val
                                ? 'border-amber-400 bg-slate-800 text-amber-300 ring-1 ring-amber-400'
                                : 'border-slate-800 bg-slate-900/60 text-slate-400 hover:bg-slate-800/50'
                            }`}
                          >
                            {snap.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Common standard resolutions */}
                  <div className="space-y-1">
                    <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                      Snap to Standard Resolutions
                    </div>
                    <div className="grid grid-cols-3 sm:grid-cols-6 gap-1">
                      {STANDARD_RESOLUTIONS.map((res) => (
                        <button
                          key={res.val}
                          type="button"
                          onClick={() =>
                            setLocalConfig((prev) => ({ ...prev, resolution: res.val }))
                          }
                          className={`px-1 py-1 rounded-md border text-[10px] font-bold text-center transition-all ${
                            localConfig.resolution === res.val
                              ? 'border-amber-400 bg-slate-800 text-amber-300 ring-1 ring-amber-400'
                              : 'border-slate-800 bg-slate-900/60 text-slate-400 hover:bg-slate-800/50'
                          }`}
                        >
                          {res.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </div>

              {/* Apply & Regenerate */}
              <button
                type="button"
                onClick={() => {
                  updateSetting('generatorConfig', localConfig);
                  onRegenerate(localConfig);
                  onClose();
                }}
                className="w-full py-2.5 sm:py-3 rounded-xl bg-amber-400 text-slate-950 font-extrabold text-xs sm:text-sm hover:bg-amber-300 transition-colors shadow-lg active:scale-98"
              >
                Regenerate Artwork with Settings
              </button>
            </div>
          )}

          {/* TAB 3: SAVES / SNAPSHOTS */}
          {activeTab === 3 && (
            <div className="space-y-3.5">
              {/* Top Controls */}
              <div className="flex flex-wrap items-center justify-between gap-2 pb-1">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-slate-400 font-semibold">Sort:</span>
                  <select
                    value={settings.saveSortOrder}
                    onChange={(e) =>
                      updateSetting('saveSortOrder', e.target.value as SaveSortOrder)
                    }
                    className="bg-slate-800 text-slate-200 text-xs font-semibold rounded-lg px-2.5 py-1.5 border border-slate-700 focus:outline-none"
                  >
                    <option value="LAST_ACTIVE">Last Active</option>
                    <option value="DATE">Date Created</option>
                    <option value="PERCENT_COMPLETE">Completion</option>
                  </select>
                </div>

                <div className="flex items-center gap-2">
                  {/* Hidden file input for Import */}
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".capy,.json,application/json"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file && onImportSnapshots) {
                        onImportSnapshots(file);
                      }
                      if (e.target) e.target.value = '';
                    }}
                  />

                  {onImportSnapshots && (
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      title="Import Save (.capy / .json)"
                      data-testid="import-save-btn"
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-bold bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition-colors shadow active:scale-95 cursor-pointer"
                    >
                      <Upload size={13} className="text-amber-400" />
                      <span>Import</span>
                    </button>
                  )}

                  {onExportAllSnapshots && snapshots.length > 0 && (
                    <button
                      type="button"
                      onClick={onExportAllSnapshots}
                      title="Export All Saves to Backup File"
                      data-testid="export-all-saves-btn"
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-bold bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition-colors shadow active:scale-95 cursor-pointer"
                    >
                      <Download size={13} className="text-amber-400" />
                      <span>Export All</span>
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={onResetProgress}
                    className="flex items-center gap-1 text-xs font-bold text-amber-400 hover:text-amber-300 transition-colors cursor-pointer"
                  >
                    <RotateCcw size={13} />
                    <span>Reset</span>
                  </button>
                </div>
              </div>

              {/* Snapshots List */}
              <div className="space-y-2">
                {sortedSnapshots.map((snap) => {
                  const isActive = snap.id === activeSnapshotId;
                  const isRenaming = renamingId === snap.id;
                  const isConfirmDelete = confirmDeleteId === snap.id;
                  const progressPct =
                    snap.totalCount > 0
                      ? Math.round((snap.filledCount * 100) / snap.totalCount)
                      : 0;

                  return (
                    <div
                      key={snap.id}
                      onDoubleClick={() => {
                        if (!isRenaming) {
                          if (!isActive) {
                            onLoadSnapshot(snap);
                          }
                          onClose();
                        }
                      }}
                      title={
                        isActive
                          ? 'Active save (double-click to resume game)'
                          : 'Double-click to load save and close settings'
                      }
                      className={`relative flex items-center gap-2.5 p-2.5 rounded-xl border transition-all cursor-pointer ${
                        isActive
                          ? 'border-amber-400 bg-amber-500/10 shadow-md ring-1 ring-amber-400/40'
                          : 'border-slate-800 bg-slate-950/40 hover:bg-slate-800/40'
                      }`}
                    >
                      {/* Thumbnail Preview */}
                      <div className="w-12 h-12 rounded-lg bg-slate-800 border border-slate-700/80 overflow-hidden flex-shrink-0 flex items-center justify-center">
                        {snap.previewDataUrl ? (
                          <img
                            src={snap.previewDataUrl}
                            alt={snap.title}
                            className="w-full h-full object-cover"
                          />
                        ) : snap.sampleAssetPath ? (
                          <img
                            src={snap.sampleAssetPath}
                            alt={snap.title}
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <ImageIcon size={18} className="text-slate-500" />
                        )}
                      </div>

                      {/* Info & Title */}
                      <div className="flex-1 min-w-0">
                        {isRenaming ? (
                          <div
                            className="flex items-center gap-1.5"
                            onDoubleClick={(e) => e.stopPropagation()}
                          >
                            <input
                              type="text"
                              value={renameText}
                              onChange={(e) => setRenameText(e.target.value)}
                              className="px-2 py-1 text-xs bg-slate-800 border border-amber-400 rounded text-white focus:outline-none w-full"
                              autoFocus
                            />
                            <button
                              type="button"
                              onClick={() => {
                                if (renameText.trim()) {
                                  onRenameSnapshot(snap.id, renameText.trim());
                                }
                                setRenamingId(null);
                              }}
                              className="p-1 text-amber-400 hover:text-white"
                            >
                              <Check size={15} />
                            </button>
                            <button
                              type="button"
                              onClick={() => setRenamingId(null)}
                              className="p-1 text-slate-400 hover:text-white"
                            >
                              <X size={15} />
                            </button>
                          </div>
                        ) : (
                          <div className="flex items-center gap-1.5">
                            <h4 className="text-xs sm:text-sm font-bold text-slate-200 truncate">
                              {snap.title}
                            </h4>
                            {isActive && (
                              <span className="text-[9px] font-black uppercase px-1.5 py-0.5 rounded bg-amber-400 text-slate-950">
                                Active
                              </span>
                            )}
                            <button
                              type="button"
                              onClick={() => {
                                setRenamingId(snap.id);
                                setRenameText(snap.title);
                              }}
                              onDoubleClick={(e) => e.stopPropagation()}
                              className="text-slate-500 hover:text-slate-300 p-0.5"
                            >
                              <Edit2 size={11} />
                            </button>
                          </div>
                        )}

                        <div className="flex items-center gap-1.5 mt-0.5 text-[11px] text-slate-400 font-medium">
                          <span className="text-amber-400 font-bold">{progressPct}%</span>
                          <span>•</span>
                          <span>
                            {snap.filledCount}/{snap.totalCount} regions
                          </span>
                          {snap.fileSizeBytes && snap.fileSizeBytes > 0 ? (
                            <>
                              <span>•</span>
                              <span>{Math.max(1, Math.round(snap.fileSizeBytes / 1024))} KB</span>
                            </>
                          ) : null}
                        </div>
                      </div>

                      {/* Actions */}
                      <div
                        className="flex items-center gap-1.5 flex-shrink-0"
                        onDoubleClick={(e) => e.stopPropagation()}
                      >
                        {snap.filledCount > 0 && onReplaySnapshot && (
                          <button
                            type="button"
                            onClick={() => {
                              onReplaySnapshot(snap);
                              onClose();
                            }}
                            title="Watch Animated Replay"
                            className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-bold bg-slate-800 hover:bg-slate-700 text-amber-300 border border-amber-400/40 rounded-lg transition-colors shadow active:scale-95 cursor-pointer"
                          >
                            <Play size={12} />
                            <span>Replay</span>
                          </button>
                        )}

                        {onExportSnapshot && (
                          <button
                            type="button"
                            onClick={() => onExportSnapshot(snap.id, snap.title)}
                            title="Export Save File (.capy)"
                            data-testid={`export-save-${snap.id}`}
                            className="p-1.5 text-slate-400 hover:text-amber-400 hover:bg-slate-800 rounded-lg transition-colors cursor-pointer"
                          >
                            <Download size={14} />
                          </button>
                        )}

                        {!isActive && (
                          <button
                            type="button"
                            onClick={() => {
                              onLoadSnapshot(snap);
                              onClose();
                            }}
                            className="px-2.5 py-1 text-xs font-bold bg-amber-400 text-slate-950 rounded-lg hover:bg-amber-300 transition-colors shadow active:scale-95 cursor-pointer"
                          >
                            Load
                          </button>
                        )}

                        {isConfirmDelete ? (
                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() => {
                                onDeleteSnapshot(snap.id);
                                setConfirmDeleteId(null);
                              }}
                              className="px-2 py-1 text-[11px] font-bold bg-red-600 text-white rounded hover:bg-red-500"
                            >
                              Confirm
                            </button>
                            <button
                              type="button"
                              onClick={() => setConfirmDeleteId(null)}
                              className="px-2 py-1 text-[11px] bg-slate-800 text-slate-300 rounded hover:bg-slate-700"
                            >
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setConfirmDeleteId(snap.id)}
                            title="Delete Save"
                            className="p-1 text-slate-500 hover:text-red-400 transition-colors cursor-pointer"
                          >
                            <Trash2 size={15} />
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}

                {snapshots.length === 0 && (
                  <div className="text-center py-8 text-slate-500 text-sm">
                    No saved snapshots yet. Load an image or play a sample to start!
                  </div>
                )}
              </div>

              {/* Bottom Actions */}
              {snapshots.length > 0 && (
                <div className="pt-3 border-t border-slate-800/80 flex justify-between items-center">
                  {confirmClearAll ? (
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-red-400 font-semibold">
                        Delete all saved games?
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          onClearAllSnapshots();
                          setConfirmClearAll(false);
                        }}
                        className="px-2.5 py-1 text-xs font-bold bg-red-600 text-white rounded hover:bg-red-500"
                      >
                        Yes, Delete All
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmClearAll(false)}
                        className="px-2.5 py-1 text-xs bg-slate-800 text-slate-300 rounded hover:bg-slate-700"
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setConfirmClearAll(true)}
                      className="text-xs font-bold text-red-400 hover:text-red-300 transition-colors"
                    >
                      Delete All Saves
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
