import React from 'react';
import { Eye, EyeOff, ImagePlus, Maximize2, Minimize2, Settings, Users } from 'lucide-react';
import { CoopParticipant } from '../services/providers/types';

interface GameTopBarProps {
  activeTitle?: string | null;
  progressPercentage: number;
  isPreviewMode: boolean;
  isCompleted: boolean;
  isFullscreen?: boolean;
  coopRoomCode?: string | null;
  coopParticipants?: CoopParticipant[];
  onPickImage: () => void;
  onTogglePreview: () => void;
  onToggleFullscreen?: () => void;
  onOpenSettings: () => void;
  onOpenSaves: () => void;
  onOpenCoop?: () => void;
}

export const GameTopBar: React.FC<GameTopBarProps> = ({
  activeTitle,
  progressPercentage,
  isPreviewMode,
  isCompleted,
  isFullscreen,
  coopRoomCode,
  coopParticipants = [],
  onPickImage,
  onTogglePreview,
  onToggleFullscreen,
  onOpenSettings,
  onOpenSaves,
  onOpenCoop,
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
      <div className="pointer-events-auto flex items-center gap-1.5">
        <button
          type="button"
          onClick={onOpenSaves}
          title="View saves and snapshots"
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-extrabold shadow-lg backdrop-blur-md transition-all active:scale-95 cursor-pointer ${
            isCompleted
              ? 'bg-amber-400 text-amber-950 ring-2 ring-amber-300'
              : 'bg-slate-900/80 text-amber-400 border border-slate-700/60 hover:bg-slate-800/80'
          }`}
        >
          {activeTitle ? (
            <span className="truncate max-w-[110px] sm:max-w-[200px]">{activeTitle}</span>
          ) : (
            <span>Capy Paint</span>
          )}
          <span>•</span>
          <span>{progressPercentage}%</span>
        </button>

        {coopRoomCode && onOpenCoop && (
          <button
            type="button"
            data-testid="topbar-active-coop-pill"
            onClick={onOpenCoop}
            title={`Co-op Room ${coopRoomCode} (${coopParticipants.length} online)`}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-full text-[11px] font-extrabold bg-emerald-950/90 text-emerald-300 border border-emerald-500/60 shadow-lg backdrop-blur-md hover:bg-emerald-900/90 transition-all active:scale-95 cursor-pointer"
          >
            <span className="flex -space-x-1">
              {coopParticipants.slice(0, 3).map((peer) => (
                <span
                  key={peer.playerId}
                  className="w-2.5 h-2.5 rounded-full ring-1 ring-slate-950 inline-block"
                  style={{ backgroundColor: peer.avatarColorHex }}
                />
              ))}
            </span>
            <span className="hidden sm:inline">{coopRoomCode}</span>
            <span>{coopParticipants.length}</span>
          </button>
        )}
      </div>

      {/* Top Right: Actions */}
      <div className="pointer-events-auto flex items-center gap-2">
        {/* Co-op & Share Link Button */}
        {onOpenCoop && (
          <button
            type="button"
            data-testid="topbar-coop-btn"
            onClick={onOpenCoop}
            title={coopRoomCode ? `Manage Co-op Room (${coopRoomCode})` : 'Co-op Multiplayer & Share Link'}
            aria-label="Co-op Multiplayer and Share Link"
            className={`p-2 rounded-full shadow-lg backdrop-blur-md border transition-all active:scale-95 cursor-pointer ${
              coopRoomCode
                ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/50 ring-1 ring-emerald-400'
                : 'bg-slate-900/80 text-slate-200 border-slate-700/60 hover:bg-slate-800/80'
            }`}
          >
            <Users size={18} />
          </button>
        )}

        {/* Toggle Preview Button */}
        <button
          type="button"
          onClick={onTogglePreview}
          title={isPreviewMode ? 'Return to Puzzle' : 'Show Original Preview'}
          className={`p-2 rounded-full shadow-lg backdrop-blur-md border transition-all active:scale-95 cursor-pointer ${
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
            className={`p-2 rounded-full shadow-lg backdrop-blur-md border transition-all active:scale-95 cursor-pointer ${
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
          className="p-2 rounded-full bg-slate-900/80 text-slate-200 border border-slate-700/60 shadow-lg backdrop-blur-md hover:bg-slate-800/80 transition-all active:scale-95 cursor-pointer"
        >
          <ImagePlus size={18} />
        </button>

        {/* Settings Button */}
        <button
          type="button"
          onClick={onOpenSettings}
          title="Settings and Menu"
          className="p-2 rounded-full bg-slate-900/80 text-slate-200 border border-slate-700/60 shadow-lg backdrop-blur-md hover:bg-slate-800/80 transition-all active:scale-95 cursor-pointer"
        >
          <Settings size={18} />
        </button>
      </div>
    </header>
  );
};
