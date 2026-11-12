import React, { useState, useEffect, useRef, useMemo } from 'react';
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
  List,
  LayoutGrid,
  Pin,
  AppWindow,
  Search,
  Users,
  Share2,
  Cloud,
  ThumbsUp,
  Lightbulb,
  ZoomIn,
  Copy,
  Printer,
} from 'lucide-react';
import { PwaService } from '../services/PwaService';
import { NativeBridge } from '../services/NativeBridge';
import { APP_VERSION, resolveReleaseChannel } from '../version';
import {
  COLLABORATOR_AVATAR_COLORS,
  ProviderRegistry,
} from '../services/providers/ProviderRegistry';
import { CoopParticipant, PlayerIdentity } from '../services/providers/types';
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
import { getDailyFeaturedPuzzle } from '../services/DailyPuzzleService';
import {
  formatFastestCompletion,
  PlayerLifetimeStats,
  PlayerStatsService,
} from '../services/PlayerStatsService';

interface SettingsModalProps {
  isOpen: boolean;
  initialTab?: number;
  settings: UserSettings;
  lifetimeStats?: PlayerLifetimeStats;
  snapshots: SavedSnapshot[];
  activeSnapshotId: string | null;
  sourceImage?: HTMLImageElement | null;
  isFullscreen?: boolean;
  coopRoomCode?: string | null;
  coopParticipants?: CoopParticipant[];
  canShareActiveLink?: boolean;
  onClose: () => void;
  onUpdateSettings: (newSettings: UserSettings) => void;
  onToggleFullscreen?: () => void;
  onLoadSnapshot: (snapshot: SavedSnapshot) => void;
  onReplaySnapshot?: (snapshot: SavedSnapshot) => void;
  onRenameSnapshot: (id: string, newTitle: string) => void;
  onTogglePinSnapshot?: (id: string) => void;
  onDeleteSnapshot: (id: string) => void;
  onClearAllSnapshots: () => void;
  onResetProgress?: () => void;
  onRegenerate: (config: GeneratorConfig) => void;
  onSelectSample: (sample: SampleArtwork, config?: GeneratorConfig) => void;
  onUploadImage: () => void;
  onExportSnapshot?: (id: string, title: string) => void;
  onExportPrintableSvg?: () => Promise<boolean> | void;
  onExportSnapshotSvg?: (id: string, title: string) => Promise<boolean> | void;
  onExportAllSnapshots?: () => void;
  onImportSnapshots?: (file: File) => void;
  onHostCoopRoom?: () => Promise<string | null>;
  onJoinCoopRoom?: (code: string) => Promise<boolean>;
  onLeaveCoopRoom?: () => void;
  onShareProgressLink?: () => Promise<string | null>;
  onCopyCoopInviteLink?: () => Promise<string | null>;
  onSyncCloudProgress?: () => Promise<{
    addedFromCloud: number;
    syncedAt: number;
    uploadedCount?: number;
    downloadedCount?: number;
    backend?: string;
  } | null>;
  onZoomIntoDetailTile?: () => void;
}

