import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  AlertTriangle,
  ArrowLeftRight,
  Check,
  Cpu,
  Expand,
  ExternalLink,
  Info,
  KeyRound,
  Layers,
  Loader2,
  Sparkles,
  Trash2,
  X,
  ZoomIn,
} from 'lucide-react';
import {
  BorderExtensionSides,
  ByokProviderMode,
  GuidedAiAppId,
  InfiniteZoomModelId,
  InfiniteZoomProviderMode,
  NanoBananaModelId,
  NanoBananaResolution,
  OpenAiImageModelId,
  OpenRouterImageModelId,
  XaiImageModelId,
} from '../types';
import { NativeBridge } from '../services/NativeBridge';
import { useIsomorphicLayoutEffect } from '../hooks/useLatest';
import {
  DEFAULT_NANO_BANANA_MODEL,
  getGuidedAiAppMeta,
  getNanoBananaModelMeta,
  GOOGLE_AI_STUDIO_KEY_URL,
  GUIDED_AI_APPS,
  MAX_USER_PROMPT_LENGTH,
  NANO_BANANA_MODELS,
  resolveSupportedModelResolution,
} from '../services/ai/NanoBananaService';
import {
  DEFAULT_OPENAI_IMAGE_MODEL,
  DEFAULT_OPENROUTER_MODEL,
  DEFAULT_XAI_IMAGE_MODEL,
  getOpenAiImageModelMeta,
  getOpenRouterModelMeta,
  getXaiImageModelMeta,
  OPENAI_API_KEYS_URL,
  OPENAI_IMAGE_MODELS,
  OPENROUTER_IMAGE_MODELS,
  resolveSupportedOpenRouterResolution,
  XAI_CONSOLE_KEYS_URL,
  XAI_IMAGE_MODELS,
} from '../services/ai/MultiProviderAiService';
import {
  connectOpenRouterWithPkce,
  OPENROUTER_KEYS_CONSOLE_URL,
} from '../services/ai/openRouterAuth';
import {
  clearProviderByokApiKey,
  hasProviderByokApiKey,
  saveProviderByokApiKey,
} from '../services/storage/SettingsStorage';
import { SelectionMetrics } from '../services/ai/RegionSelectionEngine';
import { canExtendSides, ExtendSidesCheck } from '../services/ai/SeamCompositor';

export const DEFAULT_EXTEND_SIDES: BorderExtensionSides = {
  top: true,
  bottom: true,
  left: true,
  right: true,
};

const ZOOM_IN_CHIPS = [
  'Tiny flowers',
  'Leaf veins',
  'Pebbles & moss',
  'Sparkling ripples',
] as const;

const ZOOM_OUT_CHIPS = [
  'Starry hills',
  'Lush forest',
  'Calm lake',
  'Fluffy clouds',
] as const;

const SIDE_OPTIONS: ReadonlyArray<{ key: keyof BorderExtensionSides; label: string }> = [
  { key: 'top', label: 'Top' },
  { key: 'bottom', label: 'Bottom' },
  { key: 'left', label: 'Left' },
  { key: 'right', label: 'Right' },
];

const PROVIDER_SHORT_LABELS: Record<InfiniteZoomProviderMode, string> = {
  PUTER: 'Puter',
  GUIDED_GEMINI: 'Guided Gemini',
  OPENROUTER: 'OpenRouter',
  GEMINI_BYOK: 'Gemini BYOK',
  OPENAI_BYOK: 'OpenAI BYOK',
  XAI_BYOK: 'xAI Grok BYOK',
};

const MODEL_SELECT_LABELS: Record<NanoBananaModelId, string> = {
  'gemini-nano-banana-2.1': 'Nano Banana 2.1 (Recommended)',
  'gemini-3.1-flash-lite-image': 'Nano Banana 2 Lite (Fastest)',
  'gemini-3.1-flash-image': 'Nano Banana 2 (Pro)',
};

export interface ProviderOptionItem {
  value: InfiniteZoomProviderMode;
  label: string;
}

export function getAvailableProviderOptions(isAndroid: boolean): readonly ProviderOptionItem[] {
  if (isAndroid) {
    return [
      { value: 'GUIDED_GEMINI', label: 'Free AI App (Guided: Gemini / ChatGPT / Grok)' },
      { value: 'OPENROUTER', label: 'OpenRouter (1-Click OAuth / Multi-Model)' },
      { value: 'GEMINI_BYOK', label: 'Gemini API Key (BYOK)' },
      { value: 'OPENAI_BYOK', label: 'ChatGPT / OpenAI API Key (BYOK)' },
      { value: 'XAI_BYOK', label: 'Grok / xAI API Key (BYOK)' },
    ];
  }
  return [
    { value: 'PUTER', label: 'Puter (Free 1-Click)' },
    { value: 'OPENROUTER', label: 'OpenRouter (1-Click OAuth / Multi-Model)' },
    { value: 'GUIDED_GEMINI', label: 'Free AI App (Guided: Gemini / ChatGPT / Grok)' },
    { value: 'GEMINI_BYOK', label: 'Gemini API Key (BYOK)' },
    { value: 'OPENAI_BYOK', label: 'ChatGPT / OpenAI API Key (BYOK)' },
    { value: 'XAI_BYOK', label: 'Grok / xAI API Key (BYOK)' },
  ];
}

export function resolveVisibleProvider(
  provider: InfiniteZoomProviderMode,
  isAndroid: boolean
): InfiniteZoomProviderMode {
  if (isAndroid && provider === 'PUTER') {
    return 'GUIDED_GEMINI';
  }
  return provider;
}

export function formatActiveProviderModelPill(
  provider: InfiniteZoomProviderMode,
  model: InfiniteZoomModelId,
  isAndroid: boolean = NativeBridge.isAndroidNative(),
  guidedAiApp?: GuidedAiAppId
): string {
  const effectiveProvider = resolveVisibleProvider(provider, isAndroid);
  if (effectiveProvider === 'OPENROUTER') {
    const meta = getOpenRouterModelMeta(model);
    return `${meta.shortLabel} • ${PROVIDER_SHORT_LABELS.OPENROUTER}`;
  }
  if (effectiveProvider === 'OPENAI_BYOK') {
    const meta = getOpenAiImageModelMeta(model);
    return `${meta.shortLabel} • ${PROVIDER_SHORT_LABELS.OPENAI_BYOK}`;
  }
  if (effectiveProvider === 'XAI_BYOK') {
    const meta = getXaiImageModelMeta(model);
    return `${meta.shortLabel} • ${PROVIDER_SHORT_LABELS.XAI_BYOK}`;
  }
  const modelMeta = getNanoBananaModelMeta(model);
  if (effectiveProvider === 'GUIDED_GEMINI' && guidedAiApp && guidedAiApp !== 'GEMINI') {
    const appMeta = getGuidedAiAppMeta(guidedAiApp);
    return `Guided ${appMeta.shortLabel} • Free`;
  }
  return `Nano Banana ${modelMeta.shortLabel} • ${PROVIDER_SHORT_LABELS[effectiveProvider]}`;
}

interface SideToggleRowProps {
  sides: BorderExtensionSides;
  testIdPrefix: string;
  disabled?: boolean;
  onToggle: (key: keyof BorderExtensionSides) => void;
}

const SideToggleRow: React.FC<SideToggleRowProps> = ({
  sides,
  testIdPrefix,
  disabled = false,
  onToggle,
}) => (
  <div className="grid grid-cols-4 gap-1">
    {SIDE_OPTIONS.map(({ key, label }) => {
      const active = sides[key];
      return (
        <button
          key={key}
          type="button"
          data-testid={`${testIdPrefix}-${key}`}
          aria-pressed={active}
          disabled={disabled}
          onClick={() => onToggle(key)}
          className={`inline-flex items-center justify-center min-h-[44px] min-w-[44px] px-1.5 py-1 rounded-lg text-[11px] font-bold border transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${
            active
              ? 'bg-sky-500/25 text-sky-200 border-sky-400/70'
              : 'bg-slate-900/90 text-slate-400 border-slate-700/70 hover:text-slate-200'
          }`}
        >
          {label}
        </button>
      );
    })}
  </div>
);

