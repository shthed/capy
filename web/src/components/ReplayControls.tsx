import React, { useState, useEffect, useRef } from 'react';
import {
  Crosshair,
  FastForward,
  Pause,
  Play,
  Repeat,
  RotateCcw,
  SkipForward,
  X,
} from 'lucide-react';

export const REPLAY_SPEED_OPTIONS = [0.5, 1, 2, 5, 10, 20];

interface ReplayControlsProps {
  isOpen: boolean;
  isPlaying: boolean;
  currentStep: number;
  totalSteps: number;
  replaySpeed: number;
  raiseDock: boolean;
  stackAbovePalette?: boolean;
  isLooping?: boolean;
  isFollowing?: boolean;
  onTogglePlay: () => void;
  onRestart: () => void;
  onSkipToEnd: () => void;
  onSeek: (step: number) => void;
  onChangeSpeed: (speed: number) => void;
  onToggleLoop?: () => void;
  onToggleFollow?: () => void;
  onExitReplay: () => void;
  onUserInteract?: () => void;
}

export const ReplayControls: React.FC<ReplayControlsProps> = React.memo(({
  isOpen,
  isPlaying,
  currentStep,
  totalSteps,
  replaySpeed,
  raiseDock,
  stackAbovePalette = false,
  isLooping = false,
  isFollowing = false,
  onTogglePlay,
  onRestart,
  onSkipToEnd,
  onSeek,
  onChangeSpeed,
  onToggleLoop,
  onToggleFollow,
  onExitReplay,
  onUserInteract,
}) => {
  const [isScrubbing, setIsScrubbing] = useState<boolean>(false);
  const isScrubbingRef = useRef<boolean>(false);
  const [hoverStep, setHoverStep] = useState<number | null>(null);
  const [hoverRatio, setHoverRatio] = useState<number>(0);

  useEffect(() => {
    if (isOpen) {
      isScrubbingRef.current = false;
      setIsScrubbing(false);
      setHoverStep(null);
    }
  }, [isOpen]);

  if (!isOpen || totalSteps <= 0) return null;

  const bottomOffset = stackAbovePalette
    ? raiseDock
      ? 'var(--capy-replay-bottom-raised, 6.25rem)'
      : 'var(--capy-replay-bottom, 4.625rem)'
    : raiseDock
    ? '1.5rem'
    : '1rem';

  const isFinished = currentStep >= totalSteps;
  const exactRatio = Math.min(1, Math.max(0, currentStep / totalSteps));
  const pct = Math.round(exactRatio * 100);

  const handleCycleSpeed = () => {
    onUserInteract?.();
    const idx = REPLAY_SPEED_OPTIONS.indexOf(replaySpeed);
    const nextIdx = (idx + 1) % REPLAY_SPEED_OPTIONS.length;
    onChangeSpeed(REPLAY_SPEED_OPTIONS[nextIdx]);
  };

  const computeStepFromPointer = (clientX: number, rect: DOMRect) => {
    if (rect.width <= 0) return { step: currentStep, ratio: exactRatio };
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    const step = Math.round(ratio * totalSteps);
    return { step, ratio };
  };

  const handleTrackPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    onUserInteract?.();
    isScrubbingRef.current = true;
    setIsScrubbing(true);
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // Ignore if pointer capture is unsupported in synthetic test events
    }
    const rect = e.currentTarget.getBoundingClientRect();
    const { step, ratio } = computeStepFromPointer(e.clientX, rect);
    setHoverStep(step);
    setHoverRatio(ratio);
    onSeek(step);
  };

  const handleTrackPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const { step, ratio } = computeStepFromPointer(e.clientX, rect);
    setHoverStep(step);
    setHoverRatio(ratio);
    if (isScrubbingRef.current) {
      onSeek(step);
    }
  };

  const handleTrackPointerUpOrCancel = (e: React.PointerEvent<HTMLDivElement>) => {
    if (isScrubbingRef.current || isScrubbing) {
      isScrubbingRef.current = false;
      setIsScrubbing(false);
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {
        // Ignore
      }
    }
  };

  const renderYouTubeScrubber = () => {
    const previewStep = isScrubbing ? currentStep : hoverStep;
    const previewPct =
      previewStep !== null ? Math.round((previewStep / totalSteps) * 100) : pct;
    const tooltipRatio = isScrubbing ? exactRatio : hoverRatio;

    return (
      <div
        data-testid="replay-scrubber-track"
        onPointerDown={handleTrackPointerDown}
        onPointerMove={handleTrackPointerMove}
        onPointerUp={handleTrackPointerUpOrCancel}
        onPointerCancel={handleTrackPointerUpOrCancel}
        onPointerLeave={() => {
          if (!isScrubbing) setHoverStep(null);
        }}
        className="capy-replay-scrubber relative flex-1 min-w-[44px] sm:min-w-[140px] h-7 flex items-center cursor-pointer select-none touch-none group"
      >
        {/* YouTube-style hover / scrub preview pill above thumb */}
        {previewStep !== null && (
          <div
            className="pointer-events-none absolute -top-6 -translate-x-1/2 px-1.5 py-0.5 rounded bg-slate-950/95 border border-amber-400/50 text-[10px] font-bold text-amber-300 tabular-nums whitespace-nowrap shadow-lg"
            style={{
              left: `${Math.min(94, Math.max(6, tooltipRatio * 100))}%`,
            }}
          >
            {previewStep}/{totalSteps} ({previewPct}%)
          </div>
        )}

        {/* Background Track */}
        <div className="capy-replay-track relative w-full h-1.5 group-hover:h-2.5 bg-slate-800/95 rounded-full overflow-visible transition-[height] duration-75">
          {/* Hover preview ghost fill */}
          {hoverStep !== null && !isScrubbing && (
            <div
              className="pointer-events-none absolute inset-y-0 left-0 bg-slate-600/60 rounded-full transition-none"
              style={{ width: `${hoverRatio * 100}%` }}
            />
          )}

          {/* Active filled progress bar (zero CSS transition delay for instant scrubbing) */}
          <div
            className="pointer-events-none absolute inset-y-0 left-0 bg-amber-400 rounded-full transition-none"
            style={{ width: `${exactRatio * 100}%` }}
          />

          {/* YouTube-style Scrubber Thumb Handle */}
          <div
            className={`capy-replay-thumb pointer-events-none absolute top-1/2 -translate-y-1/2 -translate-x-1/2 rounded-full bg-amber-400 ring-2 ring-slate-950 shadow-md transition-transform duration-75 ${
              isScrubbing
                ? 'w-4 h-4 scale-110'
                : 'w-3.5 h-3.5 group-hover:scale-110'
            }`}
            style={{ left: `${exactRatio * 100}%` }}
          />
        </div>

        {/* Native Range Input overlaid for accessibility, keyboard scrubbing, and automated E2E tests */}
        <input
          type="range"
          min={0}
          max={totalSteps}
          step={1}
          value={currentStep}
          aria-label="Replay Timeline Scrubber"
          data-testid="replay-scrubber"
          onInput={(e) => {
            onUserInteract?.();
            onSeek(Number((e.target as HTMLInputElement).value));
          }}
          onChange={(e) => {
            onUserInteract?.();
            onSeek(Number(e.target.value));
          }}
          className="absolute inset-0 w-full h-full opacity-0 pointer-events-none m-0"
        />
      </div>
    );
  };

  return (
    <div
      className="fixed inset-x-0 z-30 pointer-events-none flex justify-center px-3 transition-all"
      style={{
        bottom: `calc(${bottomOffset} + var(--sab, 0px))`,
      }}
    >
      <div
        data-testid="replay-controls-window"
        className="capy-replay-window pointer-events-auto w-full max-w-2xl flex items-center gap-1 sm:gap-2 bg-slate-900/94 border border-amber-400/40 rounded-full shadow-2xl backdrop-blur-xl px-1.5 sm:px-3 py-1.5 text-slate-100 animate-in fade-in slide-in-from-bottom-2 duration-200"
      >
        {/* Play / Pause / Replay */}
        <button
          type="button"
          onClick={isFinished ? onRestart : onTogglePlay}
          aria-label={isFinished ? 'Replay Again' : isPlaying ? 'Pause Replay' : 'Resume Replay'}
          title={isFinished ? 'Replay Again' : isPlaying ? 'Pause Replay' : 'Resume Replay'}
          data-testid="replay-play-pause-btn"
          className="capy-replay-play-btn inline-flex items-center justify-center min-w-[38px] min-h-[38px] sm:w-10 sm:h-10 rounded-full bg-amber-400 hover:bg-amber-300 text-slate-950 shadow transition-all active:scale-95 cursor-pointer flex-shrink-0"
        >
          {isFinished ? (
            <RotateCcw size={15} />
          ) : isPlaying ? (
            <Pause size={15} />
          ) : (
            <Play size={15} className="ml-0.5" />
          )}
        </button>

        {/* Dominant Interactive YouTube-Style Progress Slider (takes up most of the bar width) */}
        {renderYouTubeScrubber()}

        {/* Speed Selector */}
        <button
          type="button"
          onClick={handleCycleSpeed}
          aria-label={`Change Replay Speed (currently ${replaySpeed}x)`}
          title="Change Replay Speed"
          data-testid="replay-speed-btn"
          className="capy-replay-speed-btn inline-flex items-center justify-center gap-0.5 min-h-[38px] sm:min-h-[40px] px-2 sm:px-2.5 rounded-full text-[11px] font-extrabold bg-slate-800 hover:bg-slate-700 text-amber-300 border border-slate-700 transition-colors tabular-nums cursor-pointer flex-shrink-0"
        >
          <FastForward size={12} />
          <span>{replaySpeed}x</span>
        </button>

        {/* Follow Painting Toggle */}
        {onToggleFollow && (
          <button
            type="button"
            onClick={() => {
              onUserInteract?.();
              onToggleFollow();
            }}
            aria-pressed={isFollowing}
            aria-label={
              isFollowing
                ? 'Follow Painting Active'
                : 'Follow Painting'
            }
            title={
              isFollowing
                ? 'Follow Painting Active'
                : 'Follow Painting'
            }
            data-testid="replay-follow-btn"
            className={`capy-replay-icon-btn inline-flex items-center justify-center min-w-[38px] min-h-[38px] sm:min-w-[40px] sm:min-h-[40px] rounded-full border transition-colors cursor-pointer flex-shrink-0 ${
              isFollowing
                ? 'bg-amber-400/20 text-amber-300 border-amber-400/60'
                : 'bg-slate-800 hover:bg-slate-700 text-slate-400 border-slate-700'
            }`}
          >
            <Crosshair size={15} />
          </button>
        )}

        {/* Auto-Loop Toggle */}
        {onToggleLoop && (
          <button
            type="button"
            onClick={() => {
              onUserInteract?.();
              onToggleLoop();
            }}
            aria-pressed={isLooping}
            aria-label={
              isLooping
                ? 'Auto-Loop Replay On'
                : 'Auto-Loop Replay'
            }
            title={
              isLooping
                ? 'Auto-Loop Replay On'
                : 'Auto-Loop Replay'
            }
            data-testid="replay-loop-btn"
            className={`capy-replay-icon-btn inline-flex items-center justify-center min-w-[38px] min-h-[38px] sm:min-w-[40px] sm:min-h-[40px] rounded-full border transition-colors cursor-pointer flex-shrink-0 ${
              isLooping
                ? 'bg-amber-400/20 text-amber-300 border-amber-400/60'
                : 'bg-slate-800 hover:bg-slate-700 text-slate-400 border-slate-700'
            }`}
          >
            <Repeat size={15} />
          </button>
        )}

        {/* Skip to End (kept mounted when finished so replay controls never shift horizontally) */}
        <button
          type="button"
          disabled={isFinished}
          onClick={onSkipToEnd}
          aria-label="Skip to Completed Artwork"
          title="Skip to Completed Artwork"
          data-testid="replay-skip-btn"
          className={`capy-replay-icon-btn inline-flex items-center justify-center min-w-[38px] min-h-[38px] sm:min-w-[40px] sm:min-h-[40px] rounded-full border transition-colors flex-shrink-0 ${
            isFinished
              ? 'bg-slate-800/50 text-slate-600 border-slate-800 opacity-45 cursor-not-allowed'
              : 'bg-slate-800 hover:bg-slate-700 text-slate-200 border-slate-700 cursor-pointer'
          }`}
        >
          <SkipForward size={15} />
        </button>

        {/* Exit Replay */}
        <button
          type="button"
          onClick={onExitReplay}
          aria-label="Exit Replay"
          title="Exit Replay"
          data-testid="replay-exit-btn"
          className="capy-replay-icon-btn inline-flex items-center justify-center min-w-[38px] min-h-[38px] sm:min-w-[40px] sm:min-h-[40px] rounded-full text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer flex-shrink-0"
        >
          <X size={16} />
        </button>
      </div>
    </div>
  );
});
