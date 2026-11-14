import React, { useEffect, useRef } from 'react';
import {
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Eye,
  Hand,
  Palette,
  Sparkles,
  X,
  ZoomIn,
} from 'lucide-react';

export interface TutorialTriedActions {
  palette: boolean;
  paint: boolean;
  zoom: boolean;
  hint: boolean;
  menu: boolean;
}

interface OnboardingTutorialProps {
  isOpen: boolean;
  isModalOpen?: boolean;
  stepIndex: number;
  triedActions: TutorialTriedActions;
  onStepChange: (nextStep: number) => void;
  onTriggerHint: () => void;
  onComplete: () => void;
  onSkip: () => void;
}

interface TutorialStepDef {
  key: keyof TutorialTriedActions;
  title: string;
  description: string;
  tryPrompt: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
}

const TUTORIAL_STEPS: TutorialStepDef[] = [
  {
    key: 'palette',
    title: 'Pick a Color',
    description:
      'Choose a numbered color from the bottom Palette Dock. Easy Mode also auto-matches tapped regions.',
    tryPrompt: 'Tap any color swatch below (or press 1–9)',
    icon: Palette,
  },
  {
    key: 'paint',
    title: 'Tap or Paint Shapes',
    description:
      'Tap matching regions to fill them, or toggle the Paintbrush button to drag-paint continuously.',
    tryPrompt: 'Tap any region on Capy Forest to color it!',
    icon: Hand,
  },
  {
    key: 'zoom',
    title: 'Zoom & Pan',
    description:
      'Pinch with two fingers, double-tap & drag, scroll, or tap the top 1x zoom badge to inspect details.',
    tryPrompt: 'Zoom or pan the puzzle (tap 1x badge, scroll, or drag)',
    icon: ZoomIn,
  },
  {
    key: 'hint',
    title: 'Smart Hints',
    description:
      'Double-tap any active color swatch to highlight and center a remaining region. Long-press Undo for replay.',
    tryPrompt: 'Double-tap any swatch below (or tap Try Hint)',
    icon: Sparkles,
  },
  {
    key: 'menu',
    title: 'Preview, Saves & Menu',
    description:
      'Use the Eye icon to peek at the original artwork, tap the top progress pill for Saves & Co-op, or open Menu.',
    tryPrompt: 'Tap the Eye icon to peek (optional), then hit Finish!',
    icon: Eye,
  },
];

