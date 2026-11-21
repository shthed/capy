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
  Lightbulb,
  ZoomIn,
  Copy,
  Printer,
  Info,
  ShieldCheck,
  MessageSquare,
  HelpCircle,
  Palette,
  Gamepad2,
  Hand,
  Compass,
  Volume2,
  Type,
  Film,
  BookOpen,
} from 'lucide-react';
import {
  CollapsibleSettingSection,
  SettingSectionCard,
  SettingSwitchRow,
} from './SettingsControls';
import { PwaService } from '../services/PwaService';
import { NativeBridge } from '../services/NativeBridge';
import { resolveSafeSnapshotThumbnail } from '../utils/snapshotPaths';
import { APP_VERSION, resolveReleaseChannel } from '../version';
import { resolveScopedStorageKey, resolveStorageNamespace } from '../services/StorageNamespace';
import { ProviderRegistry } from '../services/providers/ProviderRegistry';
import { CoopParticipant, PlayerIdentity } from '../services/providers/types';
import { CloudAccountCard, CloudSyncLiveStatus } from './CloudAccountCard';
import {
  CANVAS_BG_MAP,
  CanvasBgColor,
  PresetCanvasBgColor,
  argbToHex,
  computeProgressPercentage,
  DEFAULT_GENERATOR_CONFIG,
  hexToArgb,
  Difficulty,
  GeneratorAlgorithm,
  GeneratorConfig,
  HintFillStyle,
  ImageType,
  LineHandlingMode,
  MAX_GENERATOR_CONFIG,
  matchesGeneratorConfig,
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
import {
  FEEDBACK_CATEGORIES,
  FEEDBACK_MAX_DETAILS_CHARS,
  FEEDBACK_MAX_TITLE_CHARS,
  FeedbackCategory,
  FeedbackSubmitResult,
  PUBLIC_ISSUES_URL,
  submitAnonymousFeedback,
} from '../services/FeedbackService';

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
  showCloudCoopUi?: boolean;
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
  onSelectSample: (sample: SampleArtwork, config?: GeneratorConfig, prebakedSnapshotId?: string) => void;
  onUploadImage: () => void;
  onExportSnapshot?: (id: string, title: string) => void;
  onExportPrintableSvg?: () => Promise<boolean> | void;
  onExportSnapshotSvg?: (id: string, title: string) => Promise<boolean> | void;
  onExportAllSnapshots?: () => void;
  onImportSnapshots?: (
    file: File
  ) => Promise<{ ok: boolean; importedCount: number; message: string } | void> | void;
  onRestoreStarterSample?: () => void;
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
  cloudSyncStatus?: CloudSyncLiveStatus;
  lastCloudSyncError?: string | null;
  onZoomIntoDetailTile?: () => void;
  onStartTutorial?: () => void;
  onStartTour?: () => void;
  onTabOpened?: (tabId: number) => void;
  onExplorePresetGallery?: () => void;
}

const LAST_SETTINGS_TAB_KEY = 'capy_last_settings_tab';
const GALLERY_FILTER_TAGS = ['All', 'Animals', 'Coloring', 'Nature', 'Line Art', 'Detailed', 'Music'];

interface PresetGalleryEntry {
  id: string;
  category: 'ALGORITHM' | 'BORDER' | 'DETAIL';
  title: string;
  badge: string;
  image: string;
  howItWorks: string;
  bestFor: string;
  stats: string;
  isMatch: (cfg: GeneratorConfig) => boolean;
  apply: (prev: GeneratorConfig) => GeneratorConfig;
}