const LAST_SETTINGS_TAB_KEY = 'capy_last_settings_tab';
const GALLERY_FILTER_TAGS = ['All', 'Animals', 'Coloring', 'Nature', 'Line Art', 'Detailed', 'Music'];

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  initialTab,
  settings,
  lifetimeStats,
  snapshots,
  activeSnapshotId,
  sourceImage,
  isFullscreen,
  coopRoomCode,
  coopParticipants = [],
  canShareActiveLink = false,
  onClose,
  onUpdateSettings,
  onToggleFullscreen,
  onLoadSnapshot,
  onReplaySnapshot,
  onRenameSnapshot,
  onTogglePinSnapshot,
  onDeleteSnapshot,
  onClearAllSnapshots,
  onResetProgress,
  onRegenerate,
  onSelectSample,
  onUploadImage,
  onExportSnapshot,
  onExportPrintableSvg,
  onExportSnapshotSvg,
  onExportAllSnapshots,
  onImportSnapshots,
  onHostCoopRoom,
  onJoinCoopRoom,
  onLeaveCoopRoom,
  onShareProgressLink,
  onCopyCoopInviteLink,
  onSyncCloudProgress,
  onZoomIntoDetailTile,
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dailyPuzzle = useMemo(() => getDailyFeaturedPuzzle(), [isOpen]);
  const effectiveStats = useMemo(
    () => lifetimeStats ?? PlayerStatsService.loadStats(),
    [lifetimeStats, isOpen]
  );
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
  const [selectedSaveId, setSelectedSaveId] = useState<string | null>(null);
  const [savesViewMode, setSavesViewMode] = useState<'DETAIL' | 'THUMBNAILS'>(() => {
    try {
      return (
        (localStorage.getItem('capy_saves_view_mode') as 'DETAIL' | 'THUMBNAILS') || 'DETAIL'
      );
    } catch {
      return 'DETAIL';
    }
  });
  const lastTapRef = useRef<{ id: string; time: number }>({ id: '', time: 0 });

  // Gallery Search, Tag Filter Chips & Community Puzzle Ideas state
  const [gallerySearch, setGallerySearch] = useState('');
  const [activeGalleryTag, setActiveGalleryTag] = useState('All');
  const [communityIdeas, setCommunityIdeas] = useState(() =>
    ProviderRegistry.catalog.getCommunityIdeas()
  );
  const [showIdeaForm, setShowIdeaForm] = useState(false);
  const [ideaTitle, setIdeaTitle] = useState('');
  const [ideaPrompt, setIdeaPrompt] = useState('');
  const [ideaCategory, setIdeaCategory] = useState('Animals');
  const [ideaFeedback, setIdeaFeedback] = useState<string | null>(null);
  const [creditLedger, setCreditLedger] = useState(() =>
    ProviderRegistry.monetization.getLedger()
  );

  // Player Profile, Cloud Sync, Share Link & Co-op Room UI state
  const [playerIdentity, setPlayerIdentity] = useState<PlayerIdentity>(() =>
    ProviderRegistry.auth.getCurrentIdentity()
  );
  const [editingProfileName, setEditingProfileName] = useState(false);
  const [profileNameDraft, setProfileNameDraft] = useState(playerIdentity.displayName);
  const [joinCodeInput, setJoinCodeInput] = useState('');
  const [hubNotice, setHubNotice] = useState<string | null>(null);
  const [isSyncingCloud, setIsSyncingCloud] = useState(false);
  const cloudProviders = useMemo(
    () => ProviderRegistry.auth.getAvailableCloudProviders(),
    [playerIdentity]
  );

  useEffect(() => {
    return ProviderRegistry.auth.subscribe((id) => {
      setPlayerIdentity(id);
      setProfileNameDraft(id.displayName);
    });
  }, []);

  const [isInstallable, setIsInstallable] = useState(PwaService.isInstallable);
  const [isStandalone, setIsStandalone] = useState(PwaService.isStandalone);

  useEffect(() => {
    const unsubscribe = PwaService.subscribe(() => {
      setIsInstallable(PwaService.isInstallable);
      setIsStandalone(PwaService.isStandalone);
    });
    return unsubscribe;
  }, []);

  const handleSetViewMode = (mode: 'DETAIL' | 'THUMBNAILS') => {
    setSavesViewMode(mode);
    try {
      localStorage.setItem('capy_saves_view_mode', mode);
    } catch {
      // Ignored
    }
  };

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

  // Close on Escape key (cancel inline rename first if active)
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (renamingId) {
          setRenamingId(null);
          return;
        }
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose, renamingId]);

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

  const updateSettings = (patch: Partial<UserSettings>) => {
    onUpdateSettings({ ...settings, ...patch });
  };

  const updateSetting = <K extends keyof UserSettings>(key: K, value: UserSettings[K]) => {
    onUpdateSettings({ ...settings, [key]: value });
  };

  const tabs = [
    { id: 0, label: 'Settings', icon: Sliders },
    { id: 1, label: 'Hints', icon: Sparkles },
    { id: 2, label: 'Create', icon: RefreshCw },
    { id: 3, label: 'Saves', icon: Save },
  ];

  // Sort snapshots: Pinned saves always stay at the top
  const sortedSnapshots = [...snapshots].sort((a, b) => {
    const aPinned = Boolean(a.isPinned);
    const bPinned = Boolean(b.isPinned);
    if (aPinned !== bPinned) return aPinned ? -1 : 1;

    // Active save pinned next if neither/both are pinned
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

  // Current selected save: prefer explicit user selection, fall back to active snapshot, then first snapshot
  const currentSelectedId =
    selectedSaveId && sortedSnapshots.some((s) => s.id === selectedSaveId)
      ? selectedSaveId
      : activeSnapshotId && sortedSnapshots.some((s) => s.id === activeSnapshotId)
      ? activeSnapshotId
      : sortedSnapshots[0]?.id || null;
  const selectedSave = sortedSnapshots.find((s) => s.id === currentSelectedId);

  // Single-tap to select, double-tap to load & resume
  const handleSaveCardClick = (snap: SavedSnapshot) => {
    const now = Date.now();
    const prev = lastTapRef.current;
    if (prev.id === snap.id && now - prev.time < 350) {
      lastTapRef.current = { id: '', time: 0 };
      if (snap.id !== activeSnapshotId) {
        onLoadSnapshot(snap);
      }
      onClose();
      return;
    }
    lastTapRef.current = { id: snap.id, time: now };
    setSelectedSaveId(snap.id);
  };

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
                          updateSettings({ canvasBgColor: key, canvasBgArgb: item.argb });
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
                        updateSettings({
                          canvasBgColor: 'CUSTOM',
                          canvasBgArgb: hexToArgb(e.target.value),
                        });
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
                      key: 'enableUndo' as const,
                      label: 'Enable Undo Action',
                      desc: 'Show Undo button above palette dock to revert painted regions (Ctrl+Z). Disabled by default, enabled automatically for free colour puzzles',
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
                      key: 'detailedLoadingProgress' as const,
                      label: 'Detailed Generation Progress',
                      desc: 'Show real-time pipeline stages, inspection metrics, and live palette swatches while generating. Off by default for maximum generation speed (Fast Mode)',
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

              {/* Controls: Zoom & Procedural Audio */}
              <div className="space-y-3 p-3 rounded-xl bg-slate-950/40 border border-slate-800/80">
                <div className="flex justify-between items-center text-xs sm:text-sm font-semibold">
                  <span className="text-slate-200">Controls</span>
                </div>

                {/* Zoom Sensitivity */}
                <div className="space-y-1">
                  <div className="flex justify-between items-center text-xs">
                    <span className="text-slate-300">Zoom Sensitivity</span>
                    <span className="text-amber-400 font-mono font-bold">
                      {(settings.zoomSensitivity ?? 1.0).toFixed(1)}x
                    </span>
                  </div>
                  <input
                    type="range"
                    min="0.5"
                    max="2.0"
                    step="0.1"
                    data-testid="setting-zoom-sensitivity"
                    value={settings.zoomSensitivity ?? 1.0}
                    onChange={(e) =>
                      updateSetting(
                        'zoomSensitivity',
                        Math.round(parseFloat(e.target.value) * 10) / 10
                      )
                    }
                    className="w-full accent-amber-400 cursor-pointer h-1.5 bg-slate-800 rounded-lg"
                  />
                  <div className="text-[10px] text-slate-400">
                    Scales wheel, pinch-to-zoom, and one-finger double-tap drag zoom speed
                  </div>
                </div>

                {/* Snap to Zoom Stops */}
                <div className="flex items-center justify-between pt-1.5 border-t border-slate-800/60">
                  <div className="pr-3 min-w-0">
                    <div className="text-xs sm:text-sm font-semibold text-slate-200">
                      Snap to Zoom Stops
                    </div>
                    <div className="text-[11px] text-slate-400 leading-tight">
                      Magnetic detents at 1x, 2x, 4x, 8x, and 12x zoom levels
                    </div>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    data-testid="setting-snap-zoom-levels"
                    aria-checked={Boolean(settings.snapZoomLevels)}
                    onClick={() => updateSetting('snapZoomLevels', !settings.snapZoomLevels)}
                    className={`w-10 h-5.5 flex items-center rounded-full p-0.5 flex-shrink-0 transition-colors cursor-pointer ${
                      settings.snapZoomLevels ? 'bg-amber-500' : 'bg-slate-700'
                    }`}
                  >
                    <div
                      className={`bg-white w-4.5 h-4.5 rounded-full shadow-md transform transition-transform ${
                        settings.snapZoomLevels ? 'translate-x-4.5' : 'translate-x-0'
                      }`}
                    />
                  </button>
                </div>

                {/* Precision Magnifier Loupe */}
                <div className="flex items-center justify-between pt-1.5 border-t border-slate-800/60">
                  <div className="pr-3 min-w-0">
                    <div className="text-xs sm:text-sm font-semibold text-slate-200">
                      Precision Magnifier Loupe
                    </div>
                    <div className="text-[11px] text-slate-400 leading-tight">
                      Floating 2.5x circular lens above press-and-hold and Paint Mode drags
                    </div>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    data-testid="setting-magnifier-loupe"
                    aria-checked={settings.showMagnifierLoupe !== false}
                    onClick={() =>
                      updateSetting('showMagnifierLoupe', !(settings.showMagnifierLoupe !== false))
                    }
                    className={`w-10 h-5.5 flex items-center rounded-full p-0.5 flex-shrink-0 transition-colors cursor-pointer ${
                      settings.showMagnifierLoupe !== false ? 'bg-amber-500' : 'bg-slate-700'
                    }`}
                  >
                    <div
                      className={`bg-white w-4.5 h-4.5 rounded-full shadow-md transform transition-transform ${
                        settings.showMagnifierLoupe !== false ? 'translate-x-4.5' : 'translate-x-0'
                      }`}
                    />
                  </button>
                </div>

                {/* Sound Effects */}
                <div className="flex items-center justify-between pt-1.5 border-t border-slate-800/60">
                  <div className="pr-3 min-w-0">
                    <div className="text-xs sm:text-sm font-semibold text-slate-200">
                      Sound Effects
                    </div>
                    <div className="text-[11px] text-slate-400 leading-tight">
                      Warm procedural woodblock and brush tap audio feedback
                    </div>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    data-testid="setting-sound-enabled"
                    aria-checked={settings.soundEnabled !== false}
                    onClick={() =>
                      updateSetting('soundEnabled', !(settings.soundEnabled !== false))
                    }
                    className={`w-10 h-5.5 flex items-center rounded-full p-0.5 flex-shrink-0 transition-colors cursor-pointer ${
                      settings.soundEnabled !== false ? 'bg-amber-500' : 'bg-slate-700'
                    }`}
                  >
                    <div
                      className={`bg-white w-4.5 h-4.5 rounded-full shadow-md transform transition-transform ${
                        settings.soundEnabled !== false ? 'translate-x-4.5' : 'translate-x-0'
                      }`}
                    />
                  </button>
                </div>

                {/* Sound Volume */}
                <div className="space-y-1 pt-1.5 border-t border-slate-800/60">
                  <div className="flex justify-between items-center text-xs">
                    <span className="text-slate-300">Sound Volume</span>
                    <span className="text-amber-400 font-mono font-bold">
                      {Math.round((settings.soundVolume ?? 0.7) * 100)}%
                    </span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.05"
                    data-testid="setting-sound-volume"
                    value={settings.soundVolume ?? 0.7}
                    onChange={(e) =>
                      updateSetting('soundVolume', Math.round(parseFloat(e.target.value) * 100) / 100)
                    }
                    className="w-full accent-amber-400 cursor-pointer h-1.5 bg-slate-800 rounded-lg"
                  />
                </div>

                {/* Reduced Motion */}
                <div className="flex items-center justify-between pt-1.5 border-t border-slate-800/60">
                  <div className="pr-3 min-w-0">
                    <div className="text-xs sm:text-sm font-semibold text-slate-200">
                      Reduced Motion
                    </div>
                    <div className="text-[11px] text-slate-400 leading-tight">
                      Skips confetti bursts, smooth camera glides, and breathing hint pulses
                    </div>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    data-testid="setting-reduced-motion"
                    aria-checked={Boolean(settings.reducedMotion)}
                    onClick={() => updateSetting('reducedMotion', !settings.reducedMotion)}
                    className={`w-10 h-5.5 flex items-center rounded-full p-0.5 flex-shrink-0 transition-colors cursor-pointer ${
                      settings.reducedMotion ? 'bg-amber-500' : 'bg-slate-700'
                    }`}
                  >
                    <div
                      className={`bg-white w-4.5 h-4.5 rounded-full shadow-md transform transition-transform ${
                        settings.reducedMotion ? 'translate-x-4.5' : 'translate-x-0'
                      }`}
                    />
                  </button>
                </div>
              </div>

              {/* Label Sizing & Constraints */}
              <div className="space-y-3 p-3 rounded-xl bg-slate-950/40 border border-slate-800/80">
                <div className="flex justify-between items-center text-xs sm:text-sm font-semibold">
                  <span className="text-slate-200">Label Sizing & Bounds</span>
                </div>

                {/* Min Size */}
                <div className="space-y-1">
                  <div className="flex justify-between items-center text-xs">
                    <span className="text-slate-300">Minimum Label Size</span>
                    <span className="text-amber-400 font-mono font-bold">
                      {settings.minLabelSize ?? 6} px
                    </span>
                  </div>
                  <input
                    type="range"
                    min="2"
                    max="14"
                    step="1"
                    value={settings.minLabelSize ?? 6}
                    onChange={(e) => {
                      const val = parseInt(e.target.value, 10);
                      const maxVal = settings.maxLabelSize ?? 18;
                      updateSettings(
                        val > maxVal
                          ? { minLabelSize: val, maxLabelSize: val }
                          : { minLabelSize: val }
                      );
                    }}
                    className="w-full accent-amber-400 cursor-pointer h-1.5 bg-slate-800 rounded-lg"
                  />
                  <div className="text-[10px] text-slate-400">
                    Lower values reveal tiny labels on high-resolution displays before zooming
                  </div>
                </div>

                {/* Max Size */}
                <div className="space-y-1">
                  <div className="flex justify-between items-center text-xs">
                    <span className="text-slate-300">Maximum Label Size</span>
                    <span className="text-amber-400 font-mono font-bold">
                      {settings.maxLabelSize ?? 18} px
                    </span>
                  </div>
                  <input
                    type="range"
                    min="10"
                    max="36"
                    step="1"
                    value={settings.maxLabelSize ?? 18}
                    onChange={(e) => {
                      const val = parseInt(e.target.value, 10);
                      const minVal = settings.minLabelSize ?? 6;
                      updateSettings(
                        val < minVal
                          ? { maxLabelSize: val, minLabelSize: val }
                          : { maxLabelSize: val }
                      );
                    }}
                    className="w-full accent-amber-400 cursor-pointer h-1.5 bg-slate-800 rounded-lg"
                  />
                  <div className="text-[10px] text-slate-400">
                    Prevents numbers in large open regions from becoming oversized
                  </div>
                </div>

                {/* Label Scale Slider */}
                <div className="space-y-1">
                  <div className="flex justify-between items-center text-xs">
                    <span className="text-slate-300">Overall Scale</span>
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
                <div className="grid grid-cols-3 sm:grid-cols-6 gap-1.5">
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
                      Replay on Load
                    </div>
                    <div className="text-[11px] text-slate-400">
                      Automatically replay region completion animation when opening a saved puzzle
                    </div>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    data-testid="toggle-auto-replay-btn"
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

                <div className="flex items-center justify-between p-2.5 rounded-xl bg-slate-950/40 border border-slate-800/80">
                  <div className="pr-3">
                    <div className="text-xs sm:text-sm font-bold text-slate-200">
                      Follow Painting During Replay
                    </div>
                    <div className="text-[11px] text-slate-400">
                      Smoothly pan the camera to follow each region being painted without skipping offscreen steps
                    </div>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    data-testid="toggle-replay-follow-btn"
                    aria-checked={Boolean(settings.replayFollow)}
                    onClick={() => updateSetting('replayFollow', !settings.replayFollow)}
                    className={`w-11 h-6 rounded-full transition-colors relative flex-shrink-0 cursor-pointer ${
                      settings.replayFollow ? 'bg-amber-400' : 'bg-slate-700'
                    }`}
                  >
                    <span
                      className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-slate-950 transition-transform ${
                        settings.replayFollow ? 'translate-x-5' : 'translate-x-0'
                      }`}
                    />
                  </button>
                </div>

                <div className="flex items-center justify-between p-2.5 rounded-xl bg-slate-950/40 border border-slate-800/80">
                  <div className="pr-3">
                    <div className="text-xs sm:text-sm font-bold text-slate-200">
                      Auto-Loop Replay
                    </div>
                    <div className="text-[11px] text-slate-400">
                      Automatically restart and loop the replay animation when it finishes
                    </div>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    data-testid="toggle-replay-loop-btn"
                    aria-checked={Boolean(settings.replayLoop)}
                    onClick={() => updateSetting('replayLoop', !settings.replayLoop)}
                    className={`w-11 h-6 rounded-full transition-colors relative flex-shrink-0 cursor-pointer ${
                      settings.replayLoop ? 'bg-amber-400' : 'bg-slate-700'
                    }`}
                  >
                    <span
                      className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-slate-950 transition-transform ${
                        settings.replayLoop ? 'translate-x-5' : 'translate-x-0'
                      }`}
                    />
                  </button>
                </div>
              </div>

              {/* Lifetime Player Statistics (compact 2-column mobile-first grid) */}
              <div
                data-testid="lifetime-stats-card"
                className="p-3 rounded-xl bg-slate-950/50 border border-slate-800/80 space-y-2.5"
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs sm:text-sm font-semibold text-slate-200">
                    Lifetime Stats
                  </span>
                  <span className="text-[10px] font-bold uppercase tracking-wider text-amber-400/90">
                    Local Progress
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="p-2 rounded-lg bg-slate-900/70 border border-slate-800/80">
                    <div className="text-[10px] text-slate-400 font-medium truncate">
                      Regions Colored
                    </div>
                    <div
                      data-testid="stat-total-regions"
                      className="text-sm sm:text-base font-extrabold font-mono text-amber-400 tabular-nums"
                    >
                      {effectiveStats.totalRegionsColored.toLocaleString()}
                    </div>
                  </div>
                  <div className="p-2 rounded-lg bg-slate-900/70 border border-slate-800/80">
                    <div className="text-[10px] text-slate-400 font-medium truncate">
                      Puzzles Completed
                    </div>
                    <div
                      data-testid="stat-puzzles-completed"
                      className="text-sm sm:text-base font-extrabold font-mono text-slate-100 tabular-nums"
                    >
                      {effectiveStats.puzzlesCompleted.toLocaleString()}
                    </div>
                  </div>
                  <div className="p-2 rounded-lg bg-slate-900/70 border border-slate-800/80">
                    <div className="text-[10px] text-slate-400 font-medium truncate">
                      Zero-Hint Clears
                    </div>
                    <div
                      data-testid="stat-zero-hint-puzzles"
                      className="text-sm sm:text-base font-extrabold font-mono text-emerald-400 tabular-nums"
                    >
                      {effectiveStats.zeroHintPuzzles.toLocaleString()}
                    </div>
                  </div>
                  <div className="p-2 rounded-lg bg-slate-900/70 border border-slate-800/80">
                    <div className="text-[10px] text-slate-400 font-medium truncate">
                      Fastest Clear
                    </div>
                    <div
                      data-testid="stat-fastest-completion"
                      className="text-sm sm:text-base font-extrabold font-mono text-sky-300 tabular-nums"
                    >
                      {formatFastestCompletion(effectiveStats.fastestCompletionMs)}
                    </div>
                  </div>
                  <div className="p-2 rounded-lg bg-slate-900/70 border border-slate-800/80">
                    <div className="text-[10px] text-slate-400 font-medium truncate">
                      Free Colour Art
                    </div>
                    <div
                      data-testid="stat-free-color-creations"
                      className="text-sm sm:text-base font-extrabold font-mono text-slate-200 tabular-nums"
                    >
                      {effectiveStats.freeColorCreations.toLocaleString()}
                    </div>
                  </div>
                  <div className="p-2 rounded-lg bg-slate-900/70 border border-slate-800/80">
                    <div className="text-[10px] text-slate-400 font-medium truncate">
                      Co-op Regions
                    </div>
                    <div
                      data-testid="stat-coop-regions"
                      className="text-sm sm:text-base font-extrabold font-mono text-slate-200 tabular-nums"
                    >
                      {effectiveStats.coopRegionsPainted.toLocaleString()}
                    </div>
                  </div>
                </div>
              </div>

              {/* Platform & External Application Links */}
              <div className="pt-3 border-t border-slate-800/80 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                    Platforms & Applications
                  </div>
                  <span
                    data-testid="app-version-badge"
                    className="px-2 py-0.5 rounded-md bg-slate-900 border border-slate-800 text-[10px] font-mono font-bold text-slate-400"
                  >
                    v{APP_VERSION}
                  </span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {NativeBridge.isNative ? (
                    <div className="flex items-center gap-2 p-2.5 rounded-xl bg-slate-950/60 border border-emerald-500/30 text-slate-200 text-xs font-semibold">
                      <Check size={16} className="text-emerald-400 flex-shrink-0" />
                      <div className="min-w-0">
                        <div className="truncate font-bold text-emerald-400">Native Application</div>
                        <div className="text-[10px] text-slate-400 truncate">
                          Running as installed {NativeBridge.platform === 'android' ? 'Android' : 'iOS'} launcher
                        </div>
                      </div>
                    </div>
                  ) : isStandalone ? (
                    <div className="flex items-center gap-2 p-2.5 rounded-xl bg-slate-950/60 border border-emerald-500/30 text-slate-200 text-xs font-semibold">
                      <Check size={16} className="text-emerald-400 flex-shrink-0" />
                      <div className="min-w-0">
                        <div className="truncate font-bold text-emerald-400">Installed Web App</div>
                        <div className="text-[10px] text-slate-400 truncate">Running offline as standalone PWA</div>
                      </div>
                    </div>
                  ) : isInstallable ? (
                    <button
                      type="button"
                      onClick={() => PwaService.promptInstall()}
                      data-testid="pwa-install-btn"
                      className="flex items-center gap-2 p-2.5 rounded-xl bg-slate-950/60 border border-amber-400/50 hover:bg-slate-800/40 text-slate-200 transition-all text-xs font-semibold cursor-pointer text-left"
                    >
                      <AppWindow size={16} className="text-amber-400 flex-shrink-0" />
                      <div className="min-w-0">
                        <div className="truncate font-bold text-amber-300">Install Web App</div>
                        <div className="text-[10px] text-slate-400 truncate">Install on home screen or desktop</div>
                      </div>
                    </button>
                  ) : (
                    <div className="flex items-center gap-2 p-2.5 rounded-xl bg-slate-950/60 border border-slate-800 text-slate-200 text-xs font-semibold">
                      <AppWindow size={16} className="text-slate-400 flex-shrink-0" />
                      <div className="min-w-0">
                        <div className="truncate font-bold text-slate-200">Progressive Web App</div>
                        <div className="text-[10px] text-slate-400 truncate">Install via browser menu for offline play</div>
                      </div>
                    </div>
                  )}

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

                {/* Release Channel Switcher (Stable <-> Beta Opt-In) */}
                {(() => {
                  const channelInfo = resolveReleaseChannel();
                  if (!channelInfo.showChannelSwitcher) return null;
                  const isBeta = channelInfo.channel === 'beta';
                  const isAlpha = channelInfo.channel === 'alpha';
                  const sharesOriginWithBeta =
                    typeof window !== 'undefined' &&
                    channelInfo.betaWebUrl.startsWith(window.location.origin);
                  const statusLabel = isBeta
                    ? `Beta Channel • v${APP_VERSION}`
                    : isAlpha
                      ? `Alpha Preview${channelInfo.prNumber ? ` #${channelInfo.prNumber}` : ''} • v${APP_VERSION}`
                      : channelInfo.channel === 'dev'
                        ? `Local Dev • v${APP_VERSION}`
                        : `Stable Release • v${APP_VERSION}`;
                  const primaryTargetUrl = isBeta ? channelInfo.stableWebUrl : channelInfo.betaWebUrl;
                  const primaryActionLabel = isBeta
                    ? 'Return to Stable Release'
                    : 'Switch to Beta Channel';
                  return (
                    <div
                      data-testid="release-channel-card"
                      data-channel={channelInfo.channel}
                      className="p-3 rounded-xl bg-slate-950/70 border border-slate-800/90 space-y-2"
                    >
                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        <div className="flex items-center gap-1.5 text-xs font-bold text-slate-200">
                          <Sparkles size={14} className="text-violet-400 flex-shrink-0" />
                          <span>Release Channel</span>
                        </div>
                        <span
                          data-testid="release-channel-status"
                          className={`px-2 py-0.5 rounded-full text-[10px] font-extrabold border ${
                            isBeta || isAlpha
                              ? 'bg-violet-950/80 text-violet-200 border-violet-400/50'
                              : 'bg-emerald-950/60 text-emerald-300 border-emerald-500/40'
                          }`}
                        >
                          {statusLabel}
                        </span>
                      </div>
                      <p className="text-[11px] leading-relaxed text-slate-400">
                        {sharesOriginWithBeta
                          ? 'Preview upcoming Sprint features early on the Beta channel before they ship to Production. Stable and Beta on GitHub Pages share browser storage, so your saved puzzles and coloring progress carry over automatically.'
                          : 'Preview upcoming Sprint features early on the Beta channel before they ship to Production.'}
                      </p>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-0.5">
                        <a
                          href={primaryTargetUrl}
                          data-testid="toggle-beta-channel-btn"
                          className={`flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold border transition-all cursor-pointer ${
                            isBeta
                              ? 'bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-200 border-emerald-400/50'
                              : 'bg-violet-500/20 hover:bg-violet-500/30 text-violet-200 border-violet-400/50'
                          }`}
                        >
                          <ExternalLink size={13} className="flex-shrink-0" />
                          <span>{primaryActionLabel}</span>
                        </a>
                        <a
                          href={channelInfo.betaApkUrl}
                          download="capy-beta.apk"
                          data-testid="beta-apk-download-link"
                          className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold bg-slate-900/90 hover:bg-slate-800 text-slate-200 border border-slate-700/80 hover:border-violet-400/50 transition-all cursor-pointer"
                        >
                          <Smartphone size={13} className="text-violet-300 flex-shrink-0" />
                          <span>Beta Android APK</span>
                        </a>
                      </div>
                    </div>
                  );
                })()}
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
                      { key: 'NUMBER_ONLY', label: 'Number Color', desc: 'Highlights matching label text colour' },
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
              {/* Deterministic Offline UTC Puzzle of the Day Hero Card */}
              <div
                data-testid="daily-puzzle-card"
                className="relative overflow-hidden rounded-xl border border-amber-400/40 bg-gradient-to-br from-slate-900 via-slate-950 to-amber-950/25 p-3 sm:p-3.5 shadow-lg"
              >
                <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                  <div className="relative h-24 sm:h-20 sm:w-28 w-full flex-shrink-0 overflow-hidden rounded-lg border border-slate-800 bg-slate-900">
                    <img
                      src={dailyPuzzle.sample.assetPath}
                      alt={dailyPuzzle.sample.title}
                      className="h-full w-full object-cover"
                    />
                  </div>
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="inline-flex items-center gap-1 rounded-full bg-amber-400/15 border border-amber-400/40 px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wider text-amber-300">
                        <Sparkles size={11} />
                        <span>Puzzle of the Day</span>
                      </span>
                      <span
                        data-testid="daily-puzzle-date-badge"
                        className="rounded-full bg-slate-900/90 border border-slate-700/80 px-2 py-0.5 text-[10px] font-mono font-bold text-slate-300"
                      >
                        {dailyPuzzle.utcDate} UTC
                      </span>
                    </div>
                    <div className="text-sm sm:text-base font-extrabold text-slate-100 truncate">
                      {dailyPuzzle.sample.title}
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-slate-300">
                      <span
                        data-testid="daily-puzzle-preset-label"
                        className="font-bold text-amber-300"
                      >
                        {dailyPuzzle.presetLabel}
                      </span>
                      <span className="text-slate-500">•</span>
                      <span className="text-slate-400">{dailyPuzzle.presetDescription}</span>
                    </div>
                  </div>
                  <button
                    type="button"
                    data-testid="daily-puzzle-play-btn"
                    onClick={() => {
                      setLocalConfig(dailyPuzzle.config);
                      updateSetting('generatorConfig', dailyPuzzle.config);
                      onSelectSample(dailyPuzzle.sample, dailyPuzzle.config);
                      onClose();
                    }}
                    className="w-full sm:w-auto flex-shrink-0 inline-flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-lg bg-amber-400 hover:bg-amber-300 text-slate-950 text-xs sm:text-sm font-extrabold shadow-md transition-colors cursor-pointer"
                  >
                    <Play size={14} className="fill-current" />
                    <span>Play Daily</span>
                  </button>
                </div>
              </div>

              {/* Built-in Sample Artwork Gallery with Search & Tag Filter Chips */}
              <div className="space-y-2">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <label className="text-[11px] sm:text-xs font-bold uppercase tracking-wider text-slate-400">
                    Artwork Gallery
                  </label>
                  <div className="relative w-full sm:w-56">
                    <Search
                      size={13}
                      className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none"
                    />
                    <input
                      type="search"
                      data-testid="gallery-search-input"
                      value={gallerySearch}
                      onChange={(e) => setGallerySearch(e.target.value)}
                      placeholder="Search title or tag..."
                      className="w-full pl-8 pr-2.5 py-1.5 rounded-lg bg-slate-950/80 border border-slate-800 text-xs text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-amber-400"
                    />
                  </div>
                </div>

                {/* Tag Filter Chips */}
                <div className="flex flex-wrap gap-1.5" role="group" aria-label="Gallery category filters">
                  {GALLERY_FILTER_TAGS.map((tag) => {
                    const isSelected = activeGalleryTag === tag;
                    return (
                      <button
                        key={tag}
                        type="button"
                        data-testid={`gallery-tag-${tag.toLowerCase().replace(/\s+/g, '-')}`}
                        onClick={() => setActiveGalleryTag(tag)}
                        className={`px-2.5 py-1 rounded-full text-[11px] font-bold border transition-all cursor-pointer ${
                          isSelected
                            ? 'bg-amber-400 text-slate-950 border-amber-300 shadow-xs'
                            : 'bg-slate-950/60 text-slate-300 border-slate-800 hover:border-slate-700'
                        }`}
                      >
                        {tag}
                      </button>
                    );
                  })}
                </div>

                {(() => {
                  const q = gallerySearch.trim().toLowerCase();
                  const filteredGallery = SAMPLE_GALLERY.filter((sample) => {
                    const matchesTag =
                      activeGalleryTag === 'All' ||
                      sample.category.toLowerCase() === activeGalleryTag.toLowerCase() ||
                      Boolean(
                        sample.tags?.some(
                          (t) => t.toLowerCase() === activeGalleryTag.toLowerCase()
                        )
                      );
                    if (!matchesTag) return false;
                    if (!q) return true;
                    return (
                      sample.title.toLowerCase().includes(q) ||
                      sample.category.toLowerCase().includes(q) ||
                      Boolean(sample.tags?.some((t) => t.toLowerCase().includes(q)))
                    );
                  });

                  if (filteredGallery.length === 0) {
                    return (
                      <div
                        data-testid="gallery-empty-state"
                        className="p-4 rounded-xl border border-slate-800 bg-slate-950/50 text-center space-y-2"
                      >
                        <p className="text-xs text-slate-400">
                          No artworks match "{gallerySearch || activeGalleryTag}".
                        </p>
                        <button
                          type="button"
                          onClick={() => {
                            setGallerySearch('');
                            setActiveGalleryTag('All');
                          }}
                          className="px-3 py-1 rounded-lg bg-slate-800 text-amber-300 text-xs font-bold hover:bg-slate-700 cursor-pointer"
                        >
                          Reset Filters
                        </button>
                      </div>
                    );
                  }

                  return (
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-3">
                      {filteredGallery.map((sample) => (
                        <div
                          key={sample.id}
                          data-testid={`gallery-card-${sample.id}`}
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
                              <div className="text-[11px] sm:text-xs font-bold text-slate-200 truncate">
                                {sample.title}
                              </div>
                              <div className="text-[9px] text-slate-400 hidden sm:block">
                                {sample.category}
                              </div>
                            </div>
                            <button
                              type="button"
                              onClick={() => {
                                updateSetting('generatorConfig', localConfig);
                                onSelectSample(sample, localConfig);
                                onClose();
                              }}
                              className="w-full sm:w-auto px-2 py-1 text-[11px] sm:text-xs font-bold bg-amber-400 text-slate-950 rounded-md sm:rounded-lg hover:bg-amber-300 transition-colors shadow text-center cursor-pointer"
                            >
                              Play
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  );
                })()}
              </div>

              {/* Action Row: Upload Photo & Infinite Zoom Detail Sub-Puzzle */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => {
                    onUploadImage();
                    onClose();
                  }}
                  className="w-full flex items-center justify-center gap-2 p-2.5 sm:p-3 rounded-xl border border-amber-400/40 bg-amber-400/10 text-amber-300 hover:bg-amber-400/20 text-xs sm:text-sm font-bold transition-colors cursor-pointer"
                >
                  <ImageIcon size={16} />
                  <span>Choose Photo from Device</span>
                </button>

                {onZoomIntoDetailTile && sourceImage && (
                  <button
                    type="button"
                    data-testid="infinite-zoom-subtile-btn"
                    onClick={() => {
                      onZoomIntoDetailTile();
                      onClose();
                    }}
                    title="Generate a higher-detail 2x zoomed sub-puzzle from the center of your current view"
                    className="w-full flex items-center justify-center gap-2 p-2.5 sm:p-3 rounded-xl border border-sky-400/40 bg-sky-500/10 text-sky-300 hover:bg-sky-500/20 text-xs sm:text-sm font-bold transition-colors cursor-pointer"
                  >
                    <ZoomIn size={16} />
                    <span>Infinite Zoom 2x Detail Tile</span>
                  </button>
                )}
              </div>

              {/* Community Puzzle Ideas & Opt-In AI Generation Credits */}
              <div
                data-testid="community-ideas-section"
                className="p-3 rounded-xl bg-slate-950/65 border border-slate-800 space-y-2.5"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5">
                    <Lightbulb size={15} className="text-amber-400" />
                    <span className="text-xs font-extrabold text-slate-200">
                      Community Puzzle Ideas
                    </span>
                    <span className="px-2 py-0.5 rounded-full bg-slate-800 text-[10px] font-bold text-amber-300">
                      {creditLedger.availableCredits} AI Credits
                    </span>
                  </div>

                  <div className="flex items-center gap-1.5">
                    {!creditLedger.adFreePlatform && (
                      <button
                        type="button"
                        onClick={async () => {
                          const res = await ProviderRegistry.monetization.watchRewardedAdForCredits();
                          setCreditLedger(res.ledger);
                          setIdeaFeedback(
                            res.granted > 0
                              ? `+${res.granted} AI Credits added!`
                              : 'Rewarded ads are optional and only active on Play Store builds.'
                          );
                        }}
                        className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-[11px] font-semibold border border-slate-700 cursor-pointer"
                      >
                        Optional Ad (+2)
                      </button>
                    )}
                    <button
                      type="button"
                      data-testid="toggle-idea-form-btn"
                      onClick={() => {
                        setShowIdeaForm((v) => !v);
                        setIdeaFeedback(null);
                      }}
                      className="px-2.5 py-1 rounded-lg bg-amber-400 text-slate-950 text-[11px] font-extrabold hover:bg-amber-300 transition-colors cursor-pointer"
                    >
                      {showIdeaForm ? 'Close' : '+ Submit Idea'}
                    </button>
                  </div>
                </div>

                {ideaFeedback && (
                  <div
                    data-testid="idea-feedback-banner"
                    className="px-2.5 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-[11px] text-amber-300 font-semibold"
                  >
                    {ideaFeedback}
                  </div>
                )}

                {showIdeaForm && (
                  <div className="p-2.5 rounded-lg bg-slate-900/90 border border-slate-800 space-y-2">
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                      <input
                        type="text"
                        data-testid="idea-title-input"
                        value={ideaTitle}
                        onChange={(e) => setIdeaTitle(e.target.value)}
                        placeholder="Idea title (e.g. Lantern Capybara)"
                        maxLength={60}
                        className="sm:col-span-2 px-2.5 py-1.5 rounded-lg bg-slate-950 border border-slate-700 text-xs text-slate-100 focus:outline-none focus:border-amber-400"
                      />
                      <select
                        value={ideaCategory}
                        onChange={(e) => setIdeaCategory(e.target.value)}
                        className="px-2.5 py-1.5 rounded-lg bg-slate-950 border border-slate-700 text-xs text-slate-200 focus:outline-none"
                      >
                        <option value="Animals">Animals</option>
                        <option value="Nature">Nature</option>
                        <option value="Coloring">Coloring</option>
                        <option value="Music">Music</option>
                      </select>
                    </div>
                    <textarea
                      data-testid="idea-prompt-input"
                      value={ideaPrompt}
                      onChange={(e) => setIdeaPrompt(e.target.value)}
                      placeholder="Describe colors, mood, or style for automated gallery artwork generation..."
                      rows={2}
                      maxLength={280}
                      className="w-full px-2.5 py-1.5 rounded-lg bg-slate-950 border border-slate-700 text-xs text-slate-100 focus:outline-none focus:border-amber-400 resize-none"
                    />
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[10px] text-slate-400">
                        Top-voted family-friendly ideas are queued for gallery generation.
                      </span>
                      <button
                        type="button"
                        data-testid="submit-idea-btn"
                        onClick={() => {
                          const res = ProviderRegistry.catalog.submitCommunityIdea({
                            title: ideaTitle,
                            prompt: ideaPrompt,
                            category: ideaCategory,
                            author: playerIdentity,
                          });
                          if (!res.ok) {
                            setIdeaFeedback(res.error);
                            return;
                          }
                          setCommunityIdeas(ProviderRegistry.catalog.getCommunityIdeas());
                          setIdeaTitle('');
                          setIdeaPrompt('');
                          setShowIdeaForm(false);
                          setIdeaFeedback('Idea submitted to the community gallery queue!');
                        }}
                        className="px-3 py-1.5 rounded-lg bg-amber-400 text-slate-950 text-xs font-extrabold hover:bg-amber-300 cursor-pointer"
                      >
                        Post Idea
                      </button>
                    </div>
                  </div>
                )}

                <div className="space-y-1.5 max-h-40 overflow-y-auto pr-0.5">
                  {communityIdeas.slice(0, 5).map((idea) => (
                    <div
                      key={idea.id}
                      data-testid={`community-idea-${idea.id}`}
                      className="flex items-center justify-between gap-2 p-2 rounded-lg bg-slate-900/70 border border-slate-800/90"
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs font-bold text-slate-200 truncate">
                            {idea.title}
                          </span>
                          <span className="px-1.5 py-0.5 rounded bg-slate-800 text-[9px] font-bold text-slate-400">
                            {idea.category}
                          </span>
                        </div>
                        <p className="text-[10px] text-slate-400 truncate">{idea.prompt}</p>
                      </div>
                      <button
                        type="button"
                        data-testid={`vote-idea-${idea.id}`}
                        onClick={() =>
                          setCommunityIdeas(ProviderRegistry.catalog.toggleVoteIdea(idea.id))
                        }
                        className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-bold border flex-shrink-0 transition-colors cursor-pointer ${
                          idea.votedByMe
                            ? 'bg-amber-400/20 text-amber-300 border-amber-400/50'
                            : 'bg-slate-800 text-slate-300 border-slate-700 hover:bg-slate-700'
                        }`}
                      >
                        <ThumbsUp size={11} />
                        <span>{idea.votes}</span>
                      </button>
                    </div>
                  ))}
                </div>
              </div>

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
              {/* Hidden file input for Import */}
              <input
                ref={fileInputRef}
                type="file"
                accept=".capy,.json,application/json,application/octet-stream"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file && onImportSnapshots) {
                    onImportSnapshots(file);
                  }
                  if (e.target) e.target.value = '';
                }}
              />

              {/* Cloud Sync, Shareable Link & Live Simultaneous Co-op Hub */}
              <div
                data-testid="cloud-coop-hub"
                className="p-3 rounded-xl bg-slate-950/75 border border-slate-800 space-y-3"
              >
                {/* Row A: Player Identity, Modular Cloud Providers (Google / Steam / Microsoft / Apple) & CRDT Cloud Sync */}
                <div className="flex flex-wrap items-center justify-between gap-2 pb-2.5 border-b border-slate-800/80">
                  <div className="flex items-center gap-2 min-w-0">
                    {playerIdentity.avatarUrl ? (
                      <img
                        src={playerIdentity.avatarUrl}
                        alt={playerIdentity.displayName}
                        className="w-7 h-7 rounded-full ring-2 ring-emerald-500/60 flex-shrink-0 object-cover"
                        referrerPolicy="no-referrer"
                      />
                    ) : (
                      <button
                        type="button"
                        title="Cycle Avatar Color"
                        onClick={() => {
                          const idx = COLLABORATOR_AVATAR_COLORS.indexOf(
                            playerIdentity.avatarColorHex
                          );
                          const nextColor =
                            COLLABORATOR_AVATAR_COLORS[
                              (idx + 1) % COLLABORATOR_AVATAR_COLORS.length
                            ];
                          ProviderRegistry.auth.updateGuestProfile(
                            playerIdentity.displayName,
                            nextColor
                          );
                        }}
                        className="w-6 h-6 rounded-full ring-2 ring-slate-700 flex-shrink-0 cursor-pointer"
                        style={{ backgroundColor: playerIdentity.avatarColorHex }}
                      />
                    )}
                    {editingProfileName ? (
                      <div className="flex items-center gap-1">
                        <input
                          type="text"
                          value={profileNameDraft}
                          onChange={(e) => setProfileNameDraft(e.target.value)}
                          maxLength={24}
                          className="px-2 py-0.5 rounded bg-slate-900 border border-amber-400 text-xs text-white w-32 focus:outline-none"
                        />
                        <button
                          type="button"
                          onClick={() => {
                            ProviderRegistry.auth.updateGuestProfile(profileNameDraft);
                            setEditingProfileName(false);
                          }}
                          className="px-2 py-0.5 rounded bg-amber-400 text-slate-950 text-[11px] font-bold cursor-pointer"
                        >
                          Save
                        </button>
                      </div>
                    ) : (
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs font-extrabold text-slate-100 truncate">
                            {playerIdentity.displayName}
                          </span>
                          <button
                            type="button"
                            onClick={() => setEditingProfileName(true)}
                            title="Edit Display Name"
                            className="text-slate-400 hover:text-amber-300 cursor-pointer"
                          >
                            <Edit2 size={11} />
                          </button>
                        </div>
                        <div className="text-[10px] text-slate-400 truncate">
                          {playerIdentity.isAuthenticated
                            ? `${
                                playerIdentity.provider === 'play_games_v2'
                                  ? 'Google Play Games'
                                  : 'Google Account'
                              } • ${playerIdentity.email || playerIdentity.displayName}`
                            : NativeBridge.isAndroid ||
                                Boolean(ProviderRegistry.auth.getGoogleClientId()) ||
                                (typeof window !== 'undefined' &&
                                  Boolean(
                                    (window as unknown as { __capyMockGoogleOAuthToken?: string })
                                      .__capyMockGoogleOAuthToken
                                  ))
                              ? 'Local Profile • Sign in to sync saves across devices'
                              : 'Local Profile • Saves stored locally on this device'}
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="flex flex-wrap items-center gap-1.5">
                    {playerIdentity.isAuthenticated ? (
                      <button
                        type="button"
                        data-testid="play-games-signout-btn"
                        onClick={async () => {
                          await ProviderRegistry.auth.signOut();
                          setHubNotice('Signed out of cloud profile.');
                        }}
                        className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-[11px] font-semibold border border-slate-700 cursor-pointer"
                      >
                        Sign Out
                      </button>
                    ) : NativeBridge.isAndroid ||
                      Boolean(ProviderRegistry.auth.getGoogleClientId()) ||
                      (typeof window !== 'undefined' &&
                        Boolean(
                          (window as unknown as { __capyMockGoogleOAuthToken?: string })
                            .__capyMockGoogleOAuthToken
                        )) ? (
                      <button
                        type="button"
                        data-testid="play-games-signin-btn"
                        disabled={isSyncingCloud}
                        onClick={async () => {
                          try {
                            setIsSyncingCloud(true);
                            const signedIn = await ProviderRegistry.auth.signInWithPlayGames();
                            const syncRes = onSyncCloudProgress
                              ? await onSyncCloudProgress()
                              : null;
                            const syncDetail =
                              syncRes &&
                              ((syncRes.downloadedCount || 0) > 0 ||
                                (syncRes.uploadedCount || 0) > 0 ||
                                syncRes.addedFromCloud > 0)
                                ? ` (${syncRes.downloadedCount || 0} pulled, ${syncRes.uploadedCount || 0} pushed)`
                                : '';
                            setHubNotice(
                              `Signed in with ${
                                signedIn.provider === 'play_games_v2' ? 'Play Games' : 'Google'
                              } as ${signedIn.displayName}${
                                signedIn.email ? ` (${signedIn.email})` : ''
                              }! Cloud saves synced${syncDetail}.`
                            );
                          } catch (err) {
                            const msg = err instanceof Error ? err.message : String(err);
                            if (
                              msg === 'GOOGLE_CLIENT_ID_REQUIRED' ||
                              msg === 'PLAY_GAMES_UNCONFIGURED'
                            ) {
                              setHubNotice(
                                'Google Cloud Sign-In requires VITE_GOOGLE_CLIENT_ID (Web) or CAPY_PLAY_GAMES_APP_ID (Android) configured in repository build variables — see CLOUD.md.'
                              );
                            } else {
                              setHubNotice(`Google Sign-In failed: ${msg}`);
                            }
                          } finally {
                            setIsSyncingCloud(false);
                          }
                        }}
                        className="px-2.5 py-1 rounded-lg bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-300 text-[11px] font-bold border border-emerald-500/40 cursor-pointer"
                      >
                        {NativeBridge.isAndroid ? 'Play Games Login' : 'Google Login'}
                      </button>
                    ) : null}

                    {onSyncCloudProgress && (
                      <button
                        type="button"
                        data-testid="cloud-sync-btn"
                        disabled={isSyncingCloud}
                        onClick={async () => {
                          setIsSyncingCloud(true);
                          try {
                            const res = await onSyncCloudProgress();
                            if (res) {
                              const parts: string[] = [];
                              if (res.addedFromCloud > 0) {
                                parts.push(`+${res.addedFromCloud} regions merged`);
                              }
                              if ((res.downloadedCount || 0) > 0) {
                                parts.push(`${res.downloadedCount} saves pulled`);
                              }
                              if ((res.uploadedCount || 0) > 0) {
                                parts.push(`${res.uploadedCount} saves pushed`);
                              }
                              setHubNotice(
                                parts.length > 0
                                  ? `Cloud Sync complete (${parts.join(', ')})!`
                                  : `Cloud Sync up to date (${ProviderRegistry.cloudSave.providerName})!`
                              );
                            }
                          } finally {
                            setIsSyncingCloud(false);
                          }
                        }}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-sky-500/15 hover:bg-sky-500/25 text-sky-300 text-[11px] font-bold border border-sky-400/40 cursor-pointer"
                      >
                        <Cloud size={12} />
                        <span>{isSyncingCloud ? 'Syncing...' : 'Cloud Sync'}</span>
                      </button>
                    )}
                  </div>
                </div>

                {/* Modular Multi-Platform Cloud Provider Status Row (Google Active + Steam / Microsoft / Apple) */}
                <div
                  data-testid="cloud-providers-bar"
                  className="flex flex-wrap items-center justify-between gap-1.5 text-[10px] text-slate-400 pb-2 border-b border-slate-800/60"
                >
                  <span className="font-semibold text-slate-300">
                    Cloud Backend: {ProviderRegistry.cloudSave.providerName}
                  </span>
                  <div className="flex flex-wrap items-center gap-1">
                    {cloudProviders
                      .filter((p) => p.id !== 'play_games_v2' || NativeBridge.isAndroid)
                      .map((prov) => {
                        const isCurrent =
                          playerIdentity.isAuthenticated && playerIdentity.provider === prov.id;
                        return (
                          <span
                            key={prov.id}
                            data-testid={`cloud-provider-badge-${prov.id}`}
                            title={prov.storageName}
                            className={`px-1.5 py-0.5 rounded border text-[9px] font-bold ${
                              isCurrent
                                ? 'bg-emerald-500/20 border-emerald-500/50 text-emerald-300'
                                : prov.isSupported
                                  ? 'bg-slate-900 border-slate-700 text-slate-200'
                                  : 'bg-slate-900/50 border-slate-800/80 text-slate-500'
                            }`}
                          >
                            {prov.displayName}
                            {isCurrent ? ' • Connected' : prov.comingSoon ? ' • Soon' : ''}
                          </span>
                        );
                      })}
                  </div>
                </div>

                {/* Row B: Shareable Game Link & Simultaneous Co-op Room */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-1.5">
                    {onShareProgressLink && (
                      <button
                        type="button"
                        data-testid="share-progress-link-btn"
                        disabled={!canShareActiveLink}
                        onClick={async () => {
                          const url = await onShareProgressLink();
                          if (url) {
                            setHubNotice('Shareable progress link copied (<2 KB URL token)!');
                          }
                        }}
                        title={
                          canShareActiveLink
                            ? 'Copy or share a compact URL link with your current puzzle progress'
                            : 'Shareable URL links work with Gallery/Sample puzzles (use Export .capy for private custom photos)'
                        }
                        className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-bold border transition-colors ${
                          canShareActiveLink
                            ? 'bg-amber-400/15 hover:bg-amber-400/25 text-amber-300 border-amber-400/40 cursor-pointer'
                            : 'bg-slate-900 text-slate-500 border-slate-800 cursor-not-allowed'
                        }`}
                      >
                        <Share2 size={13} />
                        <span>Share Progress Link</span>
                      </button>
                    )}

                    {onExportPrintableSvg && (
                      <button
                        type="button"
                        data-testid="export-printable-svg-btn"
                        onClick={async () => {
                          const ok = await onExportPrintableSvg();
                          if (ok) {
                            setHubNotice('Printable vector coloring sheet (.svg) exported!');
                          }
                        }}
                        title="Export active puzzle as a print-ready monochrome vector SVG coloring sheet"
                        className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-bold bg-slate-800 hover:bg-slate-700 text-slate-100 border border-slate-700 transition-colors cursor-pointer"
                      >
                        <Printer size={13} className="text-amber-400" />
                        <span>Printable SVG</span>
                      </button>
                    )}
                  </div>

                  {/* Co-op Room Controls */}
                  {coopRoomCode ? (
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span
                        data-testid="active-coop-room-code"
                        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-emerald-950/90 border border-emerald-500/50 text-emerald-300 text-xs font-extrabold"
                      >
                        <Users size={12} />
                        <span>Room {coopRoomCode}</span>
                        <span className="text-[10px] text-emerald-400/90">
                          ({coopParticipants.length} online)
                        </span>
                      </span>

                      {onCopyCoopInviteLink && (
                        <button
                          type="button"
                          data-testid="copy-coop-invite-btn"
                          onClick={async () => {
                            const url = await onCopyCoopInviteLink();
                            if (url) {
                              setHubNotice(`Co-op room ${coopRoomCode} invite link copied!`);
                            }
                          }}
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold border border-slate-700 cursor-pointer"
                        >
                          <Copy size={12} />
                          <span>Copy Invite</span>
                        </button>
                      )}

                      {onLeaveCoopRoom && (
                        <button
                          type="button"
                          data-testid="leave-coop-room-btn"
                          onClick={() => {
                            onLeaveCoopRoom();
                            setHubNotice('Left Co-op room.');
                          }}
                          className="px-2.5 py-1 rounded-lg bg-red-950/50 hover:bg-red-900/60 text-red-300 text-xs font-semibold border border-red-500/40 cursor-pointer"
                        >
                          Leave
                        </button>
                      )}
                    </div>
                  ) : (
                    <div className="flex flex-wrap items-center gap-1.5">
                      {onHostCoopRoom && (
                        <button
                          type="button"
                          data-testid="host-coop-room-btn"
                          onClick={async () => {
                            const code = await onHostCoopRoom();
                            if (code) {
                              setHubNotice(
                                `Live Co-op Room ${code} active! Open another tab or share invite to paint together.`
                              );
                            }
                          }}
                          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-300 text-xs font-bold border border-emerald-500/40 cursor-pointer"
                        >
                          <Users size={13} />
                          <span>Host Co-op Room</span>
                        </button>
                      )}

                      {onJoinCoopRoom && (
                        <div className="flex items-center gap-1">
                          <input
                            type="text"
                            data-testid="join-coop-room-input"
                            value={joinCodeInput}
                            onChange={(e) => setJoinCodeInput(e.target.value.toUpperCase())}
                            placeholder="ROOM6"
                            maxLength={8}
                            className="w-20 px-2 py-1 rounded-lg bg-slate-900 border border-slate-700 text-xs font-mono uppercase text-slate-100 focus:outline-none focus:border-emerald-400"
                          />
                          <button
                            type="button"
                            data-testid="join-coop-room-btn"
                            onClick={async () => {
                              if (!joinCodeInput.trim()) return;
                              const ok = await onJoinCoopRoom(joinCodeInput.trim());
                              if (ok) {
                                setHubNotice(`Joined Co-op Room ${joinCodeInput.trim().toUpperCase()}!`);
                                setJoinCodeInput('');
                              }
                            }}
                            className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold border border-slate-700 cursor-pointer"
                          >
                            Join
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {coopRoomCode && coopParticipants.length > 0 && (
                  <div className="flex flex-wrap items-center gap-1.5 pt-1">
                    {coopParticipants.map((peer) => (
                      <span
                        key={peer.playerId}
                        className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-slate-900 border border-slate-800 text-[10px] font-bold text-slate-300"
                      >
                        <span
                          className="w-2 h-2 rounded-full"
                          style={{ backgroundColor: peer.avatarColorHex }}
                        />
                        <span>{peer.displayName}</span>
                      </span>
                    ))}
                  </div>
                )}

                {hubNotice && (
                  <div
                    data-testid="cloud-coop-notice"
                    className="px-2.5 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-[11px] font-semibold text-amber-300"
                  >
                    {hubNotice}
                  </div>
                )}
              </div>

              {/* Combined Single Region: Always Shown at the Top of the Page */}
              <div className="sticky -top-3.5 sm:-top-5 z-20 bg-slate-900/95 backdrop-blur-md pt-0.5 pb-2 -mt-1">
                <div
                  data-testid="selected-save-action-bar"
                  className="p-2.5 sm:p-3 rounded-xl bg-slate-950/85 border border-slate-800 shadow-md space-y-2.5"
                >
                  {/* Row 1: Options & View Mode Switcher */}
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2 sm:gap-2.5">
                      <select
                        value={settings.saveSortOrder}
                        onChange={(e) =>
                          updateSetting('saveSortOrder', e.target.value as SaveSortOrder)
                        }
                        className="bg-slate-800 text-slate-200 text-xs font-semibold rounded-lg px-2.5 py-1.5 border border-slate-700 focus:outline-none cursor-pointer"
                      >
                        <option value="LAST_ACTIVE">Last Active</option>
                        <option value="DATE">Date Created</option>
                        <option value="PERCENT_COMPLETE">Completion</option>
                      </select>

                      <div className="flex items-center gap-1.5">
                        <span className="text-xs font-semibold text-slate-300">Replay on Load</span>
                        <button
                          type="button"
                          role="switch"
                          data-testid="toggle-auto-replay-saves-btn"
                          aria-checked={settings.autoReplayOnLoad !== false}
                          onClick={() =>
                            updateSetting('autoReplayOnLoad', !(settings.autoReplayOnLoad !== false))
                          }
                          className={`w-9 h-5 rounded-full transition-colors relative flex-shrink-0 cursor-pointer ${
                            settings.autoReplayOnLoad !== false ? 'bg-amber-400' : 'bg-slate-700'
                          }`}
                        >
                          <span
                            className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-slate-950 transition-transform ${
                              settings.autoReplayOnLoad !== false ? 'translate-x-4' : 'translate-x-0'
                            }`}
                          />
                        </button>
                      </div>
                    </div>

                    {/* Detail vs Thumbnails View Mode Toggle */}
                    <div className="flex items-center bg-slate-900 p-0.5 rounded-lg border border-slate-800">
                      <button
                        type="button"
                        data-testid="saves-view-detail-btn"
                        onClick={() => handleSetViewMode('DETAIL')}
                        title="Detail List View"
                        className={`flex items-center gap-1 px-2.5 py-1 text-xs font-semibold rounded-md transition-colors cursor-pointer ${
                          savesViewMode === 'DETAIL'
                            ? 'bg-amber-400 text-slate-950 font-bold shadow-xs'
                            : 'text-slate-400 hover:text-slate-200'
                        }`}
                      >
                        <List size={13} />
                        <span>Detail</span>
                      </button>
                      <button
                        type="button"
                        data-testid="saves-view-thumbnails-btn"
                        onClick={() => handleSetViewMode('THUMBNAILS')}
                        title="Thumbnails Grid View"
                        className={`flex items-center gap-1 px-2.5 py-1 text-xs font-semibold rounded-md transition-colors cursor-pointer ${
                          savesViewMode === 'THUMBNAILS'
                            ? 'bg-amber-400 text-slate-950 font-bold shadow-xs'
                            : 'text-slate-400 hover:text-slate-200'
                        }`}
                      >
                        <LayoutGrid size={13} />
                        <span>Thumbnails</span>
                      </button>
                    </div>
                  </div>

                  {/* Row 2: Selected Save Action Toolbar (when a save is selected) */}
                  {selectedSave && (
                    <div className="pt-2 border-t border-slate-800/80">
                      {renamingId === selectedSave.id ? (
                        /* Inline Rename Form */
                        <div className="flex items-center gap-1.5 w-full">
                          <input
                            type="text"
                            value={renameText}
                            onChange={(e) => setRenameText(e.target.value)}
                            className="px-2.5 py-1.5 text-xs bg-slate-800 border border-amber-400 rounded-lg text-white focus:outline-none flex-1 min-w-0"
                            autoFocus
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                if (renameText.trim()) onRenameSnapshot(selectedSave.id, renameText.trim());
                                setRenamingId(null);
                              } else if (e.key === 'Escape') {
                                e.stopPropagation();
                                setRenamingId(null);
                              }
                            }}
                          />
                          <button
                            type="button"
                            data-testid="confirm-rename-btn"
                            onClick={() => {
                              if (renameText.trim()) onRenameSnapshot(selectedSave.id, renameText.trim());
                              setRenamingId(null);
                            }}
                            className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-bold bg-amber-400 text-slate-950 rounded-lg hover:bg-amber-300 transition-colors shadow active:scale-95 cursor-pointer"
                            title="Save Name"
                          >
                            <Check size={13} />
                            <span>Save</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => setRenamingId(null)}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold bg-slate-800 text-slate-300 hover:text-white rounded-lg transition-colors cursor-pointer"
                            title="Cancel Rename"
                          >
                            <X size={13} />
                            <span>Cancel</span>
                          </button>
                        </div>
                      ) : (
                        <div className="flex flex-wrap items-center gap-1.5">
                          {/* Pin / Unpin */}
                          {onTogglePinSnapshot && (
                            <button
                              type="button"
                              data-testid="save-action-pin"
                              onClick={() => onTogglePinSnapshot(selectedSave.id)}
                              title={selectedSave.isPinned ? 'Unpin Save from Top' : 'Pin Save to Top'}
                              className={`inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold rounded-lg border transition-colors shadow active:scale-95 cursor-pointer ${
                                selectedSave.isPinned
                                  ? 'bg-amber-400/20 text-amber-300 border-amber-400/60'
                                  : 'bg-slate-800 hover:bg-slate-700 text-slate-300 border-slate-700'
                              }`}
                            >
                              <Pin size={12} className={selectedSave.isPinned ? 'fill-current rotate-45' : ''} />
                              <span>{selectedSave.isPinned ? 'Unpin' : 'Pin'}</span>
                            </button>
                          )}

                          {/* Load / Resume */}
                          <button
                            type="button"
                            data-testid="save-action-load"
                            onClick={() => {
                              if (selectedSave.id !== activeSnapshotId) {
                                onLoadSnapshot(selectedSave);
                              }
                              onClose();
                            }}
                            title={
                              selectedSave.id === activeSnapshotId
                                ? 'Resume Current Game'
                                : 'Load Selected Save'
                            }
                            className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-bold bg-amber-400 text-slate-950 rounded-lg hover:bg-amber-300 transition-colors shadow active:scale-95 cursor-pointer"
                          >
                            <Play size={12} fill="currentColor" />
                            <span>{selectedSave.id === activeSnapshotId ? 'Resume' : 'Load'}</span>
                          </button>

                          {/* Replay */}
                          {onReplaySnapshot && (
                            <button
                              type="button"
                              data-testid="save-action-replay"
                              disabled={selectedSave.filledCount === 0}
                              onClick={() => {
                                if (selectedSave.filledCount > 0) {
                                  onReplaySnapshot(selectedSave);
                                  onClose();
                                }
                              }}
                              title={
                                selectedSave.filledCount === 0
                                  ? 'No regions filled to replay'
                                  : 'Watch Animated Replay'
                              }
                              className={`inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-bold rounded-lg border transition-colors shadow active:scale-95 ${
                                selectedSave.filledCount === 0
                                  ? 'bg-slate-900 text-slate-600 border-slate-800 cursor-not-allowed opacity-50'
                                  : 'bg-slate-800 hover:bg-slate-700 text-amber-300 border-amber-400/40 cursor-pointer'
                              }`}
                            >
                              <Play size={12} />
                              <span>Replay</span>
                            </button>
                          )}

                          {/* Rename */}
                          <button
                            type="button"
                            data-testid="save-action-rename"
                            onClick={() => {
                              setRenamingId(selectedSave.id);
                              setRenameText(selectedSave.title);
                            }}
                            title="Rename Save"
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded-lg transition-colors shadow active:scale-95 cursor-pointer"
                          >
                            <Edit2 size={12} />
                            <span>Rename</span>
                          </button>

                          {/* Export */}
                          {onExportSnapshot && (
                            <button
                              type="button"
                              data-testid="save-action-export"
                              onClick={() => onExportSnapshot(selectedSave.id, selectedSave.title)}
                              title="Export Save File (.capy)"
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded-lg transition-colors shadow active:scale-95 cursor-pointer"
                            >
                              <Download size={12} />
                              <span>Export</span>
                            </button>
                          )}

                          {/* Printable SVG Coloring Sheet */}
                          {onExportSnapshotSvg && (
                            <button
                              type="button"
                              data-testid="save-action-export-svg"
                              onClick={() =>
                                void onExportSnapshotSvg(selectedSave.id, selectedSave.title)
                              }
                              title="Export Printable Vector Coloring Sheet (.svg)"
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded-lg transition-colors shadow active:scale-95 cursor-pointer"
                            >
                              <Printer size={12} className="text-amber-400" />
                              <span>SVG Sheet</span>
                            </button>
                          )}

                          {/* Delete */}
                          {confirmDeleteId === selectedSave.id ? (
                            <div className="flex items-center gap-1">
                              <button
                                type="button"
                                data-testid="save-action-confirm-delete"
                                onClick={() => {
                                  onDeleteSnapshot(selectedSave.id);
                                  setConfirmDeleteId(null);
                                }}
                                className="px-2.5 py-1.5 text-[11px] font-bold bg-red-600 text-white rounded-lg hover:bg-red-500 cursor-pointer"
                              >
                                Confirm
                              </button>
                              <button
                                type="button"
                                onClick={() => setConfirmDeleteId(null)}
                                className="px-2.5 py-1.5 text-[11px] bg-slate-800 text-slate-300 rounded-lg hover:bg-slate-700 cursor-pointer"
                              >
                                Cancel
                              </button>
                            </div>
                          ) : (
                            <button
                              type="button"
                              data-testid="save-action-delete"
                              onClick={() => setConfirmDeleteId(selectedSave.id)}
                              title="Delete Save"
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold bg-slate-800 hover:bg-red-950/40 text-slate-300 hover:text-red-400 border border-slate-700 hover:border-red-500/40 rounded-lg transition-colors shadow active:scale-95 cursor-pointer"
                            >
                              <Trash2 size={12} />
                              <span>Delete</span>
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Row 3: Global Library Actions (Import, Export All, Delete All Saves) */}
                  <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-800/80">
                    <div className="flex items-center gap-2">
                      {onImportSnapshots && (
                        <button
                          type="button"
                          onClick={() => fileInputRef.current?.click()}
                          title="Import Save (.capy / .json)"
                          data-testid="import-save-btn"
                          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition-colors shadow active:scale-95 cursor-pointer"
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
                          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition-colors shadow active:scale-95 cursor-pointer"
                        >
                          <Download size={13} className="text-amber-400" />
                          <span>Export All</span>
                        </button>
                      )}

                      {onResetProgress && (
                        <button
                          type="button"
                          onClick={onResetProgress}
                          title="Reset Current Puzzle Progress"
                          data-testid="reset-progress-btn"
                          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-amber-300 border border-slate-700 transition-colors shadow active:scale-95 cursor-pointer"
                        >
                          <RotateCcw size={13} className="text-amber-400" />
                          <span>Reset Progress</span>
                        </button>
                      )}
                    </div>

                    {snapshots.length > 0 && (
                      <div>
                        {confirmClearAll ? (
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-red-400 font-semibold">
                              Delete all?
                            </span>
                            <button
                              type="button"
                              onClick={() => {
                                onClearAllSnapshots();
                                setConfirmClearAll(false);
                              }}
                              className="px-2 py-1 text-xs font-bold bg-red-600 text-white rounded-lg hover:bg-red-500 cursor-pointer"
                            >
                              Yes, Delete All
                            </button>
                            <button
                              type="button"
                              onClick={() => setConfirmClearAll(false)}
                              className="px-2 py-1 text-xs bg-slate-800 text-slate-300 rounded-lg hover:bg-slate-700 cursor-pointer"
                            >
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setConfirmClearAll(true)}
                            className="text-xs font-bold text-red-400 hover:text-red-300 transition-colors cursor-pointer"
                          >
                            Delete All Saves
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Snapshots Content: Detail Mode or Thumbnails Mode */}
              {savesViewMode === 'DETAIL' ? (
                /* Detail List View */
                <div className="space-y-2">
                  {sortedSnapshots.map((snap) => {
                    const isActive = snap.id === activeSnapshotId;
                    const isSelected = snap.id === currentSelectedId;
                    const progressPct =
                      snap.totalCount > 0
                        ? Math.round((snap.filledCount * 100) / snap.totalCount)
                        : 0;
                    const thumbSrc = snap.sampleAssetPath || snap.previewDataUrl;

                    return (
                      <div
                        key={snap.id}
                        data-testid={`save-card-${snap.id}`}
                        onClick={() => handleSaveCardClick(snap)}
                        onDoubleClick={() => {
                          if (!isActive) onLoadSnapshot(snap);
                          onClose();
                        }}
                        title={
                          isActive
                            ? 'Active save (double-tap to resume game)'
                            : 'Double-tap to load save and close settings'
                        }
                        className={`relative flex items-center gap-3 p-2.5 rounded-xl border transition-all cursor-pointer select-none ${
                          isSelected
                            ? 'border-amber-400 bg-amber-500/15 shadow-md ring-2 ring-amber-400/60'
                            : isActive
                            ? 'border-amber-500/50 bg-slate-950/60 hover:bg-slate-850'
                            : 'border-slate-800 bg-slate-950/40 hover:bg-slate-800/40 hover:border-slate-700'
                        }`}
                      >
                        {/* Larger Thumbnail Preview */}
                        <div className="w-16 h-16 sm:w-18 sm:h-18 rounded-xl bg-slate-900 border border-slate-700/80 overflow-hidden flex-shrink-0 flex items-center justify-center relative shadow-inner">
                          {thumbSrc ? (
                            <img
                              src={thumbSrc}
                              alt={snap.title}
                              className="w-full h-full object-cover"
                            />
                          ) : (
                            <ImageIcon size={22} className="text-slate-500" />
                          )}
                        </div>

                        {/* Info & Title */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5">
                            <h4 className="text-xs sm:text-sm font-bold text-slate-200 truncate">
                              {snap.title}
                            </h4>
                            {snap.isPinned && (
                              <Pin size={11} className="text-amber-400 fill-amber-400 flex-shrink-0" />
                            )}
                          </div>

                          <div className="flex items-center gap-1.5 mt-0.5 text-[11px] text-slate-400 font-medium">
                            <span className="text-amber-400 font-bold">{progressPct}%</span>
                            {snap.fileSizeBytes && snap.fileSizeBytes > 0 ? (
                              <>
                                <span>•</span>
                                <span>{Math.max(1, Math.round(snap.fileSizeBytes / 1024))} KB</span>
                              </>
                            ) : null}
                          </div>

                          {/* Subtle Progress Bar */}
                          <div className="w-full bg-slate-800/80 rounded-full h-1.5 mt-2 overflow-hidden">
                            <div
                              className="bg-amber-400 h-full rounded-full transition-all"
                              style={{ width: `${progressPct}%` }}
                            />
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                /* Thumbnails Grid View */
                <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
                  {sortedSnapshots.map((snap) => {
                    const isActive = snap.id === activeSnapshotId;
                    const isSelected = snap.id === currentSelectedId;
                    const progressPct =
                      snap.totalCount > 0
                        ? Math.round((snap.filledCount * 100) / snap.totalCount)
                        : 0;
                    const thumbSrc = snap.sampleAssetPath || snap.previewDataUrl;

                    return (
                      <div
                        key={snap.id}
                        data-testid={`save-card-${snap.id}`}
                        onClick={() => handleSaveCardClick(snap)}
                        onDoubleClick={() => {
                          if (!isActive) onLoadSnapshot(snap);
                          onClose();
                        }}
                        title={
                          isActive
                            ? 'Active save (double-tap to resume game)'
                            : 'Double-tap to load save and close settings'
                        }
                        className={`group relative flex flex-col rounded-xl border overflow-hidden transition-all cursor-pointer select-none ${
                          isSelected
                            ? 'border-amber-400 bg-amber-500/15 ring-2 ring-amber-400/60 shadow-lg'
                            : isActive
                            ? 'border-amber-500/50 bg-slate-900/60 hover:bg-slate-850'
                            : 'border-slate-800 bg-slate-950/40 hover:bg-slate-800/40 hover:border-slate-700'
                        }`}
                      >
                        {/* Rectangular Image Preview */}
                        <div className="relative w-full aspect-[4/3] bg-slate-900 overflow-hidden flex items-center justify-center">
                          {thumbSrc ? (
                            <img
                              src={thumbSrc}
                              alt={snap.title}
                              className="w-full h-full object-cover transition-transform duration-200 group-hover:scale-105"
                            />
                          ) : (
                            <ImageIcon size={28} className="text-slate-600" />
                          )}

                          {/* Pin Badge if Pinned */}
                          {snap.isPinned && (
                            <div className="absolute top-1.5 left-1.5 bg-slate-950/85 backdrop-blur-xs text-amber-400 p-1 rounded-md border border-slate-700/60 shadow-sm">
                              <Pin size={10} className="fill-current" />
                            </div>
                          )}

                          {/* Floating Percentage Badge */}
                          <div className="absolute top-1.5 right-1.5 bg-slate-950/85 backdrop-blur-xs text-amber-400 text-[11px] font-black px-1.5 py-0.5 rounded-md border border-slate-700/60 shadow-sm">
                            {progressPct}%
                          </div>

                          {/* Progress Bar Line */}
                          <div className="absolute bottom-0 left-0 right-0 h-1 bg-slate-900/80">
                            <div
                              className="h-full bg-amber-400 transition-all"
                              style={{ width: `${progressPct}%` }}
                            />
                          </div>
                        </div>

                        {/* Title Footer */}
                        <div className="p-2 flex items-center justify-between gap-1">
                          <span className="text-xs font-bold text-slate-200 truncate" title={snap.title}>
                            {snap.title}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {snapshots.length === 0 && (
                <div className="text-center py-8 text-slate-500 text-sm">
                  No saved snapshots yet. Load an image or play a sample to start!
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