export const OnboardingTutorial: React.FC<OnboardingTutorialProps> = ({
  isOpen,
  isModalOpen = false,
  stepIndex,
  triedActions,
  onStepChange,
  onTriggerHint,
  onComplete,
  onSkip,
}) => {
  const autoAdvanceTimerRef = useRef<number | null>(null);
  const clampedStep = Math.max(0, Math.min(TUTORIAL_STEPS.length - 1, stepIndex));
  const currentStep = TUTORIAL_STEPS[clampedStep];
  const isCurrentTried = triedActions[currentStep.key];
  const isLastStep = clampedStep === TUTORIAL_STEPS.length - 1;

  useEffect(() => {
    if (autoAdvanceTimerRef.current !== null) {
      window.clearTimeout(autoAdvanceTimerRef.current);
      autoAdvanceTimerRef.current = null;
    }
    if (!isOpen || isLastStep || !isCurrentTried) return;

    autoAdvanceTimerRef.current = window.setTimeout(() => {
      autoAdvanceTimerRef.current = null;
      onStepChange(clampedStep + 1);
    }, 750);

    return () => {
      if (autoAdvanceTimerRef.current !== null) {
        window.clearTimeout(autoAdvanceTimerRef.current);
        autoAdvanceTimerRef.current = null;
      }
    };
  }, [isOpen, isLastStep, isCurrentTried, clampedStep, onStepChange]);

  useEffect(() => {
    if (!isOpen || isModalOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onSkip();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, isModalOpen, onSkip]);

  if (!isOpen) return null;

  const Icon = currentStep.icon;

  return (
    <div
      className="fixed inset-x-0 z-40 pointer-events-none flex justify-center px-3"
      style={{
        top: 'calc(3.55rem + var(--sat, 0px))',
      }}
    >
      <div
        data-testid="onboarding-tutorial"
        className="pointer-events-auto w-full max-w-md rounded-2xl bg-slate-900/94 border border-amber-400/50 shadow-2xl backdrop-blur-xl p-3 sm:p-3.5 text-slate-100 space-y-2.5 animate-in fade-in slide-in-from-top-2 duration-200"
      >
        {/* Header */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <span className="inline-flex items-center justify-center w-7 h-7 rounded-xl bg-amber-400/20 border border-amber-400/40 text-amber-300 flex-shrink-0">
              <Icon size={15} />
            </span>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <span
                  data-testid="tutorial-step-indicator"
                  className="text-[10px] font-extrabold uppercase tracking-wider text-amber-300"
                >
                  Step {clampedStep + 1} of {TUTORIAL_STEPS.length}
                </span>
                {isCurrentTried && (
                  <span
                    data-testid="tutorial-step-tried-badge"
                    className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-emerald-500/20 border border-emerald-400/50 text-[10px] font-extrabold text-emerald-300"
                  >
                    <CheckCircle2 size={10} />
                    <span>Tried!</span>
                  </span>
                )}
              </div>
              <h3 className="text-xs sm:text-sm font-extrabold text-white truncate">
                {currentStep.title}
              </h3>
            </div>
          </div>

          <button
            type="button"
            onClick={onSkip}
            data-testid="tutorial-skip-btn"
            aria-label="Skip Tutorial"
            className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-bold text-slate-400 hover:text-white hover:bg-slate-800/80 transition-colors cursor-pointer flex-shrink-0"
          >
            <span>Skip</span>
            <X size={13} />
          </button>
        </div>

        {/* Description */}
        <p className="text-[11px] sm:text-xs leading-relaxed text-slate-300">
          {currentStep.description}
        </p>

        {/* Interactive Try Prompt */}
        <div
          data-testid="tutorial-try-pill"
          className={`flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-xl border text-[11px] font-semibold ${
            isCurrentTried
              ? 'bg-emerald-950/50 border-emerald-500/40 text-emerald-200'
              : 'bg-slate-950/75 border-slate-800 text-amber-200'
          }`}
        >
          <span className="min-w-0">{currentStep.tryPrompt}</span>
          {currentStep.key === 'hint' && (
            <button
              type="button"
              data-testid="tutorial-try-hint-btn"
              onClick={onTriggerHint}
              className="px-2 py-1 rounded-lg bg-amber-400 hover:bg-amber-300 text-slate-950 text-[10px] font-extrabold transition-colors cursor-pointer flex-shrink-0"
            >
              Try Hint
            </button>
          )}
        </div>

        {/* Progress Dots + Navigation */}
        <div className="flex items-center justify-between gap-2 pt-0.5">
          <div className="flex items-center gap-1">
            {TUTORIAL_STEPS.map((step, idx) => (
              <button
                key={step.key}
                type="button"
                aria-label={`Go to tutorial step ${idx + 1}`}
                onClick={() => onStepChange(idx)}
                className={`h-1.5 rounded-full transition-all cursor-pointer ${
                  idx === clampedStep
                    ? 'w-5 bg-amber-400'
                    : triedActions[step.key]
                    ? 'w-2 bg-emerald-400/80'
                    : 'w-2 bg-slate-700 hover:bg-slate-600'
                }`}
              />
            ))}
          </div>

          <div className="flex items-center gap-1.5">
            {clampedStep > 0 && (
              <button
                type="button"
                data-testid="tutorial-prev-btn"
                onClick={() => onStepChange(clampedStep - 1)}
                className="inline-flex items-center gap-0.5 px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold border border-slate-700 transition-colors cursor-pointer"
              >
                <ChevronLeft size={13} />
                <span>Back</span>
              </button>
            )}

            {isLastStep ? (
              <button
                type="button"
                data-testid="tutorial-finish-btn"
                onClick={onComplete}
                className="inline-flex items-center gap-1 px-3 py-1 rounded-lg bg-amber-400 hover:bg-amber-300 text-slate-950 text-xs font-extrabold shadow transition-colors cursor-pointer"
              >
                <span>Finish Coloring</span>
              </button>
            ) : (
              <button
                type="button"
                data-testid="tutorial-next-btn"
                onClick={() => onStepChange(clampedStep + 1)}
                className="inline-flex items-center gap-0.5 px-3 py-1 rounded-lg bg-amber-400 hover:bg-amber-300 text-slate-950 text-xs font-extrabold shadow transition-colors cursor-pointer"
              >
                <span>Next</span>
                <ChevronRight size={13} />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