interface PromptChipsRowProps {
  chips: readonly string[];
  activePrompt: string;
  disabled?: boolean;
  onSelect: (chip: string) => void;
}

const PromptChipsRow: React.FC<PromptChipsRowProps> = ({
  chips,
  activePrompt,
  disabled = false,
  onSelect,
}) => (
  <div className="flex flex-nowrap overflow-x-auto no-scrollbar gap-1.5 pb-0.5">
    {chips.map((chip) => {
      const isSelected = activePrompt.trim().toLowerCase() === chip.toLowerCase();
      return (
        <button
          key={chip}
          type="button"
          disabled={disabled}
          onClick={() => onSelect(chip)}
          className={`capy-prompt-chip flex-shrink-0 whitespace-nowrap px-2 py-0.5 rounded-full text-[11px] font-semibold border transition-colors cursor-pointer disabled:opacity-50 ${
            isSelected
              ? 'bg-amber-400/20 text-amber-200 border-amber-400/60'
              : 'bg-slate-800/90 text-slate-300 border-slate-700 hover:border-slate-500'
          }`}
        >
          {chip}
        </button>
      );
    })}
  </div>
);

export interface InfiniteZoomToolbarButtonProps {
  disabled?: boolean;
  disabledReason?: string;
  sourceWidth: number;
  sourceHeight: number;
  prompt: string;
  provider?: InfiniteZoomProviderMode;
  model?: InfiniteZoomModelId;
  guidedAiApp?: GuidedAiAppId;
  onPromptChange: (next: string) => void;
  onEnterSelectionMode: () => void;
  onConfirmExtendBorders: (sides: BorderExtensionSides, prompt: string) => void;
  onOpenProviderSettings?: () => void;
}

