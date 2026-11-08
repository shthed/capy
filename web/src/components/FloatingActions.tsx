import React from 'react';
import { Lightbulb, Maximize2, Minus, Paintbrush, Palette, Plus } from 'lucide-react';
import { PaletteColor } from '../types';

interface FloatingActionsProps {
  isPaintMode: boolean;
  showZoomButtons: boolean;
  showZoomOutButton?: boolean;
  raiseDock: boolean;
  isZoomedOrPanned?: boolean;
  activeColor?: PaletteColor | null;
  activeColorDisplayNumber?: string;
  activeColorBadgeVal?: number;
  isFreeColorMode?: boolean;
  onTriggerHint: () => void;
  onTogglePaintMode: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onResetView?: () => void;
  onOpenPaletteOptions?: () => void;
}

export const FloatingActions: React.FC<FloatingActionsProps> = ({
  isPaintMode,
  showZoomButtons,
  showZoomOutButton = false,
  raiseDock,
  isZoomedOrPanned = false,
  activeColor,
  activeColorDisplayNumber,
  activeColorBadgeVal,
  isFreeColorMode = false,
  onTriggerHint,
  onTogglePaintMode,
  onZoomIn,
  onZoomOut,
  onResetView,
  onOpenPaletteOptions,
}) => {
  return (
    <div
      className="fixed z-20 flex flex-col items-end gap-2.5 transition-all"
      style={{
        bottom: `calc(${raiseDock ? '6.75rem' : '5.5rem'} + var(--sab, 0px))`,
        right: 'calc(1rem + var(--sar, 0px))',
      }}
    >
      {/* Fit to Screen (Reset View) Button - visible whenever camera is zoomed or panned */}
      {isZoomedOrPanned && onResetView && (
        <button
          type="button"
          onClick={onResetView}
          title="Fit to Screen (Reset View)"
          className="p-2.5 rounded-full bg-slate-900/90 text-amber-400 border border-amber-400/50 shadow-xl backdrop-blur-md hover:bg-slate-800 transition-all active:scale-95 animate-in fade-in zoom-in-90 duration-200"
        >
          <Maximize2 size={18} />
        </button>
      )}

      {/* Zoom In Button */}
      {showZoomButtons && (
        <button
          type="button"
          onClick={onZoomIn}
          title="Zoom In"
          className="p-2.5 rounded-full bg-slate-900/85 text-slate-200 border border-slate-700/60 shadow-xl backdrop-blur-md hover:bg-slate-800 transition-all active:scale-95"
        >
          <Plus size={18} />
        </button>
      )}

      {/* Zoom Out Button (Disabled by default) */}
      {showZoomOutButton && (
        <button
          type="button"
          onClick={onZoomOut}
          title="Zoom Out"
          className="p-2.5 rounded-full bg-slate-900/85 text-slate-200 border border-slate-700/60 shadow-xl backdrop-blur-md hover:bg-slate-800 transition-all active:scale-95"
        >
          <Minus size={18} />
        </button>
      )}

      {/* Currently Selected Colour Swath (Replaces Hint Button) */}
      {activeColor ? (
        <button
          type="button"
          onClick={isFreeColorMode && onOpenPaletteOptions ? onOpenPaletteOptions : onTriggerHint}
          title={
            isFreeColorMode
              ? `Active Color #${activeColorDisplayNumber || activeColor.id}${
                  activeColorBadgeVal !== undefined ? ` (${activeColorBadgeVal} painted)` : ''
                } - Tap to customize`
              : `Active Color #${activeColorDisplayNumber || activeColor.id}${
                  activeColorBadgeVal !== undefined ? ` (${activeColorBadgeVal} remaining)` : ''
                } - Tap for Hint`
          }
          className="relative flex flex-col items-center justify-center w-12 h-12 rounded-full shadow-2xl border-2 border-white/80 ring-2 ring-amber-400/50 hover:scale-105 active:scale-95 transition-all overflow-hidden"
          style={{ backgroundColor: activeColor.hex }}
        >
          <span
            className={`text-xs font-black leading-none ${
              activeColor.isLight ? 'text-slate-950' : 'text-white'
            }`}
          >
            {activeColorDisplayNumber || activeColor.id}
          </span>
          {activeColorBadgeVal !== undefined && (
            <span
              className={`text-[9px] font-bold leading-none mt-0.5 ${
                activeColor.isLight ? 'text-slate-900/80' : 'text-white/80'
              }`}
            >
              {activeColorBadgeVal}
            </span>
          )}
        </button>
      ) : (
        <button
          type="button"
          onClick={onTriggerHint}
          title="Find & Highlight Next Region (Hint)"
          className="p-3 rounded-full bg-slate-900/90 text-amber-400 border border-amber-500/40 shadow-xl backdrop-blur-md hover:bg-slate-800/90 hover:scale-105 transition-all active:scale-95 ring-1 ring-amber-400/30"
        >
          <Lightbulb size={20} />
        </button>
      )}

      {/* Paint Mode (Drag-to-Color) Toggle */}
      <button
        type="button"
        onClick={onTogglePaintMode}
        title={isPaintMode ? 'Paint Mode Active (Drag to Color)' : 'Tap Mode Active'}
        className={`p-3 rounded-full shadow-xl backdrop-blur-md border transition-all active:scale-95 ${
          isPaintMode
            ? 'bg-amber-400 text-slate-950 border-amber-300 ring-2 ring-amber-400/50 scale-105'
            : 'bg-slate-900/90 text-slate-200 border-slate-700/60 hover:bg-slate-800'
        }`}
      >
        <Paintbrush size={20} />
      </button>

      {/* Smaller button in the bottom right for choosing a custom colour & changing palette options */}
      {onOpenPaletteOptions && (
        <button
          type="button"
          onClick={onOpenPaletteOptions}
          title="Custom Colour & Palette Options"
          className="p-2.5 rounded-full bg-slate-900/90 text-amber-400 border border-slate-700/70 shadow-xl backdrop-blur-md hover:bg-slate-800 hover:scale-105 transition-all active:scale-95"
        >
          <Palette size={18} />
        </button>
      )}
    </div>
  );
};
