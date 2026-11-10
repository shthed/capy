import React, { useState, useEffect } from 'react';
import {
  ChevronDown,
  ChevronUp,
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
  onResumeFromStep?: (step: number) => void;
  onUserInteract?: () => void;
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
  onResumeFromStep,
  onUserInteract,
}) => {
  const [isMinimized, setIsMinimized] = useState<boolean>(true);

  useEffect(() => {
    if (isOpen) {
      setIsMinimized(true);
    }
  }, [isOpen]);

  if (!isOpen || totalSteps <= 0) return null;

  const isFinished = currentStep >= totalSteps;
  const pct = Math.min(100, Math.max(0, Math.round((currentStep / totalSteps) * 100)));

  const handleCycleSpeed = () => {
    onUserInteract?.();
    const idx = REPLAY_SPEED_OPTIONS.indexOf(replaySpeed);
    const nextIdx = (idx + 1) % REPLAY_SPEED_OPTIONS.length;
    onChangeSpeed(REPLAY_SPEED_OPTIONS[nextIdx]);
  };

  if (isMinimized) {
    return (
      <div
        className="fixed inset-x-0 z-30 pointer-events-none flex justify-center px-3 transition-all"
        style={{
          bottom: `calc(${raiseDock ? '1.5rem' : '1rem'} + var(--sab, 0px))`,
        }}
      >
        <div
          data-testid="replay-controls-window"
          data-minimized="true"
          className="pointer-events-auto inline-flex items-center gap-2 bg-slate-900/92 border border-amber-400/40 rounded-full shadow-2xl backdrop-blur-xl px-2.5 py-1.5 text-slate-100 animate-in fade-in slide-in-from-bottom-2 duration-200"
        >
          {/* Play / Pause / Replay */}
          <button
            type="button"
            onClick={isFinished ? onRestart : onTogglePlay}
            aria-label={isFinished ? 'Replay Again' : isPlaying ? 'Pause Replay' : 'Resume Replay'}
            title={isFinished ? 'Replay Again' : isPlaying ? 'Pause Replay' : 'Resume Replay'}
            data-testid="replay-play-pause-btn"
            className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-amber-400 hover:bg-amber-300 text-slate-950 shadow transition-all active:scale-95 cursor-pointer flex-shrink-0"
          >
            {isFinished ? (
              <RotateCcw size={13} />
            ) : isPlaying ? (
              <Pause size={13} />
            ) : (
              <Play size={13} className="ml-0.5" />
            )}
          </button>

          {/* Compact Progress Bar & Step Counter */}
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-16 sm:w-24 h-1.5 bg-slate-800 rounded-full overflow-hidden flex-shrink-0">
              <div
                className="h-full bg-amber-400 transition-all duration-75"
                style={{ width: `${pct}%` }}
              />
            </div>
            <span className="text-[11px] font-bold text-slate-200 tabular-nums whitespace-nowrap">
              {currentStep}/{totalSteps} ({pct}%)
            </span>
          </div>

          {/* Speed Selector */}
          <button
            type="button"
            onClick={handleCycleSpeed}
            aria-label="Change Replay Speed"
            title="Change Replay Speed"
            data-testid="replay-speed-btn"
            className="inline-flex items-center gap-0.5 px-2 py-1 rounded-full text-[11px] font-extrabold bg-slate-800 hover:bg-slate-700 text-amber-300 border border-slate-700 transition-colors tabular-nums cursor-pointer flex-shrink-0"
          >
            <FastForward size={11} />
            <span>{replaySpeed}x</span>
          </button>

          {/* Skip to End */}
          {!isFinished && (
            <button
              type="button"
              onClick={onSkipToEnd}
              aria-label="Skip to Completed Artwork"
              title="Skip to Completed Artwork"
              data-testid="replay-skip-btn"
              className="p-1.5 rounded-full bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition-colors cursor-pointer flex-shrink-0"
            >
              <SkipForward size={12} />
            </button>
          )}

          {/* Expand Controls Button */}
          <button
            type="button"
            onClick={() => {
              onUserInteract?.();
              setIsMinimized(false);
            }}
            aria-label="Expand Replay Controls"
            title="Expand Replay Controls"
            data-testid="replay-toggle-minimize-btn"
            className="p-1.5 rounded-full bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition-colors cursor-pointer flex-shrink-0"
          >
            <ChevronUp size={13} />
          </button>

          {/* Exit Replay */}
          <button
            type="button"
            onClick={onExitReplay}
            aria-label="Exit Replay"
            title="Exit Replay"
            data-testid="replay-exit-btn"
            className="p-1 rounded-full text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer flex-shrink-0"
          >
            <X size={14} />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      className="fixed inset-x-0 z-30 pointer-events-none flex justify-center px-3 transition-all"
      style={{
        bottom: `calc(${raiseDock ? '1.5rem' : '1rem'} + var(--sab, 0px))`,
      }}
    >
      <div
        data-testid="replay-controls-window"
        data-minimized="false"
        className="pointer-events-auto w-full max-w-md bg-slate-900/92 border border-amber-400/40 rounded-2xl shadow-2xl backdrop-blur-xl p-3 text-slate-100 space-y-2.5 animate-in fade-in slide-in-from-bottom-3 duration-200"
      >
        {/* Top Row: Replay Badge, Region Counter, Resume Play Action, Minimise & Close */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-amber-400 text-slate-950 flex-shrink-0">
              <Sparkles size={10} />
              {isFinished ? 'Completed' : 'Replay'}
            </span>
            <span className="text-xs font-bold text-slate-200 tabular-nums truncate">
              {currentStep} / {totalSteps} regions ({pct}%)
            </span>
          </div>

          <div className="flex items-center gap-1.5 flex-shrink-0">
            {onResumeFromStep && (
              <button
                type="button"
                onClick={() => onResumeFromStep(currentStep)}
                aria-label="Resume Play From Here"
                title={`Resume active gameplay from region step ${currentStep}`}
                data-testid="replay-resume-btn"
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-bold bg-amber-400 hover:bg-amber-300 text-slate-950 shadow-md transition-all active:scale-95 cursor-pointer"
              >
                <Play size={12} className="fill-slate-950" />
                <span>Resume Here</span>
              </button>
            )}

            <button
              type="button"
              onClick={() => {
                onUserInteract?.();
                setIsMinimized(true);
              }}
              aria-label="Minimise Replay Controls"
              title="Minimise Replay Controls"
              data-testid="replay-toggle-minimize-btn"
              className="p-1 rounded-full text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
            >
              <ChevronDown size={16} />
            </button>

            <button
              type="button"
              onClick={onExitReplay}
              aria-label="Exit Replay"
              title="Exit Replay"
              data-testid="replay-exit-btn"
              className="p-1 rounded-full text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Interactive Scrubber */}
        <div className="flex items-center gap-2">
          <input
            type="range"
            min={0}
            max={totalSteps}
            value={currentStep}
            aria-label="Replay Timeline Scrubber"
            data-testid="replay-scrubber"
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
              aria-label={isFinished ? 'Replay Again' : isPlaying ? 'Pause Replay' : 'Resume Replay'}
              title={isFinished ? 'Replay Again' : isPlaying ? 'Pause Replay' : 'Resume Replay'}
              data-testid="replay-play-pause-btn"
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
                aria-label="Restart Replay from Beginning"
                title="Restart Replay from Beginning"
                data-testid="replay-restart-btn"
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
                aria-label="Skip to Completed Artwork"
                title="Skip to Completed Artwork"
                data-testid="replay-skip-btn"
                className="p-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition-colors cursor-pointer"
              >
                <SkipForward size={14} />
              </button>
            )}

            {/* Speed Selector */}
            <button
              type="button"
              onClick={handleCycleSpeed}
              aria-label="Change Replay Speed"
              title="Change Replay Speed"
              data-testid="replay-speed-btn"
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
