import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  AlertTriangle,
  ArrowLeftRight,
  Cpu,
  Expand,
  Info,
  Layers,
  Sparkles,
  Trash2,
  X,
  ZoomIn,
} from 'lucide-react';
import { BorderExtensionSides, LocalAiMode } from '../types';
import { NativeBridge } from '../services/NativeBridge';
import { useIsomorphicLayoutEffect } from '../hooks/useLatest';
import {
  detectLocalAiCapabilities,
  LocalAiCapabilities,
  MAX_USER_PROMPT_LENGTH,
} from '../services/ai/LocalLlmService';
import { SelectionMetrics } from '../services/ai/RegionSelectionEngine';
import { canExtendSides, ExtendSidesCheck } from '../services/ai/InfiniteZoomSynthesizer';

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

const LOCAL_AI_MODE_OPTIONS: ReadonlyArray<{ value: LocalAiMode; label: string }> = [
  { value: 'AUTO', label: 'Auto (Built-in AI -> Offline Fast)' },
  { value: 'LOCAL_ONLY', label: 'Chrome Built-in AI Preferred' },
  { value: 'OFFLINE_FAST', label: 'Instant Offline Procedural' },
];

function formatAiCapabilitySummary(caps: LocalAiCapabilities | null, mode: LocalAiMode): string {
  if (mode === 'OFFLINE_FAST') {
    return 'Instant Offline Procedural (< 20ms) • On-Device • Offline-Ready';
  }
  if (!caps) {
    return 'On-Device Local AI • Free • Offline-Ready';
  }
  if (caps.chromeAi === 'available') {
    return caps.chromeAiMultimodal
      ? 'Chrome Built-in AI (Multimodal) Ready • On-Device'
      : 'Chrome Built-in AI (Text) Ready • On-Device';
  }
  if (caps.chromeAi === 'downloadable' || caps.chromeAi === 'downloading') {
    return 'Chrome Built-in AI Downloading • Offline Procedural Ready';
  }
  return 'Instant Offline Procedural Ready • Zero Cloud Required';
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
          className={`px-1.5 py-1 rounded-lg text-[11px] font-bold border transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${
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
          className={`flex-shrink-0 whitespace-nowrap px-2 py-0.5 rounded-full text-[11px] font-semibold border transition-colors cursor-pointer disabled:opacity-50 ${
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
  onPromptChange: (next: string) => void;
  onEnterSelectionMode: () => void;
  onConfirmExtendBorders: (sides: BorderExtensionSides, prompt: string) => void;
}

export const InfiniteZoomToolbarButton: React.FC<InfiniteZoomToolbarButtonProps> = React.memo(
  ({
    disabled = false,
    disabledReason,
    sourceWidth,
    sourceHeight,
    prompt,
    onPromptChange,
    onEnterSelectionMode,
    onConfirmExtendBorders,
  }) => {
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
              className="capy-icon-btn inline-flex items-center justify-center w-6 h-6 rounded-full text-slate-400 hover:text-white hover:bg-slate-800 cursor-pointer"
            >
              <X size={13} />
            </button>
          </div>

          <button
            type="button"
            data-testid="toolbar-infinite-zoom-in-btn"
            onClick={handleStartZoomIn}
            className="w-full flex items-center gap-2 px-2.5 py-2 rounded-xl bg-sky-500/15 hover:bg-sky-500/25 border border-sky-400/45 text-sky-200 text-xs font-bold transition-colors text-left cursor-pointer"
          >
            <ZoomIn size={15} className="flex-shrink-0 text-sky-300" />
            <div className="min-w-0 flex-1">
              <div className="truncate">Infill Detail (Select Regions)</div>
              <div className="text-[10px] font-normal text-sky-200/75 truncate">
                Subdivide in-place or zoom deeper
              </div>
            </div>
          </button>

          <div className="space-y-2">
            <button
              type="button"
              data-testid="toolbar-infinite-zoom-out-btn"
              aria-expanded={showExtendConfig}
              onClick={() => setShowExtendConfig((prev) => !prev)}
              className={`w-full flex items-center gap-2 px-2.5 py-2 rounded-xl border text-xs font-bold transition-colors text-left cursor-pointer ${
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
                  className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-400 hover:bg-amber-300 disabled:bg-slate-800 disabled:text-slate-500 disabled:cursor-not-allowed text-slate-950 text-xs font-extrabold transition-colors cursor-pointer"
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
              {isInPlace ? 'In-Place Split' : 'Deep Child Tile'}
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
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-sky-500/25 hover:bg-sky-500/35 border border-sky-400/50 text-sky-200 text-[11px] font-bold flex-shrink-0 cursor-pointer"
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

        <div className="flex items-center justify-end gap-1.5">
          <button
            type="button"
            data-testid="region-selection-cancel-btn"
            disabled={isBusy}
            onClick={onCancel}
            className="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 text-xs font-bold transition-colors cursor-pointer disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            data-testid="region-selection-clear-btn"
            disabled={!hasSelection || isBusy}
            onClick={onClear}
            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-45 disabled:cursor-not-allowed border border-slate-700 text-slate-200 text-xs font-bold transition-colors cursor-pointer"
          >
            <Trash2 size={12} />
            <span>Clear</span>
          </button>
          <button
            type="button"
            data-testid="region-selection-confirm-btn"
            disabled={!hasSelection || isBusy || isDisabled}
            onClick={onConfirm}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-sky-400 hover:bg-sky-300 disabled:bg-slate-800 disabled:text-slate-500 disabled:cursor-not-allowed text-slate-950 text-xs font-extrabold transition-colors cursor-pointer"
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
  localAiMode: LocalAiMode;
  isInfiniteZoomDisabled?: boolean;
  disabledReason?: string;
  onChangeLocalAiMode: (mode: LocalAiMode) => void;
  onStartInfiniteZoomIn?: (prompt?: string) => void;
  onStartInfiniteZoomOut?: (sides: BorderExtensionSides, prompt?: string) => void;
  onZoomIntoDetailTile?: () => void;
  onClose: () => void;
  renderHintButton?: (id: string, title: string) => React.ReactNode;
  renderHintCallout?: (id: string, text: string) => React.ReactNode;
}

export const InfiniteZoomCreateCard: React.FC<InfiniteZoomCreateCardProps> = ({
  sourceImage,
  localAiMode,
  isInfiniteZoomDisabled = false,
  disabledReason,
  onChangeLocalAiMode,
  onStartInfiniteZoomIn,
  onStartInfiniteZoomOut,
  onZoomIntoDetailTile,
  onClose,
  renderHintButton,
  renderHintCallout,
}) => {
  const [capabilities, setCapabilities] = useState<LocalAiCapabilities | null>(null);
  const [sides, setSides] = useState<BorderExtensionSides>(DEFAULT_EXTEND_SIDES);
  const [prompt, setPrompt] = useState<string>('');

  useEffect(() => {
    let cancelled = false;
    void detectLocalAiCapabilities()
      .then((caps) => {
        if (!cancelled) setCapabilities(caps);
      })
      .catch(() => {
        // Capability check is best-effort; offline procedural fallback is always ready
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const srcW = sourceImage ? sourceImage.naturalWidth || sourceImage.width : 0;
  const srcH = sourceImage ? sourceImage.naturalHeight || sourceImage.height : 0;
  const extendCheck = useMemo(() => canExtendSides(srcW, srcH, sides), [srcW, srcH, sides]);
  const hasSource = srcW > 0 && srcH > 0;
  const actionsDisabled = isInfiniteZoomDisabled || !hasSource;
  const capSummary = formatAiCapabilitySummary(capabilities, localAiMode);

  const handleToggleSide = useCallback((key: keyof BorderExtensionSides) => {
    setSides((prev) => ({ ...prev, [key]: !prev[key] }));
  }, []);

  return (
    <div className="rounded-xl border border-sky-400/35 bg-gradient-to-br from-slate-900 via-slate-950 to-sky-950/25 p-3 space-y-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 min-w-0">
          <Sparkles size={14} className="text-sky-400 flex-shrink-0" />
          <span className="text-xs sm:text-sm font-extrabold text-slate-100 truncate">
            Local Infinite Zoom
          </span>
          {renderHintButton?.('infinite-zoom', 'Infinite Zoom 2x Detail Tile')}
        </div>
        <span className="inline-flex items-center gap-1 rounded-full bg-slate-900/90 border border-slate-700/80 px-2 py-0.5 text-[10px] font-semibold text-sky-300">
          <Cpu size={10} className="flex-shrink-0" />
          <span className="truncate max-w-[14rem] sm:max-w-none">{capSummary}</span>
        </span>
      </div>

      {isInfiniteZoomDisabled && disabledReason && (
        <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-amber-500/15 border border-amber-400/40 text-[11px] text-amber-200">
          <Info size={12} className="flex-shrink-0 text-amber-300" />
          <span>{disabledReason}</span>
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
            className="flex items-center justify-center gap-2 p-2.5 rounded-xl border border-sky-400/50 bg-sky-500/15 hover:bg-sky-500/25 disabled:opacity-45 disabled:cursor-not-allowed text-sky-200 text-xs sm:text-sm font-bold transition-colors cursor-pointer"
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
            className="flex items-center justify-center gap-2 p-2.5 rounded-xl border border-sky-400/40 bg-sky-500/10 hover:bg-sky-500/20 disabled:opacity-45 disabled:cursor-not-allowed text-sky-300 text-xs sm:text-sm font-bold transition-colors cursor-pointer"
          >
            <ZoomIn size={15} className="flex-shrink-0" />
            <span className="truncate">Quick 2x Detail Tile</span>
          </button>
        )}
      </div>

      {onStartInfiniteZoomOut && (
        <div className="rounded-xl bg-slate-950/75 border border-slate-800 p-2.5 space-y-2">
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
              className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg bg-amber-400 hover:bg-amber-300 disabled:bg-slate-800 disabled:text-slate-500 disabled:cursor-not-allowed text-slate-950 text-xs font-extrabold transition-colors cursor-pointer"
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
              <span>{extendCheck.reason}</span>
            </div>
          )}
        </div>
      )}

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1.5 pt-0.5">
        <label
          htmlFor="local-ai-mode-select"
          className="text-[11px] font-bold text-slate-300 flex-shrink-0"
        >
          Local AI Mode
        </label>
        <select
          id="local-ai-mode-select"
          data-testid="local-ai-mode-select"
          value={localAiMode}
          onChange={(e) => onChangeLocalAiMode(e.target.value as LocalAiMode)}
          className="w-full sm:w-auto px-2.5 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-xs font-semibold text-slate-100 focus:outline-none focus:border-sky-400 cursor-pointer"
        >
          {LOCAL_AI_MODE_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>

      {onZoomIntoDetailTile &&
        sourceImage &&
        renderHintCallout?.(
          'infinite-zoom',
          'Subdivide selected connected regions for higher detail, extend canvas borders outward, or crop a quick 2x center detail tile — all locally on your device.'
        )}
    </div>
  );
};
