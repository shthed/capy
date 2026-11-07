import React from 'react';
import { Lightbulb, Paintbrush, Plus, Minus } from 'lucide-react';

interface FloatingActionsProps {
  isPaintMode: boolean;
  showZoomButtons: boolean;
  raiseDock: boolean;
  onTriggerHint: () => void;
  onTogglePaintMode: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
}

export const FloatingActions: React.FC<FloatingActionsProps> = ({
  isPaintMode,
  showZoomButtons,
  raiseDock,
  onTriggerHint,
  onTogglePaintMode,
  onZoomIn,
  onZoomOut,
}) => {
  return (
    <div
      className={`fixed right-4 z-20 flex flex-col items-end gap-2.5 transition-all ${
        raiseDock ? 'bottom-24' : 'bottom-20'
      }`}
    >
      {showZoomButtons && (
        <>
          <button
            type="button"
            onClick={onZoomIn}
            title="Zoom In"
            className="p-2.5 rounded-full bg-slate-900/85 text-slate-200 border border-slate-700/60 shadow-xl backdrop-blur-md hover:bg-slate-800 transition-all active:scale-95"
          >
            <Plus size={18} />
          </button>
          <button
            type="button"
            onClick={onZoomOut}
            title="Zoom Out"
            className="p-2.5 rounded-full bg-slate-900/85 text-slate-200 border border-slate-700/60 shadow-xl backdrop-blur-md hover:bg-slate-800 transition-all active:scale-95"
          >
            <Minus size={18} />
          </button>
        </>
      )}

      {/* Hint Button */}
      <button
        type="button"
        onClick={onTriggerHint}
        title="Find & Highlight Next Region (Hint)"
        className="p-3 rounded-full bg-slate-900/90 text-amber-400 border border-amber-500/40 shadow-xl backdrop-blur-md hover:bg-slate-800/90 hover:scale-105 transition-all active:scale-95 ring-1 ring-amber-400/30"
      >
        <Lightbulb size={20} />
      </button>

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
    </div>
  );
};