const PRESET_GALLERY_ITEMS: PresetGalleryEntry[] = [
  {
    id: 'algo-auto',
    category: 'ALGORITHM',
    title: 'Auto Detect',
    badge: 'Default',
    image: './assets/presets/algo-auto.png',
    howItWorks: 'Scans ink strokes and gradients, then picks Line Art, Painterly, or Posterized automatically.',
    bestFor: 'Any photo or drawing when you want instant balanced results',
    stats: 'Adaptive strategy',
    isMatch: (c) => (c.algorithm || 'AUTO') === 'AUTO',
    apply: (prev) => ({ ...prev, algorithm: 'AUTO', imageType: 'AUTO' }),
  },
  {
    id: 'algo-line-art',
    category: 'ALGORITHM',
    title: 'Line Art Tracer',
    badge: 'Ink & Outlines',
    image: './assets/presets/algo-line-art.png',
    howItWorks: 'Detects dark drawn outlines and snaps region boundaries tightly along ink strokes.',
    bestFor: 'Cartoons, comics, manga, and coloring pages',
    stats: 'Crisp ink edges',
    isMatch: (c) => c.algorithm === 'LINE_ART',
    apply: (prev) => ({ ...prev, algorithm: 'LINE_ART', imageType: 'DRAWING' }),
  },
  {
    id: 'algo-painterly',
    category: 'ALGORITHM',
    title: 'Painterly (Photo)',
    badge: 'Photos',
    image: './assets/presets/algo-painterly.png',
    howItWorks: 'Smooths photographic textures with a Kuwahara cel filter into organic paintable shapes.',
    bestFor: 'Photos, portraits, pets, and natural scenery',
    stats: 'Smooth cel-shading',
    isMatch: (c) => c.algorithm === 'PAINTERLY',
    apply: (prev) => ({ ...prev, algorithm: 'PAINTERLY', imageType: 'PHOTO' }),
  },
  {
    id: 'algo-posterized',
    category: 'ALGORITHM',
    title: 'Posterized',
    badge: 'Flat Graphic',
    image: './assets/presets/algo-posterized.png',
    howItWorks: 'Applies median sharpening without smoothing for crisp, angular color boundaries.',
    bestFor: 'Logos, posters, and flat vector illustrations',
    stats: 'Sharp geometric edges',
    isMatch: (c) => c.algorithm === 'POSTERIZED',
    apply: (prev) => ({ ...prev, algorithm: 'POSTERIZED', imageType: 'AUTO' }),
  },
  {
    id: 'algo-mosaic',
    category: 'ALGORITHM',
    title: 'Mosaic Cells',
    badge: 'Stained Glass',
    image: './assets/presets/algo-mosaic.png',
    howItWorks: 'Tessellates the canvas into evenly sized spatial-color superpixel tiles.',
    bestFor: 'Turning any image into a stained-glass mosaic puzzle',
    stats: 'Even convex tiles',
    isMatch: (c) => c.algorithm === 'MOSAIC_CEL',
    apply: (prev) => ({ ...prev, algorithm: 'MOSAIC_CEL', imageType: 'AUTO' }),
  },
  {
    id: 'border-absorb',
    category: 'BORDER',
    title: 'Boundaries Follow Artwork Lines',
    badge: 'Default Border',
    image: './assets/presets/border-absorb.png',
    howItWorks: 'Expands neighboring color regions symmetrically into ink lines so seams meet at stroke centers.',
    bestFor: 'Clean color-by-number shapes without painting black outlines',
    stats: 'Stroke-center seams',
    isMatch: (c) => (c.lineHandling || 'ABSORB_LINES') === 'ABSORB_LINES',
    apply: (prev) => ({ ...prev, lineHandling: 'ABSORB_LINES' }),
  },
  {
    id: 'border-unified',
    category: 'BORDER',
    title: 'Continuous Black Line Region',
    badge: 'Playable Ink',
    image: './assets/presets/border-unified.png',
    howItWorks: 'Groups all dark ink outlines into a single dedicated playable region with its own swatch.',
    bestFor: 'Comic/ink styles where you want to color the outlines too',
    stats: 'Unified outline swatch',
    isMatch: (c) => c.lineHandling === 'UNIFIED_BLACK_REGION',
    apply: (prev) => ({
      ...prev,
      algorithm: prev.algorithm === 'PAINTERLY' || prev.algorithm === 'POSTERIZED' || prev.algorithm === 'MOSAIC_CEL' ? 'LINE_ART' : prev.algorithm,
      lineHandling: 'UNIFIED_BLACK_REGION',
    }),
  },
  {
    id: 'detail-low',
    category: 'DETAIL',
    title: 'Low Detail / Simple',
    badge: 'Quick & Relaxing',
    image: './assets/presets/detail-low.png',
    howItWorks: 'Caps palette to ~8-12 colors with larger, simpler shapes and fewer small pieces.',
    bestFor: 'Fast 5-minute sessions and larger easy-to-tap shapes',
    stats: '~10 colors • ~100 pieces',
    isMatch: (c) => c.paletteDetail === 'LOW',
    apply: (prev) => ({
      ...prev,
      paletteDetail: 'LOW',
      colorCount: 10,
      maxRegions: 100,
      minRegionArea: 96,
    }),
  },
  {
    id: 'detail-medium',
    category: 'DETAIL',
    title: 'Medium Detail / Standard',
    badge: 'Balanced',
    image: './assets/presets/detail-medium.png',
    howItWorks: 'Balances ~14-24 colors and ~250 pieces for clear artwork detail without tiny speckles.',
    bestFor: 'Everyday puzzles with a comfortable pace',
    stats: '~18 colors • ~250 pieces',
    isMatch: (c) => c.paletteDetail === 'MEDIUM',
    apply: (prev) => ({
      ...prev,
      paletteDetail: 'MEDIUM',
      colorCount: 18,
      maxRegions: 250,
      minRegionArea: 48,
    }),
  },
  {
    id: 'detail-high',
    category: 'DETAIL',
    title: 'High Detail / Detailed',
    badge: 'Intricate',
    image: './assets/presets/detail-high.png',
    howItWorks: 'Expands palette to ~30-50 colors and allows finer 24 px² regions up to ~500 pieces.',
    bestFor: 'Rich shading, zoom-in detail, and longer relaxing sessions',
    stats: '~38 colors • ~500 pieces',
    isMatch: (c) => c.paletteDetail === 'HIGH',
    apply: (prev) => ({
      ...prev,
      paletteDetail: 'HIGH',
      colorCount: 38,
      maxRegions: 500,
      minRegionArea: 24,
    }),
  },
];

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
  showCloudCoopUi = false,
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
  onRestoreStarterSample,
  onHostCoopRoom,
  onJoinCoopRoom,
  onLeaveCoopRoom,
  onShareProgressLink,
  onCopyCoopInviteLink,
  onSyncCloudProgress,
  cloudSyncStatus,
  lastCloudSyncError,
  onZoomIntoDetailTile,
  onStartTutorial,
  onStartTour,
  onTabOpened,
  onExplorePresetGallery,
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
      const saved = localStorage.getItem(resolveScopedStorageKey(LAST_SETTINGS_TAB_KEY));
      if (saved !== null) {
        const parsed = parseInt(saved, 10);
        if (!isNaN(parsed) && parsed >= 0 && parsed <= 4) return parsed;
      }
    } catch {
      // Ignored
    }
    return 1;
  });
  const [localConfig, setLocalConfig] = useState<GeneratorConfig>(settings.generatorConfig);
  const prevIsOpenRef = useRef<boolean>(false);
  useEffect(() => {
    if (isOpen && !prevIsOpenRef.current) {
      setLocalConfig(settings.generatorConfig);
    }
    prevIsOpenRef.current = isOpen;
  }, [isOpen, settings.generatorConfig]);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameText, setRenameText] = useState<string>('');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [confirmClearAll, setConfirmClearAll] = useState(false);
  const [selectedSaveId, setSelectedSaveId] = useState<string | null>(null);
  const [savesViewMode, setSavesViewMode] = useState<'DETAIL' | 'THUMBNAILS'>(() => {
    try {
      const stored = localStorage.getItem(resolveScopedStorageKey('capy_saves_view_mode'));
      return stored === 'DETAIL' || stored === 'THUMBNAILS' ? stored : 'THUMBNAILS';
    } catch {
      return 'THUMBNAILS';
    }
  });
  const lastTapRef = useRef<{ id: string; time: number }>({ id: '', time: 0 });

  // Gallery Search, Tag Filter Chips & Community Puzzle Ideas state
  const [gallerySearch, setGallerySearch] = useState('');
  const [activeGalleryTag, setActiveGalleryTag] = useState('All');
  const [showPresetGallery, setShowPresetGallery] = useState(false);
  const [presetGalleryFilter, setPresetGalleryFilter] = useState<'ALL' | 'ALGORITHM' | 'BORDER' | 'DETAIL'>('ALL');
  const [openHintId, setOpenHintId] = useState<string | null>(null);
  const presetGallerySectionRef = useRef<HTMLDivElement | null>(null);
  const createOptionsSectionRef = useRef<HTMLDivElement | null>(null);

  // Anonymous In-Game Feedback state (Tab 0: About)
  const [isFeedbackOpen, setIsFeedbackOpen] = useState(false);
  const [feedbackCategory, setFeedbackCategory] = useState<FeedbackCategory>('bug');
  const [feedbackTitle, setFeedbackTitle] = useState('');
  const [feedbackDetails, setFeedbackDetails] = useState('');
  const [feedbackHoneypot, setFeedbackHoneypot] = useState('');
  const [feedbackSubmitting, setFeedbackSubmitting] = useState(false);
  const [feedbackResult, setFeedbackResult] = useState<FeedbackSubmitResult | null>(null);

  const activeFeedbackCategoryMeta =
    FEEDBACK_CATEGORIES.find((c) => c.id === feedbackCategory) ?? FEEDBACK_CATEGORIES[0];

  const handleSubmitFeedback = async (e: React.FormEvent) => {
    e.preventDefault();
    if (feedbackSubmitting) return;
    setFeedbackSubmitting(true);
    setFeedbackResult(null);
    const result = await submitAnonymousFeedback({
      category: feedbackCategory,
      title: feedbackTitle,
      details: feedbackDetails,
      website: feedbackHoneypot,
    });
    setFeedbackResult(result);
    if (result.ok) {
      setFeedbackTitle('');
      setFeedbackDetails('');
      setFeedbackHoneypot('');
    }
    setFeedbackSubmitting(false);
  };

  const renderHintButton = (id: string, title: string) => {
    const isExpanded = openHintId === id;
    return (
      <button
        type="button"
        data-testid={`hint-toggle-${id}`}
        aria-expanded={isExpanded}
        aria-label={`Toggle hint for ${title}`}
        onClick={(e) => {
          e.stopPropagation();
          setOpenHintId((prev) => (prev === id ? null : id));
        }}
        className={`capy-hint-icon-btn inline-flex items-center justify-center w-5 h-5 rounded-full border text-[10px] font-bold transition-colors cursor-pointer flex-shrink-0 ${
          isExpanded
            ? 'bg-amber-400 text-slate-950 border-amber-300'
            : 'bg-slate-900 text-slate-300 border-slate-700 hover:border-amber-400/60 hover:text-amber-300'
        }`}
      >
        <Info size={11} />
      </button>
    );
  };

  const renderHintCallout = (id: string, text: string) => {
    if (openHintId !== id) return null;
    return (
      <div
        data-testid={`hint-tooltip-${id}`}
        role="note"
        className="px-2.5 py-1.5 rounded-lg bg-slate-900/95 border border-amber-400/40 text-[11px] text-slate-200 leading-snug"
      >
        {text}
      </div>
    );
  };
  const [communityIdeas, setCommunityIdeas] = useState(() =>
    ProviderRegistry.catalog.getCommunityIdeas()
  );
  const [showIdeaForm, setShowIdeaForm] = useState(false);
  const [ideaTitle, setIdeaTitle] = useState('');
  const [ideaPrompt, setIdeaPrompt] = useState('');
  const [ideaCategory, setIdeaCategory] = useState('Animals');
  const [ideaFeedback, setIdeaFeedback] = useState<string | null>(null);

  // Player Profile, Cloud Sync, Share Link & Co-op Room UI state
  const [playerIdentity, setPlayerIdentity] = useState<PlayerIdentity>(() =>
    ProviderRegistry.auth.getCurrentIdentity()
  );
  const [joinCodeInput, setJoinCodeInput] = useState('');
  const [hubNotice, setHubNotice] = useState<string | null>(null);
  const [importNotice, setImportNotice] = useState<{ ok: boolean; message: string } | null>(null);
  const [failedThumbSrcs, setFailedThumbSrcs] = useState<Record<string, boolean>>({});
  const [isSyncingCloud, setIsSyncingCloud] = useState(false);
  const cloudProviders = useMemo(
    () => ProviderRegistry.auth.getAvailableCloudProviders(),
    [playerIdentity]
  );

  useEffect(() => {
    return ProviderRegistry.auth.subscribe((id) => {
      setPlayerIdentity(id);
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
      localStorage.setItem(resolveScopedStorageKey('capy_saves_view_mode'), mode);
    } catch {
      // Ignored
    }
  };

  const onTabOpenedRef = useRef(onTabOpened);
  onTabOpenedRef.current = onTabOpened;

  // Sync activeTab when modal opens with explicit initialTab or restore last active
  useEffect(() => {
    if (isOpen) {
      let resolvedTab = activeTab;
      if (initialTab !== undefined) {
        resolvedTab = initialTab;
        setActiveTab(initialTab);
        try {
          localStorage.setItem(resolveScopedStorageKey(LAST_SETTINGS_TAB_KEY), String(initialTab));
        } catch {
          // Ignored
        }
      } else {
        try {
          const saved = localStorage.getItem(resolveScopedStorageKey(LAST_SETTINGS_TAB_KEY));
          if (saved !== null) {
            const parsed = parseInt(saved, 10);
            if (!isNaN(parsed) && parsed >= 0 && parsed <= 4) {
              resolvedTab = parsed;
              setActiveTab(parsed);
            }
          }
        } catch {
          // Ignored
        }
      }
      onTabOpenedRef.current?.(resolvedTab);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    { id: 0, label: 'About', icon: Info },
    { id: 1, label: 'Settings', icon: Sliders },
    { id: 2, label: 'Hints', icon: Sparkles },
    { id: 3, label: 'Create', icon: RefreshCw },
    { id: 4, label: 'Saves', icon: Save },
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
        role="dialog"
        aria-modal="true"
        aria-label="Settings and Menu"
        onClick={(e) => e.stopPropagation()}
        className="relative w-full h-full sm:h-[88vh] sm:max-h-[860px] sm:max-w-2xl md:max-w-3xl flex flex-col bg-slate-900 sm:border sm:border-slate-800 sm:rounded-2xl shadow-2xl overflow-hidden text-slate-100 cursor-auto"
      >
        {/* Top Tab Bar: Tab headings, tour button & close button */}
        <div
          className="flex items-center justify-between border-b border-slate-800 bg-slate-950/90 px-2 sm:px-3 flex-shrink-0"
          style={{
            paddingTop: 'max(0.6rem, calc(var(--sat, 0px) + 0.5rem))',
            paddingLeft: 'max(0.5rem, calc(var(--sal, 0px) + 0.5rem))',
            paddingRight: 'max(0.5rem, calc(var(--sar, 0px) + 0.5rem))',
          }}
        >
          {/* Tab Navigation */}
          <div
            role="tablist"
            aria-label="Settings sections"
            data-testid="settings-modal-tabs"
            className="min-w-0 flex-1 flex flex-wrap sm:flex-nowrap items-center gap-0.5 sm:gap-1.5 overflow-x-auto no-scrollbar py-1.5"
          >
            {tabs.map((tab) => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  data-testid={`settings-tab-${tab.label.toLowerCase()}`}
                  onClick={() => {
                    setActiveTab(tab.id);
                    onTabOpenedRef.current?.(tab.id);
                    try {
                      localStorage.setItem(
                        resolveScopedStorageKey(LAST_SETTINGS_TAB_KEY),
                        String(tab.id)
                      );
                    } catch {
                      // Ignored
                    }
                  }}
                  className={`flex-shrink-0 flex items-center gap-0.5 sm:gap-2 min-h-[38px] sm:min-h-[40px] px-1.5 sm:px-3.5 py-1.5 sm:py-2 text-[11px] sm:text-sm font-bold rounded-lg transition-all cursor-pointer ${
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

            {/* Close button */}
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

        {/* Tab Contents */}
        <div
          className="flex-1 overflow-y-auto p-3.5 sm:p-5 space-y-4 sm:space-y-5"
          style={{
            paddingBottom: 'max(2.5rem, calc(var(--sab, 0px) + 1.75rem))',
            paddingLeft: 'max(0.875rem, calc(var(--sal, 0px) + 0.75rem))',
            paddingRight: 'max(0.875rem, calc(var(--sar, 0px) + 0.75rem))',
          }}
        >
          {/* TAB 0: ABOUT */}
          {activeTab === 0 && (
            <div className="space-y-4 sm:space-y-5">
              {/* About Capy Paint Hero Card */}
              <div
                data-testid="about-screen-card"
                className="p-3.5 sm:p-4 rounded-xl bg-slate-950/70 border border-slate-800/90 space-y-3"
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <h2 className="text-sm sm:text-base font-extrabold text-amber-300">
                      Capy Paint
                    </h2>
                    <p className="text-[11px] sm:text-xs text-slate-300 leading-relaxed mt-0.5">
                      {showCloudCoopUi
                        ? 'Offline-first color-by-number & free-coloring studio. Turn any photo or built-in artwork into a relaxing, zero-latency puzzle with instant saves, chronological replays, and live local Co-op.'
                        : 'Offline-first color-by-number & free-coloring studio. Turn any photo or built-in artwork into a relaxing, zero-latency puzzle with instant saves and chronological replays.'}
                    </p>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2 pt-0.5">
                  {onStartTutorial && (
                    <button
                      type="button"
                      data-testid="about-replay-tutorial-btn"
                      onClick={() => {
                        onClose();
                        onStartTutorial();
                      }}
                      className="inline-flex items-center gap-1.5 min-h-[38px] px-3 py-1.5 rounded-lg bg-amber-400 hover:bg-amber-300 text-slate-950 text-xs font-extrabold shadow transition-colors cursor-pointer"
                    >
                      <Play size={13} className="fill-slate-950" />
                      <span>Replay Interactive Tutorial</span>
                    </button>
                  )}
                  <button
                    type="button"
                    data-testid="about-open-feedback-btn"
                    aria-expanded={isFeedbackOpen}
                    onClick={() => setIsFeedbackOpen((prev) => !prev)}
                    className={`inline-flex items-center gap-1.5 min-h-[38px] px-3 py-1.5 rounded-lg text-xs font-extrabold border transition-colors cursor-pointer ${
                      isFeedbackOpen
                        ? 'bg-sky-500/25 text-sky-100 border-sky-400/80'
                        : 'bg-sky-500/15 hover:bg-sky-500/25 text-sky-200 border-sky-400/60'
                    }`}
                  >
                    <MessageSquare size={13} className="text-sky-300" />
                    <span>{isFeedbackOpen ? 'Hide Feedback Form' : 'Send Feedback'}</span>
                  </button>
                  <a
                    href={
                      NativeBridge.isAndroid
                        ? 'https://capypaint.com/privacy-policy.html'
                        : 'privacy-policy.html'
                    }
                    target="_blank"
                    rel="noopener noreferrer"
                    data-testid="about-privacy-policy-link"
                    className="capy-link-btn inline-flex items-center gap-1.5 min-h-[38px] px-3 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-200 text-xs font-bold border border-slate-700/80 transition-colors cursor-pointer"
                  >
                    <ShieldCheck size={13} className="text-emerald-400" />
                    <span>Privacy Policy</span>
                  </a>
                </div>
              </div>

              {/* Collapsible Anonymous In-Game Feedback Form */}
              {isFeedbackOpen && (
                <form
                  data-testid="in-game-feedback-card"
                  onSubmit={handleSubmitFeedback}
                  noValidate
                  className="p-3.5 sm:p-4 rounded-xl bg-slate-950/80 border border-sky-500/30 space-y-3"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <h3 className="text-xs sm:text-sm font-bold text-slate-100">
                        Send Anonymous Feedback
                      </h3>
                      <p className="text-[11px] text-slate-400 mt-0.5">
                        Sent anonymously to capyboop/paint Issues — no account required. Includes
                        app version &amp; platform only.
                      </p>
                    </div>
                  </div>

                  {/* Category Selector Pills */}
                  <div className="flex flex-wrap gap-1.5" role="group" aria-label="Feedback category">
                    {FEEDBACK_CATEGORIES.map((cat) => {
                      const active = feedbackCategory === cat.id;
                      return (
                        <button
                          key={cat.id}
                          type="button"
                          data-testid={`feedback-category-${cat.id}`}
                          aria-pressed={active}
                          onClick={() => {
                            setFeedbackCategory(cat.id);
                            setFeedbackResult(null);
                          }}
                          className={`px-2.5 py-1 rounded-lg text-[11px] font-bold border transition-colors cursor-pointer ${
                            active
                              ? 'bg-amber-400 text-slate-950 border-amber-300'
                              : 'bg-slate-900 hover:bg-slate-800 text-slate-300 border-slate-700/80'
                          }`}
                        >
                          {cat.label}
                        </button>
                      );
                    })}
                  </div>

                  {/* Hidden Honeypot Field */}
                  <input
                    type="text"
                    name="website"
                    value={feedbackHoneypot}
                    onChange={(e) => setFeedbackHoneypot(e.target.value)}
                    tabIndex={-1}
                    autoComplete="off"
                    aria-hidden="true"
                    className="hidden"
                  />

                  {/* Title Input */}
                  <div className="space-y-1">
                    <label
                      htmlFor="capy-feedback-title"
                      className="block text-[11px] font-semibold text-slate-300"
                    >
                      Title
                    </label>
                    <input
                      id="capy-feedback-title"
                      type="text"
                      data-testid="feedback-title-input"
                      value={feedbackTitle}
                      onChange={(e) => setFeedbackTitle(e.target.value)}
                      maxLength={FEEDBACK_MAX_TITLE_CHARS}
                      placeholder={activeFeedbackCategoryMeta.titlePlaceholder}
                      className="w-full px-2.5 py-1.5 rounded-lg bg-slate-900 border border-slate-700/90 text-xs text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-amber-400"
                    />
                  </div>

                  {/* Details Textarea + Character Counter */}
                  <div className="space-y-1">
                    <div className="flex items-center justify-between gap-2">
                      <label
                        htmlFor="capy-feedback-details"
                        className="block text-[11px] font-semibold text-slate-300"
                      >
                        Details
                      </label>
                      <span
                        data-testid="feedback-details-counter"
                        className="text-[10px] font-mono text-slate-400"
                      >
                        {feedbackDetails.length}/{FEEDBACK_MAX_DETAILS_CHARS}
                      </span>
                    </div>
                    <textarea
                      id="capy-feedback-details"
                      data-testid="feedback-details-input"
                      rows={3}
                      value={feedbackDetails}
                      onChange={(e) => setFeedbackDetails(e.target.value)}
                      maxLength={FEEDBACK_MAX_DETAILS_CHARS}
                      placeholder={activeFeedbackCategoryMeta.detailsPlaceholder}
                      className="w-full px-2.5 py-1.5 rounded-lg bg-slate-900 border border-slate-700/90 text-xs text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-amber-400 resize-y"
                    />
                  </div>

                  {/* Actions */}
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <button
                      type="submit"
                      data-testid="feedback-submit-btn"
                      disabled={feedbackSubmitting}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-400 hover:bg-amber-300 disabled:opacity-50 disabled:cursor-not-allowed text-slate-950 text-xs font-extrabold shadow transition-colors cursor-pointer"
                    >
                      <MessageSquare size={13} />
                      <span>{feedbackSubmitting ? 'Sending...' : 'Submit Feedback'}</span>
                    </button>
                    <a
                      href={PUBLIC_ISSUES_URL}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-[11px] font-semibold text-sky-400 hover:text-sky-300 underline underline-offset-2"
                    >
                      <span>Browse capyboop/paint Issues</span>
                      <ExternalLink size={11} />
                    </a>
                  </div>

                  {/* Inline Status Banner (zero blocking alert()) */}
                  {feedbackResult && (
                    <div
                      data-testid="feedback-status-banner"
                      role="status"
                      className={`p-2.5 rounded-lg border text-xs space-y-1 ${
                        feedbackResult.ok
                          ? 'bg-emerald-950/60 border-emerald-500/40 text-emerald-200'
                          : 'bg-amber-950/60 border-amber-500/40 text-amber-200'
                      }`}
                    >
                      {feedbackResult.ok ? (
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span>
                            Thanks! Your anonymous feedback was submitted
                            {feedbackResult.issueNumber ? ` as issue #${feedbackResult.issueNumber}` : ''}.
                          </span>
                          {feedbackResult.issueUrl && (
                            <a
                              href={feedbackResult.issueUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              data-testid="feedback-issue-link"
                              className="inline-flex items-center gap-1 font-bold text-emerald-300 hover:text-emerald-200 underline underline-offset-2"
                            >
                              <span>
                                {feedbackResult.issueNumber
                                  ? `View Issue #${feedbackResult.issueNumber}`
                                  : 'View Issue on GitHub'}
                              </span>
                              <ExternalLink size={11} />
                            </a>
                          )}
                        </div>
                      ) : (
                        <div className="space-y-1">
                          <div>{feedbackResult.error}</div>
                          <a
                            href={feedbackResult.fallbackUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            data-testid="feedback-fallback-link"
                            className="inline-flex items-center gap-1 font-bold text-amber-300 hover:text-amber-200 underline underline-offset-2"
                          >
                            <span>Open prefilled GitHub form</span>
                            <ExternalLink size={11} />
                          </a>
                        </div>
                      )}
                    </div>
                  )}
                </form>
              )}

              {/* How to Play & Core Features */}
              <div className="space-y-2">
                <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                  How to Play &amp; Core Features
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                  <div className="p-2.5 rounded-xl bg-slate-950/50 border border-slate-800/80">
                    <div className="font-bold text-slate-200">Tap or Paint</div>
                    <div className="text-[11px] text-slate-400 mt-0.5">
                      Pick a numbered swatch below and tap matching regions, or toggle Paint Mode to
                      drag-fill smoothly.
                    </div>
                  </div>
                  <div className="p-2.5 rounded-xl bg-slate-950/50 border border-slate-800/80">
                    <div className="font-bold text-slate-200">Zoom &amp; Pan</div>
                    <div className="text-[11px] text-slate-400 mt-0.5">
                      Pinch, scroll, or double-tap &amp; drag to inspect fine details.
                    </div>
                  </div>
                  <div className="p-2.5 rounded-xl bg-slate-950/50 border border-slate-800/80">
                    <div className="font-bold text-slate-200">Smart Hints &amp; Replay</div>
                    <div className="text-[11px] text-slate-400 mt-0.5">
                      Double-tap a swatch to locate remaining spots. Long-press Undo to scrub or
                      replay your progress.
                    </div>
                  </div>
                  <div className="p-2.5 rounded-xl bg-slate-950/50 border border-slate-800/80">
                    <div className="font-bold text-slate-200">
                      {showCloudCoopUi ? 'Create, Saves & Co-op' : 'Create, Saves & Printable Art'}
                    </div>
                    <div className="text-[11px] text-slate-400 mt-0.5">
                      {showCloudCoopUi
                        ? 'Upload any photo in Create, export .capy backups or printable SVGs, and color together in Co-op.'
                        : 'Upload any photo in Create, save progress locally, and export .capy backups or printable SVGs.'}
                    </div>
                  </div>
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
                  <div
                    className={`p-2 rounded-lg bg-slate-900/70 border border-slate-800/80 ${
                      !showCloudCoopUi ? 'col-span-2' : ''
                    }`}
                  >
                    <div className="text-[10px] text-slate-400 font-medium truncate">
                      Free Color Art
                    </div>
                    <div
                      data-testid="stat-free-color-creations"
                      className="text-sm sm:text-base font-extrabold font-mono text-slate-200 tabular-nums"
                    >
                      {effectiveStats.freeColorCreations.toLocaleString()}
                    </div>
                  </div>
                  {showCloudCoopUi && (
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
                  )}
                </div>
              </div>

              {/* Platform & External Application Links (Relocated from Settings) */}
              <div
                data-testid="about-platforms-section"
                className="pt-3 border-t border-slate-800/80 space-y-2"
              >
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

                  {!NativeBridge.isAndroid && (
                    <a
                      href="capy.apk"
                      download="capy.apk"
                      data-testid="android-apk-download-link"
                      className="capy-link-btn flex items-center gap-2 p-2.5 rounded-xl bg-slate-950/60 border border-slate-800 hover:border-amber-400/50 hover:bg-slate-800/40 text-slate-200 transition-all text-xs font-semibold cursor-pointer"
                    >
                      <Smartphone size={16} className="text-amber-400 flex-shrink-0" />
                      <div className="min-w-0">
                        <div className="truncate font-bold text-slate-200">Android APK</div>
                        <div className="text-[10px] text-slate-400 truncate">Download standalone Android application</div>
                      </div>
                    </a>
                  )}
                </div>

                {/* Release Channel Switcher (Stable <-> Beta Opt-In; Web/PWA only) */}
                {(() => {
                  const channelInfo = resolveReleaseChannel();
                  if (NativeBridge.isAndroid || !channelInfo.showChannelSwitcher) return null;
                  const ns = resolveStorageNamespace();
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
                        {ns.isSandboxed
                          ? 'Preview upcoming Sprint features early in an isolated channel sandbox so your Production saves and settings stay untouched.'
                          : sharesOriginWithBeta
                            ? 'Preview upcoming Sprint features early on the Beta channel before they ship to Production. Beta runs in an isolated browser sandbox so your Production saves and settings stay untouched.'
                            : 'Preview upcoming Sprint features early on the Beta channel before they ship to Production.'}
                      </p>
                      <div className={`grid grid-cols-1 ${NativeBridge.isAndroid ? '' : 'sm:grid-cols-2'} gap-2 pt-0.5`}>
                        <a
                          href={primaryTargetUrl}
                          data-testid="toggle-beta-channel-btn"
                          className={`capy-link-btn flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold border transition-all cursor-pointer ${
                            isBeta
                              ? 'bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-200 border-emerald-400/50'
                              : 'bg-violet-500/20 hover:bg-violet-500/30 text-violet-200 border-violet-400/50'
                          }`}
                        >
                          <ExternalLink size={13} className="flex-shrink-0" />
                          <span>{primaryActionLabel}</span>
                        </a>
                        {!NativeBridge.isAndroid && (
                          <a
                            href={channelInfo.betaApkUrl}
                            download="capy-beta.apk"
                            data-testid="beta-apk-download-link"
                            className="capy-link-btn flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold bg-slate-900/90 hover:bg-slate-800 text-slate-200 border border-slate-700/80 hover:border-violet-400/50 transition-all cursor-pointer"
                          >
                            <Smartphone size={13} className="text-violet-300 flex-shrink-0" />
                            <span>Beta Android APK</span>
                          </a>
                        )}
                      </div>
                    </div>
                  );
                })()}

                {/* Open Source Licenses & Secondary Footer */}
                <div className="pt-2 border-t border-slate-800/80 space-y-2.5">
                  <details
                    data-testid="about-licenses-section"
                    className="group rounded-xl bg-slate-950/60 border border-slate-800/80 overflow-hidden"
                  >
                    <summary className="list-none flex items-center justify-between gap-2 min-h-[40px] px-3 py-2 text-xs font-bold text-slate-300 hover:bg-slate-800/40 cursor-pointer select-none">
                      <span className="inline-flex items-center gap-1.5">
                        <BookOpen size={13} className="text-amber-400" />
                        <span>Open Source Licenses</span>
                      </span>
                      <span className="text-[10px] font-semibold text-slate-400 group-open:hidden">
                        View credits
                      </span>
                      <span className="text-[10px] font-semibold text-amber-300 hidden group-open:inline">
                        Hide credits
                      </span>
                    </summary>
                    <div className="px-3 pb-3 pt-1.5 border-t border-slate-800/70 text-[11px] text-slate-400 space-y-1.5">
                      <p className="text-slate-300">
                        Capy Paint is built with open-source libraries:
                      </p>
                      <ul className="space-y-1 pl-3 list-disc">
                        <li>
                          <span className="text-slate-200 font-semibold">React</span> — MIT License
                        </li>
                        <li>
                          <span className="text-slate-200 font-semibold">Lucide React</span> — ISC License
                        </li>
                        <li>
                          <span className="text-slate-200 font-semibold">Tailwind CSS</span> — MIT License
                        </li>
                        <li>
                          <span className="text-slate-200 font-semibold">canvas-confetti</span> — ISC License
                        </li>
                        <li>
                          <span className="text-slate-200 font-semibold">AndroidX &amp; WebKit</span> — Apache License 2.0
                        </li>
                      </ul>
                    </div>
                  </details>

                  <div className="flex flex-wrap items-center justify-between gap-2 px-0.5 text-[11px] text-slate-400">
                    <span>CapyBoop Games • 100% Ad-Free</span>
                    <a
                      href="https://github.com/capyboop/paint/issues/new/choose"
                      target="_blank"
                      rel="noopener noreferrer"
                      data-testid="about-report-issue-link"
                      className="inline-flex items-center gap-1 text-slate-400 hover:text-sky-300 underline-offset-2 hover:underline transition-colors cursor-pointer"
                    >
                      <ExternalLink size={11} />
                      <span>Report Bug / Ideas on GitHub</span>
                    </a>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TAB 1: SETTINGS */}
          {activeTab === 1 && (
            <div className="space-y-4">
              {/* 1. Appearance & Canvas */}
              <SettingSectionCard
                title="Appearance & Canvas"
                icon={<Palette size={13} />}
                testId="settings-section-appearance"
              >
                {/* Canvas Background */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-slate-300">Canvas Background</span>
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

                {/* Color Mode */}
                <div className="space-y-1.5 pt-1 border-t border-slate-800/60">
                  <span className="text-xs font-semibold text-slate-300">Color Mode</span>
                  <div className="grid grid-cols-2 gap-2">
                    {(
                      [
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
                      ] as const
                    ).map((mode) => (
                      <button
                        key={mode.key}
                        type="button"
                        onClick={() =>
                          updateSetting('regionColorMode', mode.key as RegionColorMode)
                        }
                        className={`flex flex-col text-left p-2.5 rounded-lg border transition-all cursor-pointer ${
                          settings.regionColorMode === mode.key
                            ? 'border-amber-400 bg-slate-800/80 text-white ring-1 ring-amber-400'
                            : 'border-slate-800 bg-slate-900/50 text-slate-400 hover:bg-slate-800/50'
                        }`}
                      >
                        <span className="text-xs sm:text-sm font-bold text-slate-100">
                          {mode.label}
                        </span>
                        <span className="text-[11px] text-slate-400 mt-0.5 leading-snug">
                          {mode.desc}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Palette Order */}
                <div className="space-y-1.5 pt-1 border-t border-slate-800/60">
                  <span className="text-xs font-semibold text-slate-300">Palette Order</span>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5 sm:gap-2">
                    {(
                      [
                        { key: 'NUMBER', label: 'By Number' },
                        { key: 'REMAINING', label: 'Remaining' },
                        { key: 'HUE', label: 'Rainbow' },
                        { key: 'LIGHTNESS', label: 'Lightness' },
                      ] as const
                    ).map((item) => (
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

                {/* Appearance Toggles */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5 pt-1 border-t border-slate-800/60">
                  <SettingSwitchRow
                    label="Show Numbers on Regions"
                    description="Show number labels inside uncolored shapes"
                    checked={Boolean(settings.showRegionLabels)}
                    onToggle={() => updateSetting('showRegionLabels', !settings.showRegionLabels)}
                    testId="setting-show-region-labels"
                  />
                  <SettingSwitchRow
                    label="Show Borders in Preview"
                    description="Keep thin outlines visible while peeking at artwork"
                    checked={Boolean(settings.showPreviewBorders)}
                    onToggle={() =>
                      updateSetting('showPreviewBorders', !settings.showPreviewBorders)
                    }
                    testId="setting-show-preview-borders"
                  />
                </div>
              </SettingSectionCard>

              {/* 2. Gameplay */}
              <SettingSectionCard
                title="Gameplay"
                icon={<Gamepad2 size={13} />}
                testId="settings-section-gameplay"
              >
                {/* Tap Behavior / Difficulty */}
                <div className="space-y-1.5">
                  <span className="text-xs font-semibold text-slate-300">Tap Behavior</span>
                  <div className="grid grid-cols-2 gap-2">
                    {(
                      [
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
                      ] as const
                    ).map((diff) => (
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
                        <span className="text-xs sm:text-sm font-bold text-slate-100">
                          {diff.label}
                        </span>
                        <span className="text-[11px] text-slate-400 mt-0.5 leading-snug">
                          {diff.desc}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Fat-Finger Tap Assist & Finger Reach Radius */}
                <div className="p-2.5 rounded-xl bg-slate-900/55 border border-slate-800/75 space-y-2.5">
                  <SettingSwitchRow
                    label="Fat-Finger Tap Assist"
                    description="Snaps near-miss taps to nearby unfilled shapes"
                    checked={Boolean(settings.fatFingerAssist)}
                    onToggle={() => updateSetting('fatFingerAssist', !settings.fatFingerAssist)}
                    testId="setting-fat-finger-assist"
                    className="!bg-transparent !border-0 !p-0 !min-h-0"
                  />

                  <div
                    data-testid="setting-touch-reach-controls"
                    className={`space-y-1.5 pt-2 border-t border-slate-800/60 transition-opacity ${
                      settings.fatFingerAssist ? 'opacity-100' : 'opacity-50'
                    }`}
                  >
                    <div className="flex justify-between items-center text-xs gap-2">
                      <span className="text-slate-300 font-semibold">Finger Reach Radius</span>
                      <span
                        data-testid="setting-touch-reach-value"
                        className="text-amber-400 font-mono font-bold text-right"
                      >
                        {settings.fatFingerAssist &&
                        settings.largeText &&
                        Math.round(settings.touchReachRadiusPx ?? 22) < 34
                          ? `34px (Large UI • saved ${Math.round(settings.touchReachRadiusPx ?? 22)}px)`
                          : `${Math.round(settings.touchReachRadiusPx ?? 22)}px`}
                      </span>
                    </div>
                    <input
                      type="range"
                      min="8"
                      max="40"
                      step="1"
                      aria-label="Finger Reach Radius"
                      data-testid="setting-touch-reach-radius"
                      value={Math.round(settings.touchReachRadiusPx ?? 22)}
                      onChange={(e) =>
                        updateSettings({
                          fatFingerAssist: true,
                          touchReachRadiusPx: Math.round(
                            Math.min(40, Math.max(8, parseInt(e.target.value, 10) || 22))
                          ),
                        })
                      }
                      className="w-full accent-amber-400 cursor-pointer h-1.5 bg-slate-800 rounded-lg"
                    />
                    <div className="grid grid-cols-3 gap-1.5 pt-0.5">
                      {(
                        [
                          { px: 12, label: 'Compact 12px' },
                          { px: 22, label: 'Standard 22px' },
                          { px: 34, label: 'Large 34px' },
                        ] as const
                      ).map((preset) => (
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
                            Math.round(settings.touchReachRadiusPx ?? 22) === preset.px
                              ? 'border-amber-400 bg-slate-800/80 text-amber-300 ring-1 ring-amber-400'
                              : 'border-slate-800 bg-slate-950/40 text-slate-400 hover:bg-slate-800/50'
                          }`}
                        >
                          {preset.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Gameplay Toggles */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                  <SettingSwitchRow
                    label="Auto-Advance Color"
                    description="Switch to the next unfinished color automatically"
                    checked={Boolean(settings.autoAdvance)}
                    onToggle={() => updateSetting('autoAdvance', !settings.autoAdvance)}
                    testId="setting-auto-advance"
                  />
                  <SettingSwitchRow
                    label="Free Color Mode"
                    description="Pick any color freely and paint without number limits"
                    checked={Boolean(settings.isFreeColorMode)}
                    onToggle={() => updateSetting('isFreeColorMode', !settings.isFreeColorMode)}
                    testId="setting-free-color-mode"
                  />
                  <SettingSwitchRow
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
                </div>
              </SettingSectionCard>

              {/* 3. Controls & On-Screen Buttons */}
              <SettingSectionCard
                title="Controls & On-Screen Buttons"
                icon={<Hand size={13} />}
                testId="settings-section-controls"
                columns={2}
              >
                <SettingSwitchRow
                  label="Raise Palette Dock"
                  description="Add extra bottom spacing for mobile gesture bars"
                  checked={Boolean(settings.raisePaletteDock)}
                  onToggle={() => updateSetting('raisePaletteDock', !settings.raisePaletteDock)}
                  testId="setting-raise-palette-dock"
                />
                <SettingSwitchRow
                  label="Undo Button"
                  description="Show an Undo button above the palette to step back"
                  checked={Boolean(settings.enableUndo)}
                  onToggle={() => updateSetting('enableUndo', !settings.enableUndo)}
                  testId="setting-enable-undo"
                />
                <SettingSwitchRow
                  label="Zoom (+ / -) Buttons"
                  description="Show floating zoom in and out buttons on screen"
                  checked={Boolean(settings.showZoomButtons)}
                  onToggle={() => updateSetting('showZoomButtons', !settings.showZoomButtons)}
                  testId="setting-show-zoom-buttons"
                />
                <SettingSwitchRow
                  label="Reset View Button"
                  description="Show a quick button to fit the puzzle to your screen"
                  checked={Boolean(settings.showResetViewButton)}
                  onToggle={() =>
                    updateSetting('showResetViewButton', !settings.showResetViewButton)
                  }
                  testId="setting-show-reset-view-button"
                />
                {!NativeBridge.isAndroid && onToggleFullscreen && (
                  <SettingSwitchRow
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

              {/* 4. Navigation & Zoom */}
              <SettingSectionCard
                title="Navigation & Zoom"
                icon={<Compass size={13} />}
                testId="settings-section-navigation"
              >
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                  <SettingSwitchRow
                    label="Smooth Pan Momentum"
                    description="Let the canvas glide smoothly after a quick flick"
                    checked={Boolean(settings.panMomentum)}
                    onToggle={() => updateSetting('panMomentum', !settings.panMomentum)}
                    testId="setting-pan-momentum"
                  />
                  <SettingSwitchRow
                    label="Invert Double-Tap Zoom"
                    description="Drag up to zoom in and drag down to zoom out"
                    checked={Boolean(settings.reverseDoubleTapZoom)}
                    onToggle={() =>
                      updateSetting('reverseDoubleTapZoom', !settings.reverseDoubleTapZoom)
                    }
                    testId="setting-reverse-double-tap-zoom"
                  />
                  <SettingSwitchRow
                    label="Snap to Zoom Stops"
                    description="Gently snap to 1x, 2x, 4x, 8x, and 12x zoom levels"
                    checked={Boolean(settings.snapZoomLevels)}
                    onToggle={() => updateSetting('snapZoomLevels', !settings.snapZoomLevels)}
                    testId="setting-snap-zoom-levels"
                  />
                </div>

                {/* Zoom Sensitivity */}
                <div className="space-y-1 p-2.5 rounded-xl bg-slate-900/55 border border-slate-800/75">
                  <div className="flex justify-between items-center text-xs">
                    <span className="text-slate-200 font-semibold">Zoom Sensitivity</span>
                    <span className="text-amber-400 font-mono font-bold">
                      {(settings.zoomSensitivity ?? 1.0).toFixed(1)}x
                    </span>
                  </div>
                  <input
                    type="range"
                    min="0.5"
                    max="2.0"
                    step="0.1"
                    aria-label="Zoom Sensitivity"
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
                  <div className="text-[11px] text-slate-400">
                    {NativeBridge.isAndroid
                      ? 'Adjust pinch and double-tap drag zoom speed'
                      : 'Adjust scroll, pinch, and double-tap drag zoom speed'}
                  </div>
                </div>
              </SettingSectionCard>

              {/* 5. Sound, Haptics & Accessibility */}
              <SettingSectionCard
                title="Sound, Haptics & Accessibility"
                icon={<Volume2 size={13} />}
                testId="settings-section-audio-a11y"
              >
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                  <SettingSwitchRow
                    label="Sound Effects"
                    description="Soft woodblock and brush tap sounds while painting"
                    checked={settings.soundEnabled !== false}
                    onToggle={() =>
                      updateSetting('soundEnabled', !(settings.soundEnabled !== false))
                    }
                    testId="setting-sound-enabled"
                  />
                  <SettingSwitchRow
                    label="Haptic Feedback"
                    description="Gentle vibration feedback when painting and finishing colors"
                    checked={Boolean(settings.hapticsEnabled)}
                    onToggle={() => updateSetting('hapticsEnabled', !settings.hapticsEnabled)}
                    testId="setting-haptics"
                  />
                  <SettingSwitchRow
                    label="Large Text & Buttons"
                    description="Enlarge text, buttons, and numbers, and turn on Tap Assist"
                    checked={Boolean(settings.largeText)}
                    onToggle={() => {
                      const nextLargeText = !settings.largeText;
                      if (nextLargeText) {
                        updateSettings({ largeText: true, fatFingerAssist: true });
                      } else {
                        updateSetting('largeText', false);
                      }
                    }}
                    testId="setting-large-text"
                  />
                  <SettingSwitchRow
                    label="Reduced Motion"
                    description="Skip confetti bursts, camera glides, and pulsing hints"
                    checked={Boolean(settings.reducedMotion)}
                    onToggle={() => updateSetting('reducedMotion', !settings.reducedMotion)}
                    testId="setting-reduced-motion"
                  />
                </div>

                {/* Sound Volume */}
                <div
                  className={`space-y-1 p-2.5 rounded-xl bg-slate-900/55 border border-slate-800/75 transition-opacity ${
                    settings.soundEnabled === false ? 'opacity-50' : 'opacity-100'
                  }`}
                >
                  <div className="flex justify-between items-center text-xs">
                    <span className="text-slate-200 font-semibold">Sound Volume</span>
                    <span className="text-amber-400 font-mono font-bold">
                      {settings.soundEnabled === false
                        ? 'Muted'
                        : `${Math.round((settings.soundVolume ?? 0.7) * 100)}%`}
                    </span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.05"
                    aria-label="Sound Volume"
                    disabled={settings.soundEnabled === false}
                    data-testid="setting-sound-volume"
                    value={settings.soundVolume ?? 0.7}
                    onChange={(e) =>
                      updateSetting(
                        'soundVolume',
                        Math.round(parseFloat(e.target.value) * 100) / 100
                      )
                    }
                    className={`w-full accent-amber-400 h-1.5 bg-slate-800 rounded-lg ${
                      settings.soundEnabled === false ? 'cursor-not-allowed' : 'cursor-pointer'
                    }`}
                  />
                </div>
              </SettingSectionCard>

              {/* 6a. Collapsible Replay Settings */}
              <CollapsibleSettingSection
                title="Replay"
                summary={`${settings.replaySpeed || 1}x • Auto-replay ${settings.autoReplayOnLoad ? 'On' : 'Off'}`}
                icon={<Film size={14} />}
                testId="settings-section-replay"
              >
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-semibold text-slate-300">Replay Speed</span>
                    <span className="font-mono font-bold text-amber-400">
                      {settings.replaySpeed || 1}x
                    </span>
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
                  <SettingSwitchRow
                    label="Replay on Load"
                    description="Play back your painting progress when opening a save"
                    checked={Boolean(settings.autoReplayOnLoad)}
                    onToggle={() => updateSetting('autoReplayOnLoad', !settings.autoReplayOnLoad)}
                    testId="toggle-auto-replay-btn"
                  />
                  <SettingSwitchRow
                    label="Follow Painting"
                    description="Pan the camera smoothly to follow each painted shape"
                    checked={Boolean(settings.replayFollow)}
                    onToggle={() => updateSetting('replayFollow', !settings.replayFollow)}
                    testId="toggle-replay-follow-btn"
                  />
                  <SettingSwitchRow
                    label="Auto-Loop Replay"
                    description="Restart the replay automatically when it finishes"
                    checked={Boolean(settings.replayLoop)}
                    onToggle={() => updateSetting('replayLoop', !settings.replayLoop)}
                    testId="toggle-replay-loop-btn"
                  />
                </div>
              </CollapsibleSettingSection>

              {/* 6b. Collapsible Number Label Sizing */}
              <CollapsibleSettingSection
                title="Number Label Sizing"
                summary={`${settings.minLabelSize ?? 6}–${settings.maxLabelSize ?? 18}px • ${Math.round(settings.labelScale * 100)}%`}
                icon={<Type size={14} />}
                testId="settings-section-labels"
                disabled={!settings.showRegionLabels}
                disabledNote="Turn on Show Numbers on Regions in Appearance to adjust label sizing."
              >
                {/* Min Size */}
                <div className="space-y-1 p-2.5 rounded-xl bg-slate-900/55 border border-slate-800/75">
                  <div className="flex justify-between items-center text-xs">
                    <span className="text-slate-200 font-semibold">Minimum Label Size</span>
                    <span className="text-amber-400 font-mono font-bold">
                      {settings.minLabelSize ?? 6} px
                    </span>
                  </div>
                  <input
                    type="range"
                    min="2"
                    max="14"
                    step="1"
                    aria-label="Minimum Label Size"
                    disabled={!settings.showRegionLabels}
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
                  <div className="text-[11px] text-slate-400">
                    Show tiny numbers earlier on high-res screens before zooming
                  </div>
                </div>

                {/* Max Size */}
                <div className="space-y-1 p-2.5 rounded-xl bg-slate-900/55 border border-slate-800/75">
                  <div className="flex justify-between items-center text-xs">
                    <span className="text-slate-200 font-semibold">Maximum Label Size</span>
                    <span className="text-amber-400 font-mono font-bold">
                      {settings.maxLabelSize ?? 18} px
                    </span>
                  </div>
                  <input
                    type="range"
                    min="10"
                    max="36"
                    step="1"
                    aria-label="Maximum Label Size"
                    disabled={!settings.showRegionLabels}
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
                  <div className="text-[11px] text-slate-400">
                    Cap number size inside large open shapes
                  </div>
                </div>

                {/* Overall Scale */}
                <div className="space-y-1 p-2.5 rounded-xl bg-slate-900/55 border border-slate-800/75">
                  <div className="flex justify-between items-center text-xs">
                    <span className="text-slate-200 font-semibold">Overall Scale</span>
                    <span className="text-amber-400 font-mono font-bold">
                      {Math.round(settings.labelScale * 100)}%
                    </span>
                  </div>
                  <input
                    type="range"
                    min="0.5"
                    max="2.0"
                    step="0.05"
                    aria-label="Overall Label Scale"
                    disabled={!settings.showRegionLabels}
                    value={settings.labelScale}
                    onChange={(e) => updateSetting('labelScale', parseFloat(e.target.value))}
                    className="w-full accent-amber-400 cursor-pointer h-1.5 bg-slate-800 rounded-lg"
                  />
                  <div className="text-[11px] text-slate-400">
                    Scale all region numbers up or down together
                  </div>
                </div>
              </CollapsibleSettingSection>
            </div>
          )}

          {/* TAB 2: HINTS */}
          {activeTab === 2 && (
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
                    {(
                      [
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
                      ] as const
                    ).map((style) => (
                      <button
                        key={style.key}
                        type="button"
                        onClick={() =>
                          updateSetting('highlightStyle', style.key as RegionHighlightStyle)
                        }
                        className={`flex flex-col text-left p-2.5 rounded-lg border transition-all cursor-pointer ${
                          settings.highlightStyle === style.key
                            ? 'border-amber-400 bg-slate-800/80 text-white ring-1 ring-amber-400'
                            : 'border-slate-800 bg-slate-900/50 text-slate-400 hover:bg-slate-800/50'
                        }`}
                      >
                        <span className="text-xs sm:text-sm font-bold text-slate-100">
                          {style.label}
                        </span>
                        <span className="text-[11px] text-slate-400 mt-0.5 leading-snug">
                          {style.desc}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Hint Highlight Color */}
                <div className="space-y-1.5 pt-1 border-t border-slate-800/60">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-slate-300">
                      Hint Highlight Color
                    </span>
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

                {/* Hint Fill Pattern (applies to Entire Region Fill) */}
                <div
                  className={`space-y-1.5 pt-1 border-t border-slate-800/60 transition-opacity ${
                    settings.highlightStyle === 'FULL_REGION' ? 'opacity-100' : 'opacity-50'
                  }`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-1">
                    <span className="text-xs font-semibold text-slate-300">Hint Fill Pattern</span>
                    {settings.highlightStyle !== 'FULL_REGION' && (
                      <span className="text-[10px] text-slate-400">
                        Applies when Entire Region Fill is selected
                      </span>
                    )}
                  </div>
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
                        disabled={settings.highlightStyle !== 'FULL_REGION'}
                        onClick={() => updateSetting('hintFillStyle', pat.key as HintFillStyle)}
                        className={`min-h-[38px] py-2 px-1.5 rounded-lg border text-xs font-bold text-center transition-all ${
                          settings.highlightStyle !== 'FULL_REGION'
                            ? 'cursor-not-allowed'
                            : 'cursor-pointer'
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
                <div className="space-y-1.5 p-2.5 rounded-xl bg-slate-900/55 border border-slate-800/75">
                  <div className="flex justify-between items-center text-xs sm:text-sm font-semibold">
                    <span className="text-slate-200">Hint Intensity</span>
                    <span className="text-amber-400 font-mono font-bold">
                      {Math.round(settings.hintIntensity * 100)}%
                    </span>
                  </div>
                  <input
                    type="range"
                    min="0.2"
                    max="1.0"
                    step="0.05"
                    aria-label="Hint Intensity"
                    value={settings.hintIntensity}
                    onChange={(e) => updateSetting('hintIntensity', parseFloat(e.target.value))}
                    className="w-full accent-amber-400 cursor-pointer h-1.5 bg-slate-800 rounded-lg"
                  />
                </div>
              </SettingSectionCard>

              <SettingSectionCard
                title="Assistance & Animation"
                icon={<Lightbulb size={13} />}
                testId="hints-section-assist"
                columns={2}
              >
                <SettingSwitchRow
                  label="Highlight Every Matching Region"
                  description="Highlight all unfinished shapes of the active color"
                  checked={Boolean(settings.highlightMatching)}
                  onToggle={() => updateSetting('highlightMatching', !settings.highlightMatching)}
                  testId="setting-highlight-matching"
                />
                <SettingSwitchRow
                  label="Animate Hint Pulse"
                  description="Add a gentle breathing pulse to hints and active swatches"
                  checked={Boolean(settings.animateHint)}
                  onToggle={() => updateSetting('animateHint', !settings.animateHint)}
                  testId="setting-animate-hint"
                />
                <SettingSwitchRow
                  label="Pan to Center Region"
                  description="Smoothly pan to the next hinted shape when zoomed in"
                  checked={Boolean(settings.showNextRegionHint)}
                  onToggle={() =>
                    updateSetting('showNextRegionHint', !settings.showNextRegionHint)
                  }
                  testId="setting-show-next-region-hint"
                />
              </SettingSectionCard>
            </div>
          )}

          {/* TAB 3: CREATE / GENERATOR */}
          {activeTab === 3 && (
            <div className="space-y-4 sm:space-y-5">
              {/* Deterministic Offline UTC Puzzle of the Day Hero Card */}
              <div
                data-testid="daily-puzzle-card"
                className="relative overflow-hidden rounded-xl border border-amber-400/40 bg-gradient-to-br from-slate-900 via-slate-950 to-amber-950/25 p-3 sm:p-3.5 shadow-lg space-y-2"
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
                      {renderHintButton('daily-puzzle', 'Puzzle of the Day')}
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
                      onSelectSample(dailyPuzzle.sample, dailyPuzzle.config, dailyPuzzle.snapshotId);
                      onClose();
                    }}
                    className="w-full sm:w-auto flex-shrink-0 inline-flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-lg bg-amber-400 hover:bg-amber-300 text-slate-950 text-xs sm:text-sm font-extrabold shadow-md transition-colors cursor-pointer"
                  >
                    <Play size={14} className="fill-current" />
                    <span>Play Daily</span>
                  </button>
                </div>
                {renderHintCallout(
                  'daily-puzzle',
                  'Deterministic daily challenge paired cleanly across every device by UTC date. All 20 daily combinations are pre-baked at Max Detail (2048p • up to 2000 pieces • 64 colors, or 20 colors in Free Color mode) for instant zero-wait play.'
                )}
              </div>

              {/* Above-the-Fold Style Guide & Hint Quick-Jump Bar */}
              {(() => {
                const isDefaultCfg = matchesGeneratorConfig(localConfig, DEFAULT_GENERATOR_CONFIG);
                const isMaxCfg = matchesGeneratorConfig(localConfig, MAX_GENERATOR_CONFIG);
                return (
                  <div
                    data-testid="create-style-hint-bar"
                    className="flex flex-wrap items-center justify-between gap-2 px-2.5 py-2 rounded-xl border border-slate-800 bg-slate-950/75"
                  >
                    <div className="flex items-start gap-1.5 flex-1 min-w-0 text-[11px] text-slate-300 leading-snug">
                      <Info size={13} className="text-amber-400 flex-shrink-0 mt-0.5" />
                      <span className="min-w-0 break-words">
                        <span className="font-bold text-slate-100">Active Mode:</span>{' '}
                        {isDefaultCfg
                          ? 'Built-in Gallery: Max Detail • Photo Uploads: Auto (16 colors)'
                          : isMaxCfg
                            ? `Max Detail (${localConfig.colorCount} colors • ${localConfig.maxRegions || 2000} pieces)`
                            : `Custom (${localConfig.colorCount} colors • ${localConfig.maxRegions || 200} pieces • ${localConfig.resolution}p)`}
                      </span>
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5 flex-shrink-0">
                      <button
                        type="button"
                        data-testid="create-hint-style-guide-btn"
                        onClick={() => {
                          setShowPresetGallery(true);
                          onExplorePresetGallery?.();
                          requestAnimationFrame(() => {
                            presetGallerySectionRef.current?.scrollIntoView({
                              behavior: 'smooth',
                              block: 'start',
                            });
                          });
                        }}
                        className="px-2 py-1 rounded-lg bg-amber-400/15 hover:bg-amber-400/25 border border-amber-400/40 text-amber-300 text-[11px] font-bold transition-colors cursor-pointer"
                      >
                        Style Guide (10)
                      </button>
                      <button
                        type="button"
                        data-testid="create-hint-options-btn"
                        onClick={() => {
                          setOpenHintId('algorithm');
                          requestAnimationFrame(() => {
                            createOptionsSectionRef.current?.scrollIntoView({
                              behavior: 'smooth',
                              block: 'start',
                            });
                          });
                        }}
                        className="px-2 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 text-[11px] font-bold transition-colors cursor-pointer"
                      >
                        Hint &amp; Options
                      </button>
                    </div>
                  </div>
                );
              })()}

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
                                Free Color
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
              <div className="space-y-2">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <button
                      type="button"
                      data-testid="create-upload-photo-btn"
                      onClick={() => {
                        onUploadImage();
                        onClose();
                      }}
                      className="flex-1 min-w-0 flex items-center justify-center gap-2 p-2.5 sm:p-3 rounded-xl border border-amber-400/40 bg-amber-400/10 text-amber-300 hover:bg-amber-400/20 text-xs sm:text-sm font-bold transition-colors cursor-pointer"
                    >
                      <ImageIcon size={16} className="flex-shrink-0" />
                      <span className="truncate">Choose Photo from Device</span>
                    </button>
                    {renderHintButton('upload-photo', 'Choose Photo from Device')}
                  </div>

                  {onZoomIntoDetailTile && sourceImage && (
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        data-testid="infinite-zoom-subtile-btn"
                        onClick={() => {
                          onZoomIntoDetailTile();
                          onClose();
                        }}
                        title="Generate a higher-detail 2x zoomed sub-puzzle from the center of your current view"
                        className="flex-1 min-w-0 flex items-center justify-center gap-2 p-2.5 sm:p-3 rounded-xl border border-sky-400/40 bg-sky-500/10 text-sky-300 hover:bg-sky-500/20 text-xs sm:text-sm font-bold transition-colors cursor-pointer"
                      >
                        <ZoomIn size={16} className="flex-shrink-0" />
                        <span className="truncate">Infinite Zoom 2x Detail Tile</span>
                      </button>
                      {renderHintButton('infinite-zoom', 'Infinite Zoom 2x Detail Tile')}
                    </div>
                  )}
                </div>
                {renderHintCallout(
                  'upload-photo',
                  'Pick any JPG, PNG, or WebP artwork or photo from your device and segment it locally using your chosen algorithm, colors, piece count, and resolution below.'
                )}
                {onZoomIntoDetailTile &&
                  sourceImage &&
                  renderHintCallout(
                    'infinite-zoom',
                    'Crops a 2x zoomed region around the center of your current canvas view and generates a fresh, higher-detail sub-puzzle from it.'
                  )}
              </div>

              {/* Preset Style Gallery & Visual Guide */}
              <div
                ref={presetGallerySectionRef}
                className="rounded-xl border border-amber-400/30 bg-slate-950/65 overflow-hidden"
              >
                <button
                  type="button"
                  data-testid="preset-gallery-toggle"
                  aria-expanded={showPresetGallery}
                  onClick={() => {
                    const next = !showPresetGallery;
                    setShowPresetGallery(next);
                    if (next) {
                      onExplorePresetGallery?.();
                    }
                  }}
                  className="w-full flex items-center justify-between gap-2 p-2.5 sm:p-3 text-left hover:bg-slate-900/60 transition-colors cursor-pointer"
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-xs font-extrabold text-amber-300">
                        Preset Style Gallery &amp; Visual Guide
                      </span>
                      <span className="px-1.5 py-0.5 rounded-full bg-amber-400/15 border border-amber-400/40 text-[10px] font-bold text-amber-200">
                        10 Presets
                      </span>
                    </div>
                    <p className="text-[10px] sm:text-[11px] text-slate-400 mt-0.5">
                      Compare real segmented previews of every algorithm, border mode, and detail preset
                    </p>
                  </div>
                  <span className="px-2.5 py-1 rounded-lg bg-slate-800 border border-slate-700 text-[11px] font-bold text-slate-200 flex-shrink-0">
                    {showPresetGallery ? 'Hide Guide' : 'Show Guide'}
                  </span>
                </button>

                {showPresetGallery && (
                  <div
                    data-testid="preset-gallery-panel"
                    className="border-t border-slate-800/80 p-2.5 sm:p-3 space-y-2.5"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Preset gallery categories">
                        {(
                          [
                            { key: 'ALL', label: 'All (10)' },
                            { key: 'ALGORITHM', label: 'Algorithms (5)' },
                            { key: 'BORDER', label: 'Black Borders (2)' },
                            { key: 'DETAIL', label: 'Detail & Size (3)' },
                          ] as const
                        ).map((cat) => (
                          <button
                            key={cat.key}
                            type="button"
                            data-testid={`preset-gallery-filter-${cat.key.toLowerCase()}`}
                            onClick={() => setPresetGalleryFilter(cat.key)}
                            className={`px-2 py-1 rounded-full text-[10px] font-bold border transition-colors cursor-pointer ${
                              presetGalleryFilter === cat.key
                                ? 'bg-amber-400 text-slate-950 border-amber-300'
                                : 'bg-slate-900 text-slate-300 border-slate-700 hover:border-slate-600'
                            }`}
                          >
                            {cat.label}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div
                      data-testid="preset-gallery-grid"
                      className="grid grid-cols-1 sm:grid-cols-2 gap-2.5"
                    >
                      {PRESET_GALLERY_ITEMS.filter(
                        (item) => presetGalleryFilter === 'ALL' || item.category === presetGalleryFilter
                      ).map((item) => {
                        const active = item.isMatch(localConfig);
                        return (
                          <div
                            key={item.id}
                            data-testid={`preset-card-${item.id}`}
                            className={`flex flex-col rounded-xl overflow-hidden border transition-all ${
                              active
                                ? 'border-amber-400 bg-slate-800/80 ring-1 ring-amber-400/70'
                                : 'border-slate-800 bg-slate-900/60 hover:border-slate-700'
                            }`}
                          >
                            <div className="relative h-32 w-full bg-slate-950 overflow-hidden">
                              <img
                                src={item.image}
                                alt={`${item.title} preset preview`}
                                loading="lazy"
                                className="w-full h-full object-cover"
                              />
                              <span className="absolute top-1.5 left-1.5 px-1.5 py-0.5 rounded bg-slate-950/85 border border-slate-700/80 text-[9px] font-extrabold uppercase tracking-wider text-amber-300">
                                {item.badge}
                              </span>
                              <span className="absolute bottom-1.5 right-1.5 px-1.5 py-0.5 rounded bg-slate-950/85 text-[9px] font-mono font-bold text-slate-200">
                                {item.stats}
                              </span>
                            </div>
                            <div className="p-2.5 flex-1 flex flex-col justify-between gap-2">
                              <div className="space-y-1">
                                <div className="text-xs font-extrabold text-slate-100">{item.title}</div>
                                <p className="text-[10px] text-slate-300 leading-snug">{item.howItWorks}</p>
                                <p className="text-[10px] text-slate-400 leading-snug">
                                  <span className="font-bold text-amber-300/90">Best for:</span> {item.bestFor}
                                </p>
                              </div>
                              <button
                                type="button"
                                data-testid={`preset-apply-${item.id}`}
                                onClick={() => {
                                  setLocalConfig((prev) => item.apply(prev));
                                  onExplorePresetGallery?.();
                                }}
                                className={`w-full py-1.5 rounded-lg text-[11px] font-extrabold transition-colors cursor-pointer ${
                                  active
                                    ? 'bg-amber-400 text-slate-950'
                                    : 'bg-slate-800 hover:bg-amber-400 hover:text-slate-950 text-amber-300 border border-slate-700'
                                }`}
                              >
                                {active ? 'Active Preset' : 'Apply Preset'}
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>

              {/* Generation Algorithm Strategy */}
              <div ref={createOptionsSectionRef} className="space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <label className="text-[11px] sm:text-xs font-bold uppercase tracking-wider text-slate-400">
                    Segmentation Algorithm
                  </label>
                  {renderHintButton('algorithm', 'Segmentation Algorithm')}
                </div>
                {renderHintCallout(
                  'algorithm',
                  'Controls how the puzzle engine divides the image into paintable regions: Auto Detect adapts to photos or line art, Line Art Tracer follows dark ink strokes, Painterly smooths photos, Posterized snaps crisp color edges, and Mosaic Cells creates even stained-glass tiles.'
                )}
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
                  <div className="flex items-center justify-between gap-2">
                    <label className="text-[11px] sm:text-xs font-bold uppercase tracking-wider text-amber-400">
                      Artwork Black Border Handling
                    </label>
                    {renderHintButton('border-handling', 'Artwork Black Border Handling')}
                  </div>
                  {renderHintCallout(
                    'border-handling',
                    'Boundaries Follow Artwork Lines keeps dark outlines as crisp dividers between regions; Continuous Black Line Region turns all black ink strokes into one paintable region.'
                  )}
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
                <div className="flex items-center justify-between gap-2">
                  <label className="text-[11px] sm:text-xs font-bold uppercase tracking-wider text-slate-400">
                    Detail Level Preset
                  </label>
                  {renderHintButton('detail-preset', 'Detail Level Preset')}
                </div>
                {renderHintCallout(
                  'detail-preset',
                  'Picks how many palette colors, max puzzle pieces, and minimum speckle sizes are extracted. Auto, Low, Medium, and High sync all three knobs; Custom keeps your manual slider adjustments.'
                )}
                <div className="grid grid-cols-3 sm:grid-cols-5 gap-1.5">
                  {(
                    [
                      { key: 'AUTO', label: 'Auto', colorCount: 16, maxRegions: 200, minRegionArea: 48 },
                      { key: 'LOW', label: 'Low (~8-12)', colorCount: 10, maxRegions: 100, minRegionArea: 96 },
                      { key: 'MEDIUM', label: 'Medium (~14-24)', colorCount: 18, maxRegions: 250, minRegionArea: 48 },
                      { key: 'HIGH', label: 'High (~30-50)', colorCount: 38, maxRegions: 500, minRegionArea: 24 },
                      { key: 'CUSTOM', label: 'Custom', colorCount: null, maxRegions: null, minRegionArea: null },
                    ] as const
                  ).map((det) => (
                    <button
                      key={det.key}
                      type="button"
                      data-testid={`detail-preset-${det.key.toLowerCase()}`}
                      onClick={() =>
                        setLocalConfig((prev) => ({
                          ...prev,
                          paletteDetail: det.key as PaletteDetail,
                          ...(det.colorCount !== null ? { colorCount: det.colorCount } : {}),
                          ...(det.maxRegions !== null ? { maxRegions: det.maxRegions } : {}),
                          ...(det.minRegionArea !== null ? { minRegionArea: det.minRegionArea } : {}),
                        }))
                      }
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
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="text-[11px] sm:text-xs font-bold uppercase tracking-wider text-slate-400">
                    Manual Fine-Tuning &amp; Constraints
                  </div>
                  <button
                    type="button"
                    data-testid="create-max-detail-preset-btn"
                    onClick={() =>
                      setLocalConfig((prev) => ({
                        ...MAX_GENERATOR_CONFIG,
                        algorithm: prev.algorithm || MAX_GENERATOR_CONFIG.algorithm,
                        lineHandling: prev.lineHandling || MAX_GENERATOR_CONFIG.lineHandling,
                        imageType: prev.imageType || MAX_GENERATOR_CONFIG.imageType,
                        ...(prev.isFreeColor !== undefined ? { isFreeColor: prev.isFreeColor } : {}),
                      }))
                    }
                    className={`px-2 py-1 rounded-md border text-[10px] font-extrabold transition-all cursor-pointer ${
                      localConfig.paletteDetail === 'CUSTOM' &&
                      localConfig.colorCount === MAX_GENERATOR_CONFIG.colorCount &&
                      localConfig.maxRegions === MAX_GENERATOR_CONFIG.maxRegions &&
                      localConfig.minRegionArea === MAX_GENERATOR_CONFIG.minRegionArea &&
                      localConfig.resolution === MAX_GENERATOR_CONFIG.resolution
                        ? 'border-amber-400 bg-amber-400 text-slate-950 shadow-xs'
                        : 'border-amber-400/40 bg-amber-400/10 text-amber-300 hover:bg-amber-400/20'
                    }`}
                  >
                    Max Detail (64c • 2000 • 2048p)
                  </button>
                </div>

                {/* Colors Count */}
                <div className="space-y-1">
                  <div className="flex flex-wrap justify-between items-center gap-1 text-xs font-semibold">
                    <span className="inline-flex items-center gap-1.5 text-slate-300">
                      <span>Target Palette Colors</span>
                      {renderHintButton('color-count', 'Target Palette Colors')}
                    </span>
                    <span className="text-amber-400 font-mono font-bold">
                      {localConfig.paletteDetail === 'CUSTOM'
                        ? `${localConfig.colorCount} colors (Custom)`
                        : `Auto-tuned (${localConfig.paletteDetail.toLowerCase()})`}
                    </span>
                  </div>
                  {renderHintCallout(
                    'color-count',
                    'Sets the exact number of color swatches (4 to 64). Moving this slider automatically switches Detail Level Preset to Custom.'
                  )}
                  <input
                    type="range"
                    min="4"
                    max="64"
                    step="1"
                    value={localConfig.colorCount}
                    onChange={(e) =>
                      setLocalConfig((prev) => ({
                        ...prev,
                        paletteDetail: 'CUSTOM',
                        colorCount: parseInt(e.target.value),
                      }))
                    }
                    className="w-full accent-amber-400 cursor-pointer h-1.5 bg-slate-800 rounded-lg"
                  />
                  {localConfig.paletteDetail !== 'CUSTOM' && (
                    <p className="text-[10px] text-slate-400">
                      Preset picks the best color count for your artwork; drag slider to switch to Custom ({localConfig.colorCount}).
                    </p>
                  )}
                </div>

                {/* Max Regions (Piece Count) */}
                <div className="space-y-1.5">
                  <div className="flex flex-wrap justify-between items-center gap-1 text-xs font-semibold">
                    <span className="inline-flex items-center gap-1.5 text-slate-300">
                      <span>Max Regions (Puzzle Pieces)</span>
                      {renderHintButton('max-regions', 'Max Regions (Puzzle Pieces)')}
                    </span>
                    <span className="text-amber-400 font-mono font-bold">
                      {localConfig.maxRegions || 200} max pieces
                    </span>
                  </div>
                  {renderHintCallout(
                    'max-regions',
                    'Caps the maximum number of playable puzzle pieces (40 to 2000). Higher values preserve intricate details; lower values create faster, relaxing puzzles.'
                  )}
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
                  <div className="flex flex-wrap justify-between items-center gap-1 text-xs font-semibold">
                    <span className="inline-flex items-center gap-1.5 text-slate-300">
                      <span>Minimum Region Area</span>
                      {renderHintButton('min-region-area', 'Minimum Region Area')}
                    </span>
                    <span className="text-amber-400 font-mono font-bold">
                      {localConfig.minRegionArea} px²
                    </span>
                  </div>
                  {renderHintCallout(
                    'min-region-area',
                    'Merges tiny speckles smaller than this pixel area into neighboring regions. Lower values (15-24 px²) keep tiny details; higher values make larger, easier-to-tap pieces.'
                  )}
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
                  <div className="flex flex-wrap justify-between items-center gap-1 text-xs font-semibold">
                    <span className="inline-flex items-center gap-1.5 text-slate-300">
                      <span>Max Canvas Resolution</span>
                      {renderHintButton('max-resolution', 'Max Canvas Resolution')}
                    </span>
                    <span className="text-amber-400 font-mono font-bold">
                      {localConfig.resolution} px
                    </span>
                  </div>
                  {renderHintCallout(
                    'max-resolution',
                    'Sets the longest edge (480p to 2048p) used when segmenting the artwork. Higher resolutions produce sharper curves and crisp numbers at deep zoom.'
                  )}

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

                {/* Detailed Generation Progress (Relocated from Tab 1 Settings) */}
                <div className="pt-2 border-t border-slate-800/70">
                  <SettingSwitchRow
                    label="Detailed Generation Progress"
                    description="Show step-by-step progress while creating a puzzle (slightly slower)"
                    checked={Boolean(settings.detailedLoadingProgress)}
                    onToggle={() =>
                      updateSetting('detailedLoadingProgress', !settings.detailedLoadingProgress)
                    }
                    testId="setting-detailed-progress"
                  />
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

              {/* Puzzle Idea Notebook (Local Idea Notebook) */}
              <div
                data-testid="community-ideas-section"
                className="p-3 rounded-xl bg-slate-950/65 border border-slate-800 space-y-2.5"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5">
                    <Lightbulb size={15} className="text-amber-400" />
                    <span className="text-xs font-extrabold text-slate-200">
                      Puzzle Idea Notebook
                    </span>
                  </div>

                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      data-testid="toggle-idea-form-btn"
                      onClick={() => {
                        setShowIdeaForm((v) => !v);
                        setIdeaFeedback(null);
                      }}
                      className="px-2.5 py-1 rounded-lg bg-amber-400 text-slate-950 text-[11px] font-extrabold hover:bg-amber-300 transition-colors cursor-pointer"
                    >
                      {showIdeaForm ? 'Close' : '+ Add Idea'}
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
                      placeholder="Describe colors, mood, or style for a future puzzle idea..."
                      rows={2}
                      maxLength={280}
                      className="w-full px-2.5 py-1.5 rounded-lg bg-slate-950 border border-slate-700 text-xs text-slate-100 focus:outline-none focus:border-amber-400 resize-none"
                    />
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[10px] text-slate-400">
                        Saved locally in your puzzle idea notebook on this device.
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
                          setIdeaFeedback('Idea saved to your local puzzle notebook!');
                        }}
                        className="px-3 py-1.5 rounded-lg bg-amber-400 text-slate-950 text-xs font-extrabold hover:bg-amber-300 cursor-pointer"
                      >
                        Save Idea
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
                      <div className="min-w-0 flex-1">
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
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* TAB 4: SAVES / SNAPSHOTS */}
          {activeTab === 4 && (
            <div className="space-y-3.5">
              {/* Snapshots Content: List First (Thumbnails Default) or Empty Recovery */}
              {snapshots.length > 0 ? (
                <div data-testid="saves-list-section" data-view-mode={savesViewMode}>
                  {savesViewMode === 'DETAIL' ? (
                    /* Detail List View */
                    <div data-testid="saves-list-detail" className="space-y-2">
                      {sortedSnapshots.map((snap) => {
                        const isActive = snap.id === activeSnapshotId;
                        const isSelected = snap.id === currentSelectedId;
                        const progressPct = computeProgressPercentage(snap.filledCount, snap.totalCount);
                        const { thumbSrc } = resolveSafeSnapshotThumbnail(snap, failedThumbSrcs);

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
                                  onError={() =>
                                    setFailedThumbSrcs((prev) => ({ ...prev, [thumbSrc]: true }))
                                  }
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
                    <div data-testid="saves-list-thumbnails" className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
                      {sortedSnapshots.map((snap) => {
                        const isActive = snap.id === activeSnapshotId;
                        const isSelected = snap.id === currentSelectedId;
                        const progressPct = computeProgressPercentage(snap.filledCount, snap.totalCount);
                        const { thumbSrc } = resolveSafeSnapshotThumbnail(snap, failedThumbSrcs);

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
                                  onError={() =>
                                    setFailedThumbSrcs((prev) => ({ ...prev, [thumbSrc]: true }))
                                  }
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
                </div>
              ) : (
                <div
                  data-testid="saves-empty-recovery"
                  className="text-center py-8 px-4 space-y-3 rounded-xl border border-dashed border-slate-800 bg-slate-950/40 text-slate-400 text-sm"
                >
                  <p>No saved puzzles yet. Load an image, import a .capy save, or restore the starter artwork.</p>
                  {onRestoreStarterSample && (
                    <button
                      type="button"
                      data-testid="restore-starter-sample-btn"
                      onClick={onRestoreStarterSample}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-400 text-slate-950 text-xs font-bold hover:bg-amber-300 transition-colors cursor-pointer"
                    >
                      <RefreshCw size={13} />
                      <span>Restore Capy Forest Starter</span>
                    </button>
                  )}
                </div>
              )}

              {/* Static Selection, View Mode & Bulk Library Actions */}
              <div
                data-testid="selected-save-action-bar"
                className="p-2.5 sm:p-3 rounded-xl bg-slate-950/85 border border-slate-800 shadow-md space-y-2.5"
              >
                {/* Row 1: Options & View Mode Switcher */}
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2 sm:gap-2.5">
                    <select
                      aria-label="Sort saved puzzles"
                      value={settings.saveSortOrder}
                      onChange={(e) =>
                        updateSetting('saveSortOrder', e.target.value as SaveSortOrder)
                      }
                      className="bg-slate-800 text-slate-200 text-xs font-semibold rounded-lg px-2.5 py-1.5 border border-slate-700 cursor-pointer"
                    >
                      <option value="LAST_ACTIVE">Last Active</option>
                      <option value="DATE">Date Created</option>
                      <option value="PERCENT_COMPLETE">Completion</option>
                    </select>
                  </div>

                  {/* Detail vs Thumbnails View Mode Toggle */}
                  <div className="flex items-center bg-slate-900 p-0.5 rounded-lg border border-slate-800">
                    <button
                      type="button"
                      data-testid="saves-view-detail-btn"
                      aria-pressed={savesViewMode === 'DETAIL'}
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
                      aria-pressed={savesViewMode === 'THUMBNAILS'}
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
                          className="px-2 py-1 rounded-lg text-xs font-bold text-red-400 hover:text-red-300 hover:bg-red-950/30 transition-colors cursor-pointer"
                        >
                          Delete All Saves
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>

              {/* Inline Accessible Import Status Banner */}
              {importNotice && (
                <div
                  role={importNotice.ok ? 'status' : 'alert'}
                  data-testid="saves-import-notice"
                  className={`flex items-center justify-between gap-2 px-3 py-2 rounded-xl border text-xs font-semibold ${
                    importNotice.ok
                      ? 'bg-emerald-950/60 border-emerald-500/40 text-emerald-300'
                      : 'bg-red-950/60 border-red-500/40 text-red-300'
                  }`}
                >
                  <span>{importNotice.message}</span>
                  <button
                    type="button"
                    aria-label="Dismiss import message"
                    onClick={() => setImportNotice(null)}
                    className="capy-icon-btn p-0.5 rounded hover:bg-white/10 cursor-pointer"
                  >
                    <X size={13} />
                  </button>
                </div>
              )}

              {/* Cloud Sync, Shareable Link & Live Simultaneous Co-op Hub (opt-in until EPIC-3/EPIC-5) */}
              {showCloudCoopUi ? (
              <div
                data-testid="cloud-coop-hub"
                className="p-3 rounded-xl bg-slate-950/75 border border-slate-800 space-y-3"
              >
                <CloudAccountCard
                  playerIdentity={playerIdentity}
                  cloudProviders={cloudProviders}
                  isSyncingCloud={isSyncingCloud}
                  cloudSyncStatus={cloudSyncStatus}
                  lastCloudSyncError={lastCloudSyncError}
                  onSyncingChange={setIsSyncingCloud}
                  onHubNotice={setHubNotice}
                  onSyncCloudProgress={onSyncCloudProgress}
                />

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
                              const rawCode = joinCodeInput.trim();
                              if (!rawCode) return;
                              try {
                                const ok = await onJoinCoopRoom(rawCode);
                                if (ok) {
                                  setHubNotice(`Joined Co-op Room ${rawCode.toUpperCase()}!`);
                                  setJoinCodeInput('');
                                } else {
                                  setHubNotice('Enter a valid 4-8 character Co-op room code.');
                                }
                              } catch {
                                setHubNotice('Unable to join Co-op room. Check code and try again.');
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
              ) : (
              <div
                data-testid="saves-share-print-bar"
                className="p-3 rounded-xl bg-slate-950/75 border border-slate-800 space-y-2"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
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
                  <span className="text-[11px] text-slate-400">
                    Saves stored locally on this device
                  </span>
                </div>

                {hubNotice && (
                  <div
                    data-testid="cloud-coop-notice"
                    className="px-2.5 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-[11px] font-semibold text-amber-300"
                  >
                    {hubNotice}
                  </div>
                )}
              </div>
              )}

              {/* Hidden file input for Import */}
              <input
                ref={fileInputRef}
                type="file"
                accept=".capy,.json,application/json,application/octet-stream"
                className="hidden"
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (e.target) e.target.value = '';
                  if (!file || !onImportSnapshots) return;
                  try {
                    const res = await onImportSnapshots(file);
                    if (res && typeof res === 'object' && 'message' in res) {
                      setImportNotice({ ok: Boolean(res.ok), message: res.message });
                    }
                  } catch (err) {
                    setImportNotice({
                      ok: false,
                      message:
                        err instanceof Error ? err.message : 'Failed to import Capy save file.',
                    });
                  }
                }}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
