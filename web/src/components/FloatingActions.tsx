import React, { useRef } from 'react';
import { Maximize2, Minus, Paintbrush, Play, Plus, Redo2, Undo2 } from 'lucide-react';

interface FloatingActionsProps {
  isPaintMode: boolean;
  showZoomButtons: boolean;
  showResetViewButton?: boolean;
  raiseDock: boolean;
  isZoomedOrPanned?: boolean;
  canUndo?: boolean;
  canRedo?: boolean;
  showUndo?: boolean;
  isCompleted?: boolean;
  isReplaying?: boolean;
  onUndo?: () => void;
  onRedo?: () => void;
  onLongPressUndo?: () => void;
  onStartReplay?: () => void;
  onTogglePaintMode: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onResetView?: () => void;
}

export const FloatingActions: React.FC<FloatingActionsProps> = React.memo(({
  isPaintMode,
  showZoomButtons,
  showResetViewButton = false,
  raiseDock,
  isZoomedOrPanned = false,
  canUndo = false,
  canRedo = false,
  showUndo = true,
  isCompleted = false,
  isReplaying = false,
  onUndo,
  onRedo,
  onLongPressUndo,
  onStartReplay,
  onTogglePaintMode,
  onZoomIn,
  onZoomOut,
  onResetView,
}) => {
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isLongPressActiveRef = useRef<boolean>(false);

  const handleUndoPointerDown = () => {
    if (!canUndo) return;
    isLongPressActiveRef.current = false;
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
    }
    longPressTimerRef.current = setTimeout(() => {
      isLongPressActiveRef.current = true;
      onLongPressUndo?.();
    }, 450);
  };

  const handleUndoPointerUp = () => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
    if (!isLongPressActiveRef.current && canUndo) {
      onUndo?.();
    }
  };

  const handleUndoPointerCancel = () => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  };
  return (
    <div
      className="capy-fab-stack fixed z-20 flex flex-col items-end gap-2.5 transition-all"
      style={{
        bottom: `calc(${
          isReplaying
            ? !isCompleted
              ? raiseDock
                ? 'var(--capy-fab-bottom-replaying-raised, 9.75rem)'
                : 'var(--capy-fab-bottom-replaying, 8.125rem)'
              : raiseDock
              ? 'var(--capy-fab-bottom-completed-replaying-raised, 12.5rem)'
              : 'var(--capy-fab-bottom-completed-replaying, 10.5rem)'
            : isCompleted
            ? raiseDock
              ? '2.5rem'
              : '1.25rem'
            : raiseDock
            ? 'var(--capy-fab-bottom-raised, 6.25rem)'
            : 'var(--capy-fab-bottom, 4.625rem)'
        } + var(--sab, 0px))`,
        right: 'calc(1rem + var(--sar, 0px))',
      }}
    >
      {/* Fit to Screen (Reset View) Button */}
      {showResetViewButton && isZoomedOrPanned && onResetView && (
        <button
          type="button"
          onClick={onResetView}
          aria-label="Fit to Screen"
          title="Fit to Screen"
          data-testid="reset-view-btn"
          className="capy-fab-btn inline-flex items-center justify-center min-w-[44px] min-h-[44px] p-2.5 rounded-full bg-slate-900/90 text-amber-400 border border-amber-400/50 shadow-xl backdrop-blur-md hover:bg-slate-800 transition-all active:scale-95 animate-in fade-in zoom-in-90 duration-200 cursor-pointer"
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
            aria-label="Zoom In"
            title="Zoom In"
            data-testid="zoom-in-btn"
            className="capy-fab-btn inline-flex items-center justify-center min-w-[44px] min-h-[44px] p-2.5 rounded-full bg-slate-900/85 text-slate-200 border border-slate-700/60 shadow-xl backdrop-blur-md hover:bg-slate-800 transition-all active:scale-95 cursor-pointer"
          >
            <Plus size={18} />
          </button>
          <button
            type="button"
            onClick={onZoomOut}
            aria-label="Zoom Out"
            title="Zoom Out"
            data-testid="zoom-out-btn"
            className="capy-fab-btn inline-flex items-center justify-center min-w-[44px] min-h-[44px] p-2.5 rounded-full bg-slate-900/85 text-slate-200 border border-slate-700/60 shadow-xl backdrop-blur-md hover:bg-slate-800 transition-all active:scale-95 cursor-pointer"
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
          aria-label="Watch Puzzle Replay"
          title="Watch Puzzle Replay"
          data-testid="replay-btn"
          className="capy-fab-btn inline-flex items-center justify-center min-w-[44px] min-h-[44px] p-2.5 rounded-full bg-amber-400 text-slate-950 border border-amber-300 shadow-xl backdrop-blur-md hover:bg-amber-300 transition-all active:scale-95 animate-in fade-in zoom-in-90 duration-200 cursor-pointer"
        >
          <Play size={18} />
        </button>
      )}

      {/* Undo & Redo History Action Buttons (Redo stacked above Undo, hidden when disabled or hidden via setting) */}
      {showUndo && (
        <div className="flex flex-col items-center gap-2">
          {canRedo && onRedo && (
            <button
              type="button"
              onClick={onRedo}
              aria-label="Redo Action"
              title="Redo Action"
              data-testid="redo-btn"
              className="capy-fab-btn inline-flex items-center justify-center min-w-[44px] min-h-[44px] p-2.5 rounded-full shadow-xl backdrop-blur-md border border-slate-700/60 bg-slate-900/90 text-slate-200 hover:bg-slate-800 active:scale-95 transition-all select-none cursor-pointer animate-in fade-in zoom-in-90 duration-150"
            >
              <Redo2 size={18} />
            </button>
          )}

          {onUndo && (
            <button
              type="button"
              onPointerDown={handleUndoPointerDown}
              onPointerUp={handleUndoPointerUp}
              onPointerLeave={handleUndoPointerCancel}
              onPointerCancel={handleUndoPointerCancel}
              onContextMenu={(e) => e.preventDefault()}
              disabled={!canUndo}
              aria-label="Undo Region"
              title={
                canUndo
                  ? 'Undo • Long press to open Replay'
                  : 'Nothing to Undo'
              }
              data-testid="undo-btn"
              className={`capy-fab-btn inline-flex items-center justify-center min-w-[44px] min-h-[44px] p-2.5 rounded-full shadow-xl backdrop-blur-md border transition-all select-none ${
                canUndo
                  ? 'bg-slate-900/90 text-slate-200 border-slate-700/60 hover:bg-slate-800 active:scale-95 cursor-pointer'
                  : 'bg-slate-900/40 text-slate-600 border-slate-800/40 cursor-not-allowed'
              }`}
            >
              <Undo2 size={18} />
            </button>
          )}
        </div>
      )}

      {/* Paint Mode (Drag-to-Color) Toggle */}
      <button
        type="button"
        data-testid="paint-mode-btn"
        onClick={onTogglePaintMode}
        aria-label={isPaintMode ? 'Paint Mode Active (Switch to Tap Mode)' : 'Tap Mode Active (Switch to Paint Mode)'}
        title={isPaintMode ? 'Paint Mode Active (Tap to Switch to Tap Mode)' : 'Tap Mode Active (Tap to Enable Paint Mode)'}
        className={`capy-fab-primary inline-flex items-center justify-center min-w-[48px] min-h-[48px] p-3 rounded-full shadow-xl backdrop-blur-md border transition-all active:scale-95 cursor-pointer ${
          isPaintMode
            ? 'bg-amber-400 text-slate-950 border-amber-300 ring-2 ring-amber-400/50 scale-105'
            : 'bg-slate-900/90 text-slate-200 border-slate-700/60 hover:bg-slate-800'
        }`}
      >
        <Paintbrush size={20} />
      </button>
    </div>
  );
});