export const InfiniteZoomToolbarButton: React.FC<InfiniteZoomToolbarButtonProps> = React.memo(
  ({
    disabled = false,
    disabledReason,
    sourceWidth,
    sourceHeight,
    prompt,
    provider,
    model = DEFAULT_NANO_BANANA_MODEL,
    guidedAiApp,
    onPromptChange,
    onEnterSelectionMode,
    onConfirmExtendBorders,
    onOpenProviderSettings,
  }) => {
    const isAndroid = NativeBridge.isAndroidNative();
    const effectiveProvider: InfiniteZoomProviderMode = resolveVisibleProvider(
      provider ?? (isAndroid ? 'GUIDED_GEMINI' : 'PUTER'),
      isAndroid
    );
    const activeProviderPill = formatActiveProviderModelPill(
      effectiveProvider,
      model,
      isAndroid,
      guidedAiApp
    );
    const [isOpen, setIsOpen] = useState(false);
    const [showExtendConfig, setShowExtendConfig] = useState(false);
    const [prevDisabled, setPrevDisabled] = useState(disabled);
    const [sides, setSides] = useState<BorderExtensionSides>(DEFAULT_EXTEND_SIDES);
    const [popoverStyle, setPopoverStyle] = useState<{
      right: number;
      bottom: number;
      maxWidth: number;
      maxHeight: number;
    } | null>(null);
    const triggerRef = useRef<HTMLButtonElement | null>(null);
    const popoverRef = useRef<HTMLDivElement | null>(null);

    if (disabled !== prevDisabled) {
      setPrevDisabled(disabled);
      if (disabled) {
        if (isOpen) setIsOpen(false);
        if (showExtendConfig) setShowExtendConfig(false);
      }
    }

    const closePopover = useCallback(() => {
      setIsOpen(false);
      setShowExtendConfig(false);
    }, []);

    useEffect(() => {
      if (!isOpen || disabled) return;
      const popBack = NativeBridge.pushBackHandler(closePopover);
      const handleKeyDown = (e: KeyboardEvent) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          closePopover();
        }
      };
      const handlePointerDown = (e: PointerEvent) => {
        const target = e.target as Node | null;
        if (!target) return;
        if (triggerRef.current?.contains(target)) return;
        if (popoverRef.current?.contains(target)) return;
        closePopover();
      };
      window.addEventListener('keydown', handleKeyDown, true);
      window.addEventListener('pointerdown', handlePointerDown, true);
      return () => {
        popBack();
        window.removeEventListener('keydown', handleKeyDown, true);
        window.removeEventListener('pointerdown', handlePointerDown, true);
      };
    }, [isOpen, disabled, closePopover]);

    const extendCheck: ExtendSidesCheck = useMemo(
      () => canExtendSides(sourceWidth, sourceHeight, sides),
      [sourceWidth, sourceHeight, sides]
    );

    useIsomorphicLayoutEffect(() => {
      if (!isOpen || disabled || typeof window === 'undefined') {
        setPopoverStyle(null);
        return;
      }
      const updatePosition = () => {
        const triggerEl = triggerRef.current;
        if (!triggerEl) return;
        const triggerRect = triggerEl.getBoundingClientRect();
        const headerBottom =
          document.querySelector('header')?.getBoundingClientRect()?.bottom ?? 56;
        const minTop = Math.max(8, Math.ceil(headerBottom) + 6);
        const viewportW = window.innerWidth;
        const viewportH = window.innerHeight;
        const rawRight = Math.max(8, Math.round(viewportW - triggerRect.left + 8));
        const right = Math.min(rawRight, Math.max(8, viewportW - 188));
        const maxWidth = Math.min(288, Math.max(180, Math.floor(viewportW - right - 8)));

        const triggerFlushBottom = Math.max(8, Math.round(viewportH - triggerRect.bottom));
        const measuredHeight = popoverRef.current ? popoverRef.current.scrollHeight : 220;
        const spaceAboveTriggerBottom = viewportH - triggerFlushBottom - minTop;
        const bottom =
          measuredHeight <= spaceAboveTriggerBottom
            ? triggerFlushBottom
            : Math.max(8, triggerFlushBottom - (measuredHeight - spaceAboveTriggerBottom));
        const maxHeight = Math.max(80, Math.floor(viewportH - bottom - minTop));

        setPopoverStyle((prev) =>
          prev &&
          prev.right === right &&
          prev.bottom === bottom &&
          prev.maxWidth === maxWidth &&
          prev.maxHeight === maxHeight
            ? prev
            : { right, bottom, maxWidth, maxHeight }
        );
      };
      updatePosition();
      window.addEventListener('resize', updatePosition);
      window.addEventListener('scroll', updatePosition, { capture: true, passive: true });
      return () => {
        window.removeEventListener('resize', updatePosition);
        window.removeEventListener('scroll', updatePosition, true);
      };
    }, [isOpen, disabled, showExtendConfig, extendCheck.allowed, extendCheck.reason]);

    const handleToggleSide = useCallback((key: keyof BorderExtensionSides) => {
      setSides((prev) => ({ ...prev, [key]: !prev[key] }));
    }, []);

    const handleStartZoomIn = useCallback(() => {
      closePopover();
      onEnterSelectionMode();
    }, [closePopover, onEnterSelectionMode]);

    const handleConfirmExtend = useCallback(() => {
      if (!extendCheck.allowed || disabled) return;
      closePopover();
      onConfirmExtendBorders(sides, prompt);
    }, [closePopover, disabled, extendCheck.allowed, onConfirmExtendBorders, prompt, sides]);

    const handleOpenProviderSettings = useCallback(() => {
      closePopover();
      onOpenProviderSettings?.();
    }, [closePopover, onOpenProviderSettings]);

    const popoverNode =
      isOpen && !disabled ? (
        <div
          ref={popoverRef}
          role="dialog"
          aria-label="Infinite Zoom Controls"
          className="capy-iz-popover fixed z-40 w-72 overflow-y-auto overscroll-contain rounded-2xl bg-slate-900/95 border border-slate-700/80 shadow-2xl backdrop-blur-xl p-3 space-y-2.5 text-slate-100"
          style={
            popoverStyle
              ? {
                  right: `${popoverStyle.right}px`,
                  bottom: `${popoverStyle.bottom}px`,
                  maxWidth: `${popoverStyle.maxWidth}px`,
                  maxHeight: `${popoverStyle.maxHeight}px`,
                }
              : {
                  right: '4.5rem',
                  bottom: '4.5rem',
                  maxWidth: 'min(18rem, calc(100vw - 5.25rem))',
                  maxHeight: 'calc(100dvh - 5rem)',
                }
          }
        >
          <div className="space-y-1">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 min-w-0">
                <Sparkles size={14} className="text-sky-400 flex-shrink-0" />
                <span className="text-xs font-extrabold tracking-wide text-slate-100 truncate">
                  Infinite Zoom
                </span>
              </div>
              <button
                type="button"
                aria-label="Close Infinite Zoom menu"
                onClick={closePopover}
                className="capy-icon-btn inline-flex items-center justify-center min-w-[44px] min-h-[44px] w-11 h-11 flex-shrink-0 rounded-full text-slate-400 hover:text-white hover:bg-slate-800 cursor-pointer"
              >
                <X size={16} />
              </button>
            </div>
            <div className="flex items-center justify-between gap-1.5 min-w-0">
              <div
                data-testid="iz-active-provider-pill"
                className="inline-flex items-center gap-1 min-w-0 rounded-full bg-slate-950/85 border border-slate-700/80 px-2 py-0.5 text-[10px] font-semibold text-sky-300"
              >
                <Cpu size={10} className="flex-shrink-0" />
                <span className="truncate">{activeProviderPill}</span>
              </div>
              {onOpenProviderSettings && (
                <button
                  type="button"
                  data-testid="iz-change-provider-btn"
                  onClick={handleOpenProviderSettings}
                  className="inline-flex items-center justify-center px-2.5 py-1 min-h-[32px] rounded-full bg-slate-800 hover:bg-slate-700 border border-slate-600/80 text-[10px] font-bold text-slate-100 transition-colors shrink-0 cursor-pointer"
                >
                  Switch AI
                </button>
              )}
            </div>
          </div>

          <button
            type="button"
            data-testid="toolbar-infinite-zoom-in-btn"
            onClick={handleStartZoomIn}
            className="w-full min-h-[44px] flex items-center gap-2 px-2.5 py-2 rounded-xl bg-sky-500/15 hover:bg-sky-500/25 border border-sky-400/45 text-sky-200 text-xs font-bold transition-colors text-left cursor-pointer"
          >
            <ZoomIn size={15} className="flex-shrink-0 text-sky-300" />
            <div className="min-w-0 flex-1">
              <div className="truncate">Infill Detail (Select Regions)</div>
              <div className="text-[10px] font-normal text-sky-200/75 truncate">
                Add seamless detail layer on this canvas
              </div>
            </div>
          </button>

          <div className="space-y-2">
            <button
              type="button"
              data-testid="toolbar-infinite-zoom-out-btn"
              aria-expanded={showExtendConfig}
              onClick={() => setShowExtendConfig((prev) => !prev)}
              className={`w-full min-h-[44px] flex items-center gap-2 px-2.5 py-2 rounded-xl border text-xs font-bold transition-colors text-left cursor-pointer ${
                showExtendConfig
                  ? 'bg-amber-400/20 border-amber-400/60 text-amber-200'
                  : 'bg-slate-800/80 hover:bg-slate-800 border-slate-700 text-slate-200'
              }`}
            >
              <Expand size={15} className="flex-shrink-0 text-amber-300" />
              <div className="min-w-0 flex-1">
                <div className="truncate">Extend Borders</div>
                <div className="text-[10px] font-normal text-slate-400 truncate">
                  Expand canvas outward (0.35x/side)
                </div>
              </div>
            </button>

            {showExtendConfig && (
              <div className="rounded-xl bg-slate-950/80 border border-slate-800 p-2.5 space-y-2">
                <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                  Sides to Extend
                </div>
                <SideToggleRow
                  sides={sides}
                  testIdPrefix="extend-side"
                  onToggle={handleToggleSide}
                />

                <div className="space-y-1">
                  <label
                    htmlFor="toolbar-zoom-out-prompt"
                    className="block text-[10px] font-bold uppercase tracking-wider text-slate-400"
                  >
                    Guide Prompt (Optional)
                  </label>
                  <input
                    id="toolbar-zoom-out-prompt"
                    type="text"
                    maxLength={MAX_USER_PROMPT_LENGTH}
                    data-testid="infinite-zoom-out-prompt-input"
                    value={prompt}
                    onChange={(e) => onPromptChange(e.target.value)}
                    placeholder="e.g. Starry hills, calm lake..."
                    className="w-full px-2.5 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-amber-400"
                  />
                  <PromptChipsRow
                    chips={ZOOM_OUT_CHIPS}
                    activePrompt={prompt}
                    onSelect={onPromptChange}
                  />
                </div>

                {!extendCheck.allowed && extendCheck.reason && (
                  <div
                    role="alert"
                    className="flex items-start gap-1.5 px-2 py-1.5 rounded-lg bg-amber-500/15 border border-amber-400/40 text-[10px] text-amber-200 leading-snug"
                  >
                    <AlertTriangle size={12} className="flex-shrink-0 mt-0.5 text-amber-300" />
                    <span>{extendCheck.reason}</span>
                  </div>
                )}

                <button
                  type="button"
                  data-testid="toolbar-infinite-zoom-out-confirm-btn"
                  disabled={!extendCheck.allowed}
                  onClick={handleConfirmExtend}
                  className="w-full min-h-[44px] inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-400 hover:bg-amber-300 disabled:bg-slate-800 disabled:text-slate-500 disabled:cursor-not-allowed text-slate-950 text-xs font-extrabold transition-colors cursor-pointer"
                >
                  <Expand size={13} />
                  <span>Extend</span>
                </button>
              </div>
            )}
          </div>
        </div>
      ) : null;

    return (
      <div className="relative flex items-center justify-end">
        <button
          ref={triggerRef}
          type="button"
          data-testid="infinite-zoom-menu-btn"
          disabled={disabled}
          aria-expanded={isOpen && !disabled}
          aria-haspopup="dialog"
          aria-label={disabled && disabledReason ? disabledReason : 'Infinite Zoom Tools'}
          title={disabled && disabledReason ? disabledReason : 'Infinite Zoom: Add Detail or Extend Borders'}
          onClick={() => {
            if (disabled) return;
            setIsOpen((prev) => !prev);
          }}
          className={`capy-fab-btn inline-flex items-center justify-center min-w-[44px] min-h-[44px] p-2.5 rounded-full shadow-xl backdrop-blur-md border transition-all ${
            disabled
              ? 'bg-slate-900/45 text-slate-500 border-slate-800/50 cursor-not-allowed'
              : isOpen
                ? 'bg-sky-500 text-slate-950 border-sky-300 ring-2 ring-sky-400/50 cursor-pointer'
                : 'bg-slate-900/90 text-sky-300 border-sky-400/50 hover:bg-slate-800 active:scale-95 cursor-pointer'
          }`}
        >
          <Sparkles size={18} />
        </button>

        {popoverNode && typeof document !== 'undefined'
          ? createPortal(popoverNode, document.body)
          : popoverNode}
      </div>
    );
  }
);

export interface RegionSelectionBarProps {
  isOpen: boolean;
  raiseDock: boolean;
  isCompleted: boolean;
  metrics: SelectionMetrics;
  pendingSwitchRegionId: number | null;
  notice: string | null;
  prompt: string;
  isBusy: boolean;
  isDisabled?: boolean;
  isOverlayModalOpen?: boolean;
  onPromptChange: (next: string) => void;
  onConfirm: () => void;
  onSwitchSelection: () => void;
  onClear: () => void;
  onCancel: () => void;
}

