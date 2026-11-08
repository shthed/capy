import React, { useState } from 'react';
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
} from 'lucide-react';
import {
  CANVAS_BG_MAP,
  CanvasBgColor,
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
  onRenameSnapshot: (id: string, newTitle: string) => void;
  onDeleteSnapshot: (id: string) => void;
  onClearAllSnapshots: () => void;
  onResetProgress: () => void;
  onRegenerate: (config: GeneratorConfig) => void;
  onSelectSample: (sample: SampleArtwork) => void;
  onUploadImage: () => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  initialTab = 0,
  settings,
  snapshots,
  activeSnapshotId,
  sourceImage,
  isFullscreen,
  onClose,
  onUpdateSettings,
  onToggleFullscreen,
  onLoadSnapshot,
  onRenameSnapshot,
  onDeleteSnapshot,
  onClearAllSnapshots,
  onResetProgress,
  onRegenerate,
  onSelectSample,
  onUploadImage,
}) => {
  const [activeTab, setActiveTab] = useState<number>(initialTab);
  const [localConfig, setLocalConfig] = useState<GeneratorConfig>(settings.generatorConfig);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameText, setRenameText] = useState<string>('');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [confirmClearAll, setConfirmClearAll] = useState(false);

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
    <div className="fixed inset-0 z-50 flex sm:items-center sm:justify-center sm:p-4 md:p-6 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200 select-none">
      <div className="relative w-full h-full sm:h-[88vh] sm:max-h-[860px] sm:max-w-2xl flex flex-col bg-slate-900 sm:border sm:border-slate-800 sm:rounded-2xl shadow-2xl overflow-hidden text-slate-100">
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
                  onClick={() => setActiveTab(tab.id)}
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
                <label className="text-[11px] sm:text-xs font-bold uppercase tracking-wider text-slate-400">
                  Canvas Background
                </label>
                <div className="grid grid-cols-3 sm:grid-cols-5 gap-1.5 sm:gap-2">
                  {(Object.keys(CANVAS_BG_MAP) as CanvasBgColor[]).map((key) => {
                    const item = CANVAS_BG_MAP[key];
                    const isSelected = settings.canvasBgColor === key;
                    return (
                      <button
                        key={key}
                        type="button"
                        onClick={() => {
                          updateSetting('canvasBgColor', key);
                          updateSetting('canvasBgArgb', item.argb);
                        }}
                        className={`flex items-center gap-1.5 p-2 rounded-lg border text-xs font-semibold transition-all ${
                          isSelected
                            ? 'border-amber-400 bg-slate-800 text-white ring-1 ring-amber-400'
                            : 'border-slate-800 bg-slate-950/40 text-slate-400 hover:bg-slate-800/50'
                        }`}
                      >
                        <span
                          className="w-3.5 h-3.5 rounded-full border border-slate-700 flex-shrink-0"
                          style={{ backgroundColor: item.hex }}
                        />
                        <span className="truncate text-[11px] sm:text-xs">{item.label}</span>
                      </button>
                    );
                  })}
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
                      desc: 'Floating zoom buttons above hint trigger',
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
                <div className="grid grid-cols-3 gap-2 sm:gap-3">
                  {SAMPLE_GALLERY.map((sample) => (
                    <div
                      key={sample.id}
                      className="group relative flex flex-col rounded-xl overflow-hidden border border-slate-800 bg-slate-950/60 hover:border-amber-400/60 transition-all shadow-md"
                    >
                      <div className="h-16 sm:h-24 w-full overflow-hidden bg-slate-900">
                        <img
                          src={sample.assetPath}
                          alt={sample.title}
                          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                        />
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
              <div className="flex items-center justify-between gap-2 pb-1">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-slate-400 font-semibold">Sort by:</span>
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

                <button
                  type="button"
                  onClick={onResetProgress}
                  className="flex items-center gap-1.5 text-xs font-bold text-amber-400 hover:text-amber-300 transition-colors"
                >
                  <RotateCcw size={14} />
                  <span>Reset Progress</span>
                </button>
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
                      className={`relative flex items-center gap-2.5 p-2.5 rounded-xl border transition-all ${
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
                          <div className="flex items-center gap-1.5">
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
                        </div>
                      </div>

                      {/* Actions */}
                      <div className="flex items-center gap-1.5 flex-shrink-0">
                        {!isActive && (
                          <button
                            type="button"
                            onClick={() => {
                              onLoadSnapshot(snap);
                              onClose();
                            }}
                            className="px-2.5 py-1 text-xs font-bold bg-amber-400 text-slate-950 rounded-lg hover:bg-amber-300 transition-colors shadow active:scale-95"
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
                            className="p-1 text-slate-500 hover:text-red-400 transition-colors"
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
