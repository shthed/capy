import React from 'react';
import { Eye, EyeOff, ImagePlus, Maximize2, Minimize2, Settings } from 'lucide-react';

interface GameTopBarProps {
  activeTitle?: string | null;
  progressPercentage: number;
  isPreviewMode: boolean;
  isCompleted: boolean;
  isFullscreen?: boolean;
  onPickImage: () => void;
  onTogglePreview: () => void;
  onToggleFullscreen?: () => void;
  onOpenSettings: () => void;
  onOpenSaves: () => void;
}

export const GameTopBar: React.FC<GameTopBarProps> = ({
  activeTitle,
  progressPercentage,
  isPreviewMode,
  isCompleted,
  isFullscreen,
  onPickImage,
  onTogglePreview,
  onToggleFullscreen,
  onOpenSettings,
  onOpenSaves,
}) => {
  return (
    <header
      className="fixed top-0 left-0 right-0 z-30 pointer-events-none px-3 pb-3 safe-top flex justify-between items-center"
      style={{
        paddingLeft: 'max(0.75rem, calc(var(--sal, 0px) + 0.75rem))',
        paddingRight: 'max(0.75rem, calc(var(--sar, 0px) + 0.75rem))',
      }}
    >
      {/* Top Left: Progress % / Title Pill */}
      <div className="pointer-events-auto">
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
            <span className="truncate max-w-[120px] sm:max-w-[200px]">{activeTitle}</span>
          ) : (
            <span>Capy Paint</span>
          )}
          <span>•</span>
          <span>{progressPercentage}%</span>
        </button>
      </div>

      {/* Top Right: Actions */}
      <div className="pointer-events-auto flex items-center gap-2">
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