export const RegionSelectionBar: React.FC<RegionSelectionBarProps> = React.memo(
  ({
    isOpen,
    raiseDock,
    isCompleted,
    metrics,
    pendingSwitchRegionId,
    notice,
    prompt,
    isBusy,
    isDisabled = false,
    isOverlayModalOpen = false,
    onPromptChange,
    onConfirm,
    onSwitchSelection,
    onClear,
    onCancel,
  }) => {
    const barRef = useRef<HTMLDivElement | null>(null);
    const [maxHeightPx, setMaxHeightPx] = useState<number | undefined>(undefined);

    useEffect(() => {
      if (!isOpen) return;
      const popBack = NativeBridge.pushBackHandler(onCancel);
      const handleKeyDown = (e: KeyboardEvent) => {
        if (e.key === 'Escape') {
          if (
            isOverlayModalOpen ||
            (typeof document !== 'undefined' && document.querySelector('[role="dialog"]'))
          ) {
            return;
          }
          e.stopPropagation();
          onCancel();
        }
      };
      window.addEventListener('keydown', handleKeyDown, true);
      return () => {
        popBack();
        window.removeEventListener('keydown', handleKeyDown, true);
      };
    }, [isOpen, isOverlayModalOpen, onCancel]);

    useIsomorphicLayoutEffect(() => {
      if (!isOpen || typeof window === 'undefined') {
        setMaxHeightPx(undefined);
        return;
      }
      const updateMaxHeight = () => {
        const barEl = barRef.current;
        if (!barEl) return;
        const barRect = barEl.getBoundingClientRect();
        const headerBottom =
          document.querySelector('header')?.getBoundingClientRect()?.bottom ?? 56;
        const minTop = Math.max(8, Math.ceil(headerBottom) + 6);
        const availHeight = Math.max(96, Math.floor(barRect.bottom - minTop));
        setMaxHeightPx((prev) => (prev === availHeight ? prev : availHeight));
      };
      updateMaxHeight();
      window.addEventListener('resize', updateMaxHeight);
      return () => {
        window.removeEventListener('resize', updateMaxHeight);
      };
    }, [isOpen, raiseDock, isCompleted, metrics.paintedCount, pendingSwitchRegionId, notice]);

    if (!isOpen) return null;

    const hasSelection = metrics.regionCount > 0;
    const isInPlace = metrics.mode === 'in-place';
    const bottomExpr = isCompleted
      ? raiseDock
        ? '2.5rem'
        : '1rem'
      : raiseDock
        ? 'var(--capy-replay-bottom-raised, 6.25rem)'
        : 'var(--capy-replay-bottom, 4.625rem)';

    return (
      <div
        ref={barRef}
        data-testid="region-selection-bar"
        role="region"
        aria-label="Region Selection Controls"
        className="fixed left-1/2 -translate-x-1/2 z-30 w-[min(32rem,calc(100vw-1rem))] overflow-y-auto overscroll-contain rounded-2xl bg-slate-900/95 border border-sky-400/50 shadow-2xl backdrop-blur-xl px-3 py-2.5 text-slate-100 space-y-2"
        style={{
          bottom: `calc(${bottomExpr} + var(--sab, 0px))`,
          ...(maxHeightPx !== undefined ? { maxHeight: `${maxHeightPx}px` } : {}),
        }}
      >
        <div className="flex flex-wrap items-center justify-between gap-1.5">
          <div className="flex items-center gap-1.5 min-w-0">
            <Layers size={14} className="text-sky-400 flex-shrink-0" />
            <span className="text-xs font-extrabold text-slate-100 truncate">
              {hasSelection
                ? `${metrics.regionCount} ${metrics.regionCount === 1 ? 'region' : 'regions'} selected`
                : 'Tap or drag connected regions'}
            </span>
          </div>

          {hasSelection && (
            <span
              data-testid="region-selection-mode-badge"
              className={`px-2 py-0.5 rounded-full text-[10px] font-extrabold uppercase tracking-wider border flex-shrink-0 ${
                isInPlace
                  ? 'bg-emerald-500/20 text-emerald-300 border-emerald-400/50'
                  : 'bg-sky-500/20 text-sky-200 border-sky-400/50'
              }`}
            >
              {isInPlace ? 'In-Place Detail' : 'Nested Detail Layer'}
            </span>
          )}
        </div>

        {metrics.paintedCount > 0 && (
          <div className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-amber-500/15 border border-amber-400/40 text-[11px] text-amber-200">
            <AlertTriangle size={12} className="flex-shrink-0 text-amber-300" />
            <span className="leading-snug">
              Includes {metrics.paintedCount} colored{' '}
              {metrics.paintedCount === 1 ? 'region' : 'regions'} — subdividing replaces them with
              fresh detail.
            </span>
          </div>
        )}

        {(pendingSwitchRegionId !== null || notice) && (
          <div className="flex flex-wrap items-center justify-between gap-2 px-2 py-1 rounded-lg bg-slate-800/90 border border-slate-700 text-[11px] text-slate-200">
            <span className="min-w-0 flex-1 leading-snug">
              {pendingSwitchRegionId !== null
                ? 'That region is not touching your selection.'
                : notice}
            </span>
            {pendingSwitchRegionId !== null && (
              <button
                type="button"
                data-testid="region-selection-switch-btn"
                onClick={onSwitchSelection}
                className="inline-flex items-center justify-center gap-1 min-h-[44px] min-w-[44px] px-3 py-1.5 rounded-md bg-sky-500/25 hover:bg-sky-500/35 border border-sky-400/50 text-sky-200 text-[11px] font-bold flex-shrink-0 cursor-pointer"
              >
                <ArrowLeftRight size={11} />
                <span>Switch Selection</span>
              </button>
            )}
          </div>
        )}

        <div className="space-y-1.5">
          <input
            type="text"
            maxLength={MAX_USER_PROMPT_LENGTH}
            data-testid="infinite-zoom-in-prompt-input"
            aria-label="Guide prompt for region detail"
            value={prompt}
            disabled={isBusy}
            onChange={(e) => onPromptChange(e.target.value)}
            placeholder="Optional detail guide (e.g. Tiny flowers, pebbles...)"
            className="w-full px-2.5 py-1.5 rounded-lg bg-slate-950/90 border border-slate-700 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-sky-400"
          />
          <PromptChipsRow
            chips={ZOOM_IN_CHIPS}
            activePrompt={prompt}
            disabled={isBusy}
            onSelect={onPromptChange}
          />
        </div>

        <div className="flex flex-wrap items-center justify-end gap-1.5">
          <button
            type="button"
            data-testid="region-selection-cancel-btn"
            disabled={isBusy}
            onClick={onCancel}
            className="inline-flex items-center justify-center min-h-[44px] min-w-[44px] px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 text-xs font-bold transition-colors cursor-pointer disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            data-testid="region-selection-clear-btn"
            disabled={!hasSelection || isBusy}
            onClick={onClear}
            className="inline-flex items-center justify-center gap-1 min-h-[44px] min-w-[44px] px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-45 disabled:cursor-not-allowed border border-slate-700 text-slate-200 text-xs font-bold transition-colors cursor-pointer"
          >
            <Trash2 size={12} />
            <span>Clear</span>
          </button>
          <button
            type="button"
            data-testid="region-selection-confirm-btn"
            disabled={!hasSelection || isBusy || isDisabled}
            onClick={onConfirm}
            className="inline-flex items-center justify-center gap-1.5 min-h-[44px] min-w-[44px] px-3 py-1.5 rounded-lg bg-sky-400 hover:bg-sky-300 disabled:bg-slate-800 disabled:text-slate-500 disabled:cursor-not-allowed text-slate-950 text-xs font-extrabold transition-colors cursor-pointer"
          >
            <Sparkles size={13} />
            <span>Subdivide</span>
          </button>
        </div>
      </div>
    );
  }
);

