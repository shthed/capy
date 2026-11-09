import React from 'react';
import {
  Download,
  FastForward,
  ImagePlus,
  Pause,
  Play,
  RotateCcw,
  SkipForward,
  Sparkles,
  X,
} from 'lucide-react';

export const REPLAY_SPEED_OPTIONS = [0.5, 1, 2, 5, 10];

interface ReplayControlsProps {
  isOpen: boolean;
  isPlaying: boolean;
  currentStep: number;
  totalSteps: number;
  replaySpeed: number;
  raiseDock: boolean;
  onTogglePlay: () => void;
  onRestart: () => void;
  onSkipToEnd: () => void;
  onSeek: (step: number) => void;
  onChangeSpeed: (speed: number) => void;
  onExitReplay: () => void;
  onExportImage: () => void;
  onOpenCreate: () => void;
}

export const ReplayControls: React.FC<ReplayControlsProps> = ({
  isOpen,
  isPlaying,
  currentStep,
  totalSteps,
  replaySpeed,
  raiseDock,
  onTogglePlay,
  onRestart,
  onSkipToEnd,
  onSeek,
  onChangeSpeed,
  onExitReplay,
  onExportImage,
  onOpenCreate,
}) => {
  if (!isOpen || totalSteps <= 0) return null;

  const isFinished = currentStep >= totalSteps;
  const pct = Math.min(100, Math.max(0, Math.round((currentStep / totalSteps) * 100)));

  const handleCycleSpeed = () => {
    const idx = REPLAY_SPEED_OPTIONS.indexOf(replaySpeed);
    const nextIdx = (idx + 1) % REPLAY_SPEED_OPTIONS.length;
    onChangeSpeed(REPLAY_SPEED_OPTIONS[nextIdx]);
  };

  return (
    <div
      className="fixed inset-x-0 z-30 pointer-events-none flex justify-center px-3 transition-all"
      style={{
        bottom: `calc(${raiseDock ? '5.75rem' : '4.25rem'} + var(--sab, 0px))`,
      }}
    >
      <div className="pointer-events-auto w-full max-w-md bg-slate-900/92 border border-amber-400/40 rounded-2xl shadow-2xl backdrop-blur-xl p-3 text-slate-100 space-y-2.5 animate-in fade-in slide-in-from-bottom-3 duration-200">
        {/* Top Row: Replay Badge, Region Counter & Close */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-amber-400 text-slate-950">
              <Sparkles size={10} />
              {isFinished ? 'Completed' : 'Replay'}
            </span>
            <span className="text-xs font-bold text-slate-200 tabular-nums">
              {currentStep} / {totalSteps} regions ({pct}%)
            </span>
          </div>

          <button
            type="button"
            onClick={onExitReplay}
            title="Exit Replay"
            className="p-1 rounded-full text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
          >
            <X size={16} />
          </button>
        </div>

        {/* Interactive Scrubber */}
        <div className="flex items-center gap-2">
          <input
            type="range"
            min={0}
            max={totalSteps}
            value={currentStep}
            onChange={(e) => onSeek(Number(e.target.value))}
            className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-amber-400"
          />
        </div>

        {/* Playback Controls */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5">
            {/* Play / Pause / Restart */}
            <button
              type="button"
              onClick={isFinished ? onRestart : onTogglePlay}
              title={isFinished ? 'Replay Again' : isPlaying ? 'Pause Replay' : 'Resume Replay'}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold bg-amber-400 hover:bg-amber-300 text-slate-950 shadow transition-all active:scale-95 cursor-pointer"
            >
              {isFinished ? (
                <>
                  <RotateCcw size={14} />
                  <span>Replay</span>
                </>
              ) : isPlaying ? (
                <>
                  <Pause size={14} />
                  <span>Pause</span>
                </>
              ) : (
                <>
                  <Play size={14} />
                  <span>Play</span>
                </>
              )}
            </button>

            {/* Restart from 0 */}
            {!isFinished && (
              <button
                type="button"
                onClick={onRestart}
                title="Restart Replay from Beginning"
                className="p-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition-colors cursor-pointer"
              >
                <RotateCcw size={14} />
              </button>
            )}

            {/* Skip to End */}
            {!isFinished && (
              <button
                type="button"
                onClick={onSkipToEnd}
                title="Skip to Completed Artwork"
                className="p-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition-colors cursor-pointer"
              >
                <SkipForward size={14} />
              </button>
            )}

            {/* Speed Selector */}
            <button
              type="button"
              onClick={handleCycleSpeed}
              title="Change Replay Speed"
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl text-xs font-extrabold bg-slate-800 hover:bg-slate-700 text-amber-300 border border-slate-700 transition-colors tabular-nums cursor-pointer"
            >
              <FastForward size={13} />
              <span>{replaySpeed}x</span>
            </button>
          </div>

          {/* Post-Completion Quick Actions */}
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={onExportImage}
              title="Download PNG Artwork"
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition-colors cursor-pointer"
            >
              <Download size={13} />
              <span className="hidden sm:inline">Save PNG</span>
            </button>

            <button
              type="button"
              onClick={onOpenCreate}
              title="Pick Next Artwork"
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition-colors cursor-pointer"
            >
              <ImagePlus size={13} />
              <span className="hidden sm:inline">Next</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
