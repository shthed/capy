import React from 'react';
import { Maximize2, Minus, Paintbrush, Play, Plus, Undo2 } from 'lucide-react';

interface FloatingActionsProps {
  isPaintMode: boolean;
  showZoomButtons: boolean;
  showResetViewButton?: boolean;
  raiseDock: boolean;
  isZoomedOrPanned?: boolean;
  canUndo?: boolean;
  isCompleted?: boolean;
  isReplaying?: boolean;
  onUndo?: () => void;
  onStartReplay?: () => void;
  onTogglePaintMode: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onResetView?: () => void;
}

export const FloatingActions: React.FC<FloatingActionsProps> = ({
  isPaintMode,
  showZoomButtons,
  showResetViewButton = false,
  raiseDock,
  isZoomedOrPanned = false,
  canUndo = false,
  isCompleted = false,
  isReplaying = false,
  onUndo,
  onStartReplay,
  onTogglePaintMode,
  onZoomIn,
  onZoomOut,
  onResetView,
}) => {
  return (
    <div
      className="fixed z-20 flex flex-col items-end gap-2.5 transition-all"
      style={{
        bottom: `calc(${
          isReplaying
            ? (raiseDock ? '12.5rem' : '10.5rem')
            : isCompleted
            ? (raiseDock ? '2.5rem' : '1.25rem')
            : (raiseDock ? '6.25rem' : '4.625rem')
        } + var(--sab, 0px))`,
        right: 'calc(1rem + var(--sar, 0px))',
      }}
    >
      {/* Fit to Screen (Reset View / Extent) Button */}
      {showResetViewButton && isZoomedOrPanned && onResetView && (
        <button
          type="button"
          onClick={onResetView}
          title="Fit to Screen (Reset View)"
          className="p-2.5 rounded-full bg-slate-900/90 text-amber-400 border border-amber-400/50 shadow-xl backdrop-blur-md hover:bg-slate-800 transition-all active:scale-95 animate-in fade-in zoom-in-90 duration-200 cursor-pointer"
        >
          <Maximize2 size={18} />
        </button>
      )}

      {/* Zoom In & Out Buttons */}
      {showZoomButtons && (
        <>
          <button
            type="button"
            onClick={onZoomIn}
            title="Zoom In"
            className="p-2.5 rounded-full bg-slate-900/85 text-slate-200 border border-slate-700/60 shadow-xl backdrop-blur-md hover:bg-slate-800 transition-all active:scale-95 cursor-pointer"
          >
            <Plus size={18} />
          </button>
          <button
            type="button"
            onClick={onZoomOut}
            title="Zoom Out"
            className="p-2.5 rounded-full bg-slate-900/85 text-slate-200 border border-slate-700/60 shadow-xl backdrop-blur-md hover:bg-slate-800 transition-all active:scale-95 cursor-pointer"
          >
            <Minus size={18} />
          </button>
        </>
      )}

      {/* Replay Button when puzzle is completed and not currently replaying */}
      {isCompleted && !isReplaying && onStartReplay && (
        <button
          type="button"
          onClick={onStartReplay}
          title="Watch Puzzle Replay"
          className="p-2.5 rounded-full bg-amber-400 text-slate-950 border border-amber-300 shadow-xl backdrop-blur-md hover:bg-amber-300 transition-all active:scale-95 animate-in fade-in zoom-in-90 duration-200 cursor-pointer"
        >
          <Play size={18} />
        </button>
      )}

      {/* Undo Last Region Completion Button */}
      {onUndo && !isReplaying && (
        <button
          type="button"
          onClick={onUndo}
          disabled={!canUndo}
          title={canUndo ? 'Undo Last Region (Ctrl+Z)' : 'Nothing to Undo'}
          className={`p-2.5 rounded-full shadow-xl backdrop-blur-md border transition-all ${
            canUndo
              ? 'bg-slate-900/90 text-slate-200 border-slate-700/60 hover:bg-slate-800 active:scale-95 cursor-pointer'
              : 'bg-slate-900/40 text-slate-600 border-slate-800/40 cursor-not-allowed'
          }`}
        >
          <Undo2 size={18} />
        </button>
      )}

      {/* Paint Mode (Drag-to-Color) Toggle */}
      {!isReplaying && (
        <button
          type="button"
          onClick={onTogglePaintMode}
          title={isPaintMode ? 'Paint Mode Active (Drag to Color)' : 'Tap Mode Active'}
          className={`p-3 rounded-full shadow-xl backdrop-blur-md border transition-all active:scale-95 cursor-pointer ${
            isPaintMode
              ? 'bg-amber-400 text-slate-950 border-amber-300 ring-2 ring-amber-400/50 scale-105'
              : 'bg-slate-900/90 text-slate-200 border-slate-700/60 hover:bg-slate-800'
          }`}
        >
          <Paintbrush size={20} />
        </button>
      )}
    </div>
  );
};
