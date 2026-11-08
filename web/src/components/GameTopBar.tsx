import React from 'react';
import { Eye, EyeOff, ImagePlus, Maximize2, Minimize2, Paintbrush, Settings } from 'lucide-react';

interface GameTopBarProps {
  activeTitle?: string | null;
  progressPercentage: number;
  isPreviewMode: boolean;
  isCompleted: boolean;
  isFullscreen?: boolean;
  isFreeColorMode?: boolean;
  onPickImage: () => void;
  onTogglePreview: () => void;
  onToggleFullscreen?: () => void;
  onToggleFreeColorMode?: () => void;
  onOpenSettings: () => void;
  onOpenSaves: () => void;
}

export const GameTopBar: React.FC<GameTopBarProps> = ({
  activeTitle,
  progressPercentage,
  isPreviewMode,
  isCompleted,
  isFullscreen,
  isFreeColorMode = false,
  onPickImage,
  onTogglePreview,
  onToggleFullscreen,
  onToggleFreeColorMode,
  onOpenSettings,
  onOpenSaves,
}) => {
  return (
    <header
      className="fixed top-0 left-0 right-0 z-30 pointer-events-none px-3 pb-3 safe-top flex justify-end items-center"
      style={{
        paddingLeft: 'max(0.75rem, calc(var(--sal, 0px) + 0.75rem))',
        paddingRight: 'max(0.75rem, calc(var(--sar, 0px) + 0.75rem))',
      }}
    >
      <div className="pointer-events-auto flex items-center gap-2">
        {/* Toggle Free Colour Mode Button */}
        {onToggleFreeColorMode && (
          <button
            type="button"
            onClick={onToggleFreeColorMode}
            title={
              isFreeColorMode
                ? 'Free Colour Mode is ON (Click to switch to By Number)'
                : 'Color by Number is ON (Click to switch to Free Colour)'
            }
            aria-label={
              isFreeColorMode
                ? 'Switch to Color by Number'
                : 'Switch to Free Colour Mode'
            }
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold shadow-lg backdrop-blur-md border transition-all active:scale-95 ${
              isFreeColorMode
                ? 'bg-amber-400 text-slate-950 border-amber-300 ring-2 ring-amber-400/50 shadow-amber-500/20'
                : 'bg-slate-900/80 text-slate-300 border-slate-700/60 hover:bg-slate-800/80 hover:text-white'
            }`}
          >
            <Paintbrush size={14} />
            <span className="hidden sm:inline">
              {isFreeColorMode ? 'Free Colour' : 'By Number'}
            </span>
          </button>
        )}

        {/* Progress % / Title Pill */}
        <button
          type="button"
          onClick={onOpenSaves}
          title="View saves and snapshots"
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-extrabold shadow-lg backdrop-blur-md transition-all active:scale-95 ${
            isCompleted
              ? 'bg-amber-400 text-amber-950 ring-2 ring-amber-300'
              : 'bg-slate-900/80 text-amber-400 border border-slate-700/60 hover:bg-slate-800/80'
          }`}
        >
          {activeTitle ? (
            <span className="truncate max-w-[120px]">{activeTitle}</span>
          ) : (
            <span>Capy</span>
          )}
          <span>•</span>
          <span>{progressPercentage}%</span>
        </button>

        {/* Toggle Preview Button */}
        <button
          type="button"
          onClick={onTogglePreview}
          title={isPreviewMode ? 'Return to Puzzle' : 'Show Original Preview'}
          className={`p-2 rounded-full shadow-lg backdrop-blur-md border transition-all active:scale-95 ${
            isPreviewMode
              ? 'bg-amber-500/20 text-amber-400 border-amber-500/50 ring-1 ring-amber-400'
              : 'bg-slate-900/80 text-slate-200 border-slate-700/60 hover:bg-slate-800/80'
          }`}
        >
          {isPreviewMode ? <EyeOff size={18} /> : <Eye size={18} />}
        </button>

        {/* Toggle Full Screen Button */}
        {onToggleFullscreen && (
          <button
            type="button"
            onClick={onToggleFullscreen}
            title={isFullscreen ? 'Exit Full Screen' : 'Display Full Screen'}
            aria-label={isFullscreen ? 'Exit Full Screen' : 'Display Full Screen'}
            className={`p-2 rounded-full shadow-lg backdrop-blur-md border transition-all active:scale-95 ${
              isFullscreen
                ? 'bg-amber-500/20 text-amber-400 border-amber-500/50 ring-1 ring-amber-400'
                : 'bg-slate-900/80 text-slate-200 border-slate-700/60 hover:bg-slate-800/80'
            }`}
          >
            {isFullscreen ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
          </button>
        )}

        {/* Pick Image Button */}
        <button
          type="button"
          onClick={onPickImage}
          title="Load New Photo or Artwork"
          className="p-2 rounded-full bg-slate-900/80 text-slate-200 border border-slate-700/60 shadow-lg backdrop-blur-md hover:bg-slate-800/80 transition-all active:scale-95"
        >
          <ImagePlus size={18} />
        </button>

        {/* Settings Button */}
        <button
          type="button"
          onClick={onOpenSettings}
          title="Settings and Menu"
          className="p-2 rounded-full bg-slate-900/80 text-slate-200 border border-slate-700/60 shadow-lg backdrop-blur-md hover:bg-slate-800/80 transition-all active:scale-95"
        >
          <Settings size={18} />
        </button>
      </div>
    </header>
  );
};