export interface InfiniteZoomCreateCardProps {
  sourceImage?: HTMLImageElement | null;
  infiniteZoomProvider: InfiniteZoomProviderMode;
  nanoBananaModel: NanoBananaModelId;
  nanoBananaResolution: NanoBananaResolution;
  openRouterModel?: OpenRouterImageModelId;
  openAiImageModel?: OpenAiImageModelId;
  xaiImageModel?: XaiImageModelId;
  guidedAiApp?: GuidedAiAppId;
  isInfiniteZoomDisabled?: boolean;
  disabledReason?: string;
  onChangeProvider: (provider: InfiniteZoomProviderMode) => void;
  onChangeModel: (model: NanoBananaModelId, nextResolution?: NanoBananaResolution) => void;
  onChangeResolution: (resolution: NanoBananaResolution) => void;
  onChangeOpenRouterModel?: (
    model: OpenRouterImageModelId,
    nextResolution?: NanoBananaResolution
  ) => void;
  onChangeOpenAiImageModel?: (model: OpenAiImageModelId) => void;
  onChangeXaiImageModel?: (model: XaiImageModelId) => void;
  onChangeGuidedAiApp?: (app: GuidedAiAppId) => void;
  onStartInfiniteZoomIn?: (prompt?: string) => void;
  onStartInfiniteZoomOut?: (sides: BorderExtensionSides, prompt?: string) => void;
  onZoomIntoDetailTile?: () => void;
  onClose: () => void;
  renderHintButton?: (id: string, title: string) => React.ReactNode;
  renderHintCallout?: (id: string, text: string) => React.ReactNode;
}

interface ByokProviderCopy {
  title: string;
  ariaLabel: string;
  placeholder: string;
  consoleUrl: string;
  consoleLabel: string;
}

const BYOK_PROVIDER_COPY: Record<ByokProviderMode, ByokProviderCopy> = {
  OPENROUTER: {
    title: 'OpenRouter Account / API Key (Device-Local)',
    ariaLabel: 'OpenRouter API Key',
    placeholder: 'Paste your OpenRouter key (sk-or-...) or use 1-Click OAuth above...',
    consoleUrl: OPENROUTER_KEYS_CONSOLE_URL,
    consoleLabel: 'Manage keys at OpenRouter',
  },
  GEMINI_BYOK: {
    title: 'Gemini API Key (Device-Local)',
    ariaLabel: 'Gemini API Key',
    placeholder: 'Paste your Gemini API key...',
    consoleUrl: GOOGLE_AI_STUDIO_KEY_URL,
    consoleLabel: 'Get key at Google AI Studio',
  },
  OPENAI_BYOK: {
    title: 'ChatGPT / OpenAI API Key (Device-Local)',
    ariaLabel: 'OpenAI API Key',
    placeholder: 'Paste your OpenAI API key (sk-...)...',
    consoleUrl: OPENAI_API_KEYS_URL,
    consoleLabel: 'Get key at OpenAI Platform',
  },
  XAI_BYOK: {
    title: 'Grok / xAI API Key (Device-Local)',
    ariaLabel: 'xAI Grok API Key',
    placeholder: 'Paste your xAI API key (xai-...)...',
    consoleUrl: XAI_CONSOLE_KEYS_URL,
    consoleLabel: 'Get key at xAI Console',
  },
};

function isByokProvider(provider: InfiniteZoomProviderMode): provider is ByokProviderMode {
  return (
    provider === 'OPENROUTER' ||
    provider === 'GEMINI_BYOK' ||
    provider === 'OPENAI_BYOK' ||
    provider === 'XAI_BYOK'
  );
}

const ByokApiKeySection: React.FC<{ provider: ByokProviderMode }> = ({ provider }) => {
  const copy = BYOK_PROVIDER_COPY[provider];
  const [byokDraft, setByokDraft] = useState<string>('');
  const [hasStoredByokKey, setHasStoredByokKey] = useState<boolean>(() =>
    hasProviderByokApiKey(provider)
  );
  const [isConnectingOAuth, setIsConnectingOAuth] = useState<boolean>(false);
  const [byokFeedback, setByokFeedback] = useState<string | null>(null);
  const [byokError, setByokError] = useState<string | null>(null);
  const byokFeedbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (byokFeedbackTimerRef.current !== null) {
        clearTimeout(byokFeedbackTimerRef.current);
        byokFeedbackTimerRef.current = null;
      }
    };
  }, []);

  const flashByokFeedback = (msg: string) => {
    setByokError(null);
    setByokFeedback(msg);
    if (byokFeedbackTimerRef.current !== null) {
      clearTimeout(byokFeedbackTimerRef.current);
    }
    byokFeedbackTimerRef.current = setTimeout(() => {
      byokFeedbackTimerRef.current = null;
      setByokFeedback(null);
    }, 3000);
  };

  const handleSaveByokKey = () => {
    const trimmed = byokDraft.trim();
    if (!trimmed) return;
    saveProviderByokApiKey(provider, trimmed);
    setHasStoredByokKey(hasProviderByokApiKey(provider));
    setByokDraft('');
    flashByokFeedback('Saved on this device only');
  };

  const handleClearByokKey = () => {
    clearProviderByokApiKey(provider);
    setHasStoredByokKey(hasProviderByokApiKey(provider));
    setByokDraft('');
    flashByokFeedback('Key removed from this device');
  };

  const handleConnectOpenRouterOAuth = async () => {
    if (isConnectingOAuth) return;
    setIsConnectingOAuth(true);
    setByokError(null);
    try {
      await connectOpenRouterWithPkce();
      setHasStoredByokKey(hasProviderByokApiKey('OPENROUTER'));
      flashByokFeedback('Connected with OpenRouter on this device only');
    } catch (err) {
      const msg =
        err instanceof Error && err.message.includes('CANCELLED')
          ? 'OpenRouter sign-in cancelled.'
          : err instanceof Error && err.message.includes('POPUP_BLOCKED')
            ? 'Popup blocked. Allow popups or paste an OpenRouter key below.'
            : 'Could not complete OpenRouter sign-in. Try again or paste an API key below.';
      setByokError(msg);
    } finally {
      setIsConnectingOAuth(false);
    }
  };

  return (
    <div className="rounded-lg bg-slate-900/90 border border-slate-700/80 p-2.5 space-y-2 min-w-0">
      <div className="flex flex-wrap items-center justify-between gap-1.5 min-w-0">
        <div className="flex items-center gap-1.5 min-w-0">
          <KeyRound size={12} className="text-amber-300 flex-shrink-0" />
          <span className="text-[11px] font-bold text-slate-200 truncate">{copy.title}</span>
        </div>
        <span
          data-testid="iz-byok-status-badge"
          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold border ${
            hasStoredByokKey
              ? 'bg-emerald-500/15 text-emerald-300 border-emerald-400/45'
              : 'bg-amber-500/15 text-amber-200 border-amber-400/45'
          }`}
        >
          {hasStoredByokKey ? <Check size={10} /> : null}
          <span>{hasStoredByokKey ? 'Saved on this device only' : 'Not set'}</span>
        </span>
      </div>

      {provider === 'OPENROUTER' && (
        <button
          type="button"
          data-testid="iz-openrouter-oauth-btn"
          disabled={isConnectingOAuth}
          onClick={() => void handleConnectOpenRouterOAuth()}
          className="w-full inline-flex items-center justify-center gap-2 px-3 py-2 min-h-[44px] rounded-lg bg-sky-400 hover:bg-sky-300 disabled:bg-slate-800 disabled:text-slate-500 text-slate-950 text-xs font-extrabold transition-colors cursor-pointer"
        >
          {isConnectingOAuth ? (
            <Loader2 size={14} className="animate-spin shrink-0" />
          ) : (
            <ExternalLink size={14} className="shrink-0" />
          )}
          <span className="truncate">
            {hasStoredByokKey
              ? 'Reconnect OpenRouter (1-Click OAuth)'
              : 'Connect with OpenRouter (1-Click OAuth)'}
          </span>
        </button>
      )}

      <div className="flex flex-col sm:flex-row gap-1.5 min-w-0">
        <input
          type="password"
          autoComplete="off"
          spellCheck={false}
          data-testid="iz-byok-key-input"
          aria-label={copy.ariaLabel}
          value={byokDraft}
          onChange={(e) => setByokDraft(e.target.value)}
          placeholder={hasStoredByokKey ? 'Enter new key to replace...' : copy.placeholder}
          className="flex-1 min-w-0 px-2.5 py-1.5 min-h-[44px] rounded-lg bg-slate-950 border border-slate-700 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-amber-400"
        />
        <div className="flex flex-wrap items-center gap-1.5 shrink-0">
          <button
            type="button"
            data-testid="iz-byok-save-btn"
            disabled={byokDraft.trim().length === 0}
            onClick={handleSaveByokKey}
            className="inline-flex items-center justify-center px-3 py-1.5 min-h-[44px] rounded-lg bg-amber-400 hover:bg-amber-300 disabled:bg-slate-800 disabled:text-slate-500 disabled:cursor-not-allowed text-slate-950 text-xs font-extrabold transition-colors cursor-pointer"
          >
            Save Key
          </button>
          <button
            type="button"
            data-testid="iz-byok-clear-btn"
            disabled={!hasStoredByokKey}
            onClick={handleClearByokKey}
            className="inline-flex items-center justify-center px-3 py-1.5 min-h-[44px] rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-45 disabled:cursor-not-allowed border border-slate-700 text-slate-200 text-xs font-bold transition-colors cursor-pointer"
          >
            Remove
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-1.5 text-[10px] text-slate-400 min-w-0">
        <span className="break-words">
          Stored only on this device — never included in `.capy` saves or cloud sync.
        </span>
        <a
          href={copy.consoleUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-sky-300 hover:text-sky-200 font-semibold underline underline-offset-2 shrink-0"
        >
          <span>{copy.consoleLabel}</span>
          <ExternalLink size={10} />
        </a>
      </div>

      {byokFeedback && (
        <p role="status" className="text-[11px] font-semibold text-emerald-300">
          {byokFeedback}
        </p>
      )}
      {byokError && (
        <p role="alert" className="text-[11px] font-semibold text-amber-300">
          {byokError}
        </p>
      )}
    </div>
  );
};

interface ProviderConfigPanelProps {
  effectiveProvider: InfiniteZoomProviderMode;
  isAndroid: boolean;
  providerOptions: readonly ProviderOptionItem[];
  nanoBananaModel: NanoBananaModelId;
  nanoBananaResolution: NanoBananaResolution;
  openRouterModel: OpenRouterImageModelId;
  openAiImageModel: OpenAiImageModelId;
  xaiImageModel: XaiImageModelId;
  guidedAiApp: GuidedAiAppId;
  onChangeProvider: (provider: InfiniteZoomProviderMode) => void;
  onChangeModel: (model: NanoBananaModelId, nextResolution?: NanoBananaResolution) => void;
  onChangeResolution: (resolution: NanoBananaResolution) => void;
  onChangeOpenRouterModel?: (
    model: OpenRouterImageModelId,
    nextResolution?: NanoBananaResolution
  ) => void;
  onChangeOpenAiImageModel?: (model: OpenAiImageModelId) => void;
  onChangeXaiImageModel?: (model: XaiImageModelId) => void;
  onChangeGuidedAiApp?: (app: GuidedAiAppId) => void;
}

const ProviderModelAndQualityRow: React.FC<{
  effectiveProvider: InfiniteZoomProviderMode;
  isAndroid: boolean;
  nanoBananaModel: NanoBananaModelId;
  nanoBananaResolution: NanoBananaResolution;
  openRouterModel: OpenRouterImageModelId;
  openAiImageModel: OpenAiImageModelId;
  xaiImageModel: XaiImageModelId;
  guidedAiApp: GuidedAiAppId;
  onChangeModel: (model: NanoBananaModelId, nextResolution?: NanoBananaResolution) => void;
  onChangeResolution: (resolution: NanoBananaResolution) => void;
  onChangeOpenRouterModel?: (
    model: OpenRouterImageModelId,
    nextResolution?: NanoBananaResolution
  ) => void;
  onChangeOpenAiImageModel?: (model: OpenAiImageModelId) => void;
  onChangeXaiImageModel?: (model: XaiImageModelId) => void;
  onChangeGuidedAiApp?: (app: GuidedAiAppId) => void;
}> = ({
  effectiveProvider,
  isAndroid,
  nanoBananaModel,
  nanoBananaResolution,
  openRouterModel,
  openAiImageModel,
  xaiImageModel,
  guidedAiApp,
  onChangeModel,
  onChangeResolution,
  onChangeOpenRouterModel,
  onChangeOpenAiImageModel,
  onChangeXaiImageModel,
  onChangeGuidedAiApp,
}) => {
  if (effectiveProvider === 'OPENROUTER') {
    const orMeta = getOpenRouterModelMeta(openRouterModel);
    const resolvedOrRes = resolveSupportedOpenRouterResolution(
      orMeta.id,
      nanoBananaResolution
    );
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 min-w-0">
        <div className="flex flex-col gap-1 min-w-0">
          <label htmlFor="iz-model-select" className="text-[11px] font-bold text-slate-300">
            OpenRouter Model
          </label>
          <select
            id="iz-model-select"
            data-testid="iz-model-select"
            value={orMeta.id}
            onChange={(e) => {
              const nextModel = e.target.value as OpenRouterImageModelId;
              const nextRes = resolveSupportedOpenRouterResolution(nextModel, resolvedOrRes);
              onChangeOpenRouterModel?.(
                nextModel,
                nextRes !== nanoBananaResolution ? nextRes : undefined
              );
            }}
            className="w-full min-w-0 max-w-full px-2.5 py-1.5 min-h-[44px] rounded-lg bg-slate-900 border border-slate-700 text-xs font-semibold text-slate-100 focus:outline-none focus:border-sky-400 cursor-pointer"
          >
            {OPENROUTER_IMAGE_MODELS.map((modelItem) => (
              <option key={modelItem.id} value={modelItem.id}>
                {modelItem.label}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1 min-w-0">
          <label htmlFor="iz-resolution-select" className="text-[11px] font-bold text-slate-300">
            Output Resolution
          </label>
          <select
            id="iz-resolution-select"
            data-testid="iz-resolution-select"
            value={resolvedOrRes}
            onChange={(e) => onChangeResolution(e.target.value as NanoBananaResolution)}
            className="w-full min-w-0 max-w-full px-2.5 py-1.5 min-h-[44px] rounded-lg bg-slate-900 border border-slate-700 text-xs font-semibold text-slate-100 focus:outline-none focus:border-sky-400 cursor-pointer"
          >
            {orMeta.supportedResolutions.map((resOpt) => (
              <option key={resOpt} value={resOpt}>
                {resOpt}
              </option>
            ))}
          </select>
        </div>
      </div>
    );
  }

  if (effectiveProvider === 'OPENAI_BYOK') {
    const oaMeta = getOpenAiImageModelMeta(openAiImageModel);
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 min-w-0">
        <div className="flex flex-col gap-1 min-w-0">
          <label htmlFor="iz-model-select" className="text-[11px] font-bold text-slate-300">
            ChatGPT / OpenAI Model
          </label>
          <select
            id="iz-model-select"
            data-testid="iz-model-select"
            value={oaMeta.id}
            onChange={(e) => onChangeOpenAiImageModel?.(e.target.value as OpenAiImageModelId)}
            className="w-full min-w-0 max-w-full px-2.5 py-1.5 min-h-[44px] rounded-lg bg-slate-900 border border-slate-700 text-xs font-semibold text-slate-100 focus:outline-none focus:border-sky-400 cursor-pointer"
          >
            {OPENAI_IMAGE_MODELS.map((modelItem) => (
              <option key={modelItem.id} value={modelItem.id}>
                {modelItem.label}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1 min-w-0">
          <label htmlFor="iz-resolution-select" className="text-[11px] font-bold text-slate-300">
            Output Quality
          </label>
          <select
            id="iz-resolution-select"
            data-testid="iz-resolution-select"
            value={nanoBananaResolution}
            onChange={(e) => onChangeResolution(e.target.value as NanoBananaResolution)}
            className="w-full min-w-0 max-w-full px-2.5 py-1.5 min-h-[44px] rounded-lg bg-slate-900 border border-slate-700 text-xs font-semibold text-slate-100 focus:outline-none focus:border-sky-400 cursor-pointer"
          >
            <option value="512">Medium (Faster)</option>
            <option value="1K">Auto (Balanced)</option>
            <option value="2K">High (Max Detail)</option>
          </select>
        </div>
      </div>
    );
  }

  if (effectiveProvider === 'XAI_BYOK') {
    const xaiMeta = getXaiImageModelMeta(xaiImageModel);
    return (
      <div className="flex flex-col gap-1 min-w-0">
        <label htmlFor="iz-model-select" className="text-[11px] font-bold text-slate-300">
          Grok / xAI Model
        </label>
        <select
          id="iz-model-select"
          data-testid="iz-model-select"
          value={xaiMeta.id}
          onChange={(e) => onChangeXaiImageModel?.(e.target.value as XaiImageModelId)}
          className="w-full min-w-0 max-w-full px-2.5 py-1.5 min-h-[44px] rounded-lg bg-slate-900 border border-slate-700 text-xs font-semibold text-slate-100 focus:outline-none focus:border-sky-400 cursor-pointer"
        >
          {XAI_IMAGE_MODELS.map((modelItem) => (
            <option key={modelItem.id} value={modelItem.id}>
              {modelItem.label}
            </option>
          ))}
        </select>
      </div>
    );
  }

  const selectedModelMeta = getNanoBananaModelMeta(nanoBananaModel);
  const resolvedResolution = resolveSupportedModelResolution(
    nanoBananaModel,
    nanoBananaResolution
  );
  const handleModelChange = (nextModel: NanoBananaModelId) => {
    const nextResolved = resolveSupportedModelResolution(nextModel, resolvedResolution);
    const nextResolution = nextResolved !== nanoBananaResolution ? nextResolved : undefined;
    onChangeModel(nextModel, nextResolution);
  };

  return (
    <div className="space-y-2 min-w-0">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 min-w-0">
        <div className="flex flex-col gap-1 min-w-0">
          <label htmlFor="iz-model-select" className="text-[11px] font-bold text-slate-300">
            Nano Banana Model
          </label>
          <select
            id="iz-model-select"
            data-testid="iz-model-select"
            value={nanoBananaModel}
            onChange={(e) => handleModelChange(e.target.value as NanoBananaModelId)}
            className="w-full min-w-0 max-w-full px-2.5 py-1.5 min-h-[44px] rounded-lg bg-slate-900 border border-slate-700 text-xs font-semibold text-slate-100 focus:outline-none focus:border-sky-400 cursor-pointer"
          >
            {NANO_BANANA_MODELS.map((modelItem) => (
              <option key={modelItem.id} value={modelItem.id}>
                {MODEL_SELECT_LABELS[modelItem.id] ?? modelItem.label}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1 min-w-0">
          <label htmlFor="iz-resolution-select" className="text-[11px] font-bold text-slate-300">
            Output Resolution
          </label>
          <select
            id="iz-resolution-select"
            data-testid="iz-resolution-select"
            value={resolvedResolution}
            onChange={(e) => onChangeResolution(e.target.value as NanoBananaResolution)}
            className="w-full min-w-0 max-w-full px-2.5 py-1.5 min-h-[44px] rounded-lg bg-slate-900 border border-slate-700 text-xs font-semibold text-slate-100 focus:outline-none focus:border-sky-400 cursor-pointer"
          >
            {selectedModelMeta.supportedResolutions.map((resOpt) => (
              <option key={resOpt} value={resOpt}>
                {resOpt}
              </option>
            ))}
          </select>
        </div>
      </div>

      {effectiveProvider === 'GUIDED_GEMINI' && !isAndroid && onChangeGuidedAiApp && (
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1.5 min-w-0">
          <label
            htmlFor="iz-guided-app-select"
            className="text-[11px] font-bold text-slate-300 flex-shrink-0"
          >
            Free AI App to Launch
          </label>
          <select
            id="iz-guided-app-select"
            data-testid="iz-guided-app-select"
            value={guidedAiApp}
            onChange={(e) => onChangeGuidedAiApp(e.target.value as GuidedAiAppId)}
            className="w-full sm:w-auto min-w-0 max-w-full px-2.5 py-1.5 min-h-[44px] rounded-lg bg-slate-900 border border-slate-700 text-xs font-semibold text-slate-100 focus:outline-none focus:border-sky-400 cursor-pointer"
          >
            {GUIDED_AI_APPS.map((app) => (
              <option key={app.id} value={app.id}>
                {app.label} ({app.appUrl.replace(/^https:\/\/|\/$/g, '')})
              </option>
            ))}
          </select>
        </div>
      )}
    </div>
  );
};

const ProviderConfigPanel: React.FC<ProviderConfigPanelProps> = ({
  effectiveProvider,
  isAndroid,
  providerOptions,
  nanoBananaModel,
  nanoBananaResolution,
  openRouterModel,
  openAiImageModel,
  xaiImageModel,
  guidedAiApp,
  onChangeProvider,
  onChangeModel,
  onChangeResolution,
  onChangeOpenRouterModel,
  onChangeOpenAiImageModel,
  onChangeXaiImageModel,
  onChangeGuidedAiApp,
}) => (
  <div className="rounded-xl bg-slate-950/65 border border-slate-800 p-2.5 space-y-2 min-w-0">
    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1.5 min-w-0">
      <label
        htmlFor="iz-provider-select"
        className="text-[11px] font-bold text-slate-300 flex-shrink-0"
      >
        Generation Provider
      </label>
      <select
        id="iz-provider-select"
        data-testid="iz-provider-select"
        value={effectiveProvider}
        onChange={(e) => onChangeProvider(e.target.value as InfiniteZoomProviderMode)}
        className="w-full sm:w-auto min-w-0 max-w-full px-2.5 py-1.5 min-h-[44px] rounded-lg bg-slate-900 border border-slate-700 text-xs font-semibold text-slate-100 focus:outline-none focus:border-sky-400 cursor-pointer"
      >
        {providerOptions.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </div>

    <ProviderModelAndQualityRow
      effectiveProvider={effectiveProvider}
      isAndroid={isAndroid}
      nanoBananaModel={nanoBananaModel}
      nanoBananaResolution={nanoBananaResolution}
      openRouterModel={openRouterModel}
      openAiImageModel={openAiImageModel}
      xaiImageModel={xaiImageModel}
      guidedAiApp={guidedAiApp}
      onChangeModel={onChangeModel}
      onChangeResolution={onChangeResolution}
      onChangeOpenRouterModel={onChangeOpenRouterModel}
      onChangeOpenAiImageModel={onChangeOpenAiImageModel}
      onChangeXaiImageModel={onChangeXaiImageModel}
      onChangeGuidedAiApp={onChangeGuidedAiApp}
    />

    {isByokProvider(effectiveProvider) && (
      <ByokApiKeySection key={effectiveProvider} provider={effectiveProvider} />
    )}
  </div>
);

function resolveActivePillModel(
  provider: InfiniteZoomProviderMode,
  models: {
    nanoBananaModel: NanoBananaModelId;
    openRouterModel: OpenRouterImageModelId;
    openAiImageModel: OpenAiImageModelId;
    xaiImageModel: XaiImageModelId;
  }
): InfiniteZoomModelId {
  switch (provider) {
    case 'OPENROUTER':
      return models.openRouterModel;
    case 'OPENAI_BYOK':
      return models.openAiImageModel;
    case 'XAI_BYOK':
      return models.xaiImageModel;
    default:
      return models.nanoBananaModel;
  }
}

export const InfiniteZoomCreateCard: React.FC<InfiniteZoomCreateCardProps> = ({
  sourceImage,
  infiniteZoomProvider,
  nanoBananaModel,
  nanoBananaResolution,
  openRouterModel = DEFAULT_OPENROUTER_MODEL,
  openAiImageModel = DEFAULT_OPENAI_IMAGE_MODEL,
  xaiImageModel = DEFAULT_XAI_IMAGE_MODEL,
  guidedAiApp = 'GEMINI',
  isInfiniteZoomDisabled = false,
  disabledReason,
  onChangeProvider,
  onChangeModel,
  onChangeResolution,
  onChangeOpenRouterModel,
  onChangeOpenAiImageModel,
  onChangeXaiImageModel,
  onChangeGuidedAiApp,
  onStartInfiniteZoomIn,
  onStartInfiniteZoomOut,
  onZoomIntoDetailTile,
  onClose,
  renderHintButton,
  renderHintCallout,
}) => {
  const isAndroid = NativeBridge.isAndroidNative();
  const providerOptions = useMemo(() => getAvailableProviderOptions(isAndroid), [isAndroid]);
  const effectiveProvider = resolveVisibleProvider(infiniteZoomProvider, isAndroid);

  const [sides, setSides] = useState<BorderExtensionSides>(DEFAULT_EXTEND_SIDES);
  const [prompt, setPrompt] = useState<string>('');

  const srcW = sourceImage ? sourceImage.naturalWidth || sourceImage.width : 0;
  const srcH = sourceImage ? sourceImage.naturalHeight || sourceImage.height : 0;
  const extendCheck = useMemo(() => canExtendSides(srcW, srcH, sides), [srcW, srcH, sides]);
  const hasSource = srcW > 0 && srcH > 0;
  const actionsDisabled = isInfiniteZoomDisabled || !hasSource;
  const activeModelForPill = resolveActivePillModel(effectiveProvider, {
    nanoBananaModel,
    openRouterModel,
    openAiImageModel,
    xaiImageModel,
  });
  const activeSummary = formatActiveProviderModelPill(
    effectiveProvider,
    activeModelForPill,
    isAndroid,
    guidedAiApp
  );

  const handleToggleSide = (key: keyof BorderExtensionSides) => {
    setSides((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  return (
    <div className="capy-iz-provider-card rounded-xl border border-sky-400/35 bg-gradient-to-br from-slate-900 via-slate-950 to-sky-950/25 p-3 space-y-2.5 min-w-0">
      <div className="flex flex-wrap items-center justify-between gap-2 min-w-0">
        <div className="flex items-center gap-1.5 min-w-0">
          <Sparkles size={14} className="text-sky-400 flex-shrink-0" />
          <span className="text-xs sm:text-sm font-extrabold text-slate-100 truncate">
            Infinite Zoom
          </span>
          {renderHintButton?.('infinite-zoom', 'Infinite Zoom Detail & Border Extension')}
        </div>
        <span className="inline-flex items-center gap-1 max-w-full rounded-full bg-slate-900/90 border border-slate-700/80 px-2 py-0.5 text-[10px] font-semibold text-sky-300">
          <Cpu size={10} className="flex-shrink-0" />
          <span className="truncate">{activeSummary}</span>
        </span>
      </div>

      {isInfiniteZoomDisabled && disabledReason && (
        <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-amber-500/15 border border-amber-400/40 text-[11px] text-amber-200 min-w-0">
          <Info size={12} className="flex-shrink-0 text-amber-300" />
          <span className="min-w-0 break-words">{disabledReason}</span>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {onStartInfiniteZoomIn && (
          <button
            type="button"
            data-testid="create-infinite-zoom-in-btn"
            disabled={actionsDisabled}
            onClick={() => {
              onStartInfiniteZoomIn(prompt);
              onClose();
            }}
            className="flex items-center justify-center gap-2 p-2.5 min-h-[44px] rounded-xl border border-sky-400/50 bg-sky-500/15 hover:bg-sky-500/25 disabled:opacity-45 disabled:cursor-not-allowed text-sky-200 text-xs sm:text-sm font-bold transition-colors cursor-pointer"
          >
            <ZoomIn size={15} className="flex-shrink-0" />
            <span className="truncate">Infill Detail (Select Regions)</span>
          </button>
        )}

        {onZoomIntoDetailTile && sourceImage && (
          <button
            type="button"
            data-testid="infinite-zoom-subtile-btn"
            disabled={isInfiniteZoomDisabled}
            onClick={() => {
              onZoomIntoDetailTile();
              onClose();
            }}
            title="Generate a higher-detail 2x zoomed sub-puzzle from the center of your current view"
            className="flex items-center justify-center gap-2 p-2.5 min-h-[44px] rounded-xl border border-sky-400/40 bg-sky-500/10 hover:bg-sky-500/20 disabled:opacity-45 disabled:cursor-not-allowed text-sky-300 text-xs sm:text-sm font-bold transition-colors cursor-pointer"
          >
            <ZoomIn size={15} className="flex-shrink-0" />
            <span className="truncate">Quick 2x Detail Tile</span>
          </button>
        )}
      </div>

      {onStartInfiniteZoomOut && (
        <div className="rounded-xl bg-slate-950/75 border border-slate-800 p-2.5 space-y-2 min-w-0">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-[11px] font-bold text-slate-200">
              Extend Borders Outward (0.35x per side)
            </span>
            <button
              type="button"
              data-testid="create-infinite-zoom-out-btn"
              disabled={actionsDisabled || !extendCheck.allowed}
              onClick={() => {
                onStartInfiniteZoomOut(sides, prompt);
                onClose();
              }}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 min-h-[44px] rounded-lg bg-amber-400 hover:bg-amber-300 disabled:bg-slate-800 disabled:text-slate-500 disabled:cursor-not-allowed text-slate-950 text-xs font-extrabold transition-colors cursor-pointer"
            >
              <Expand size={13} />
              <span>Extend Borders</span>
            </button>
          </div>

          <SideToggleRow
            sides={sides}
            testIdPrefix="create-extend-side"
            disabled={actionsDisabled}
            onToggle={handleToggleSide}
          />

          <input
            type="text"
            maxLength={MAX_USER_PROMPT_LENGTH}
            aria-label="Guide prompt for Infinite Zoom"
            value={prompt}
            disabled={actionsDisabled}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="Optional guide prompt (e.g. Starry hills, tiny flowers...)"
            className="w-full px-2.5 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-sky-400"
          />

          <PromptChipsRow
            chips={ZOOM_OUT_CHIPS}
            activePrompt={prompt}
            disabled={actionsDisabled}
            onSelect={setPrompt}
          />

          {hasSource && !extendCheck.allowed && extendCheck.reason && (
            <div
              role="alert"
              className="flex items-start gap-1.5 px-2 py-1 rounded-lg bg-amber-500/15 border border-amber-400/40 text-[10px] text-amber-200"
            >
              <AlertTriangle size={12} className="flex-shrink-0 mt-0.5 text-amber-300" />
              <span className="min-w-0 break-words">{extendCheck.reason}</span>
            </div>
          )}
        </div>
      )}

      <ProviderConfigPanel
        effectiveProvider={effectiveProvider}
        isAndroid={isAndroid}
        providerOptions={providerOptions}
        nanoBananaModel={nanoBananaModel}
        nanoBananaResolution={nanoBananaResolution}
        openRouterModel={openRouterModel}
        openAiImageModel={openAiImageModel}
        xaiImageModel={xaiImageModel}
        guidedAiApp={guidedAiApp}
        onChangeProvider={onChangeProvider}
        onChangeModel={onChangeModel}
        onChangeResolution={onChangeResolution}
        onChangeOpenRouterModel={onChangeOpenRouterModel}
        onChangeOpenAiImageModel={onChangeOpenAiImageModel}
        onChangeXaiImageModel={onChangeXaiImageModel}
        onChangeGuidedAiApp={onChangeGuidedAiApp}
      />

      {onZoomIntoDetailTile &&
        sourceImage &&
        renderHintCallout?.(
          'infinite-zoom',
          'Add seamless detail layers inside selected regions or extend canvas borders outward on the same unified puzzle using Puter, OpenRouter, Gemini, ChatGPT, or Grok.'
        )}
    </div>
  );
};
