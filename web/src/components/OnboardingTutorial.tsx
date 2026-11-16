import React, { useEffect, useRef, useState } from 'react';
import {
  Camera,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Compass,
  Eye,
  Film,
  Hand,
  List,
  Palette,
  Paintbrush,
  Save,
  Sliders,
  Sparkles,
  Undo2,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';

export type TutorialStepKey =
  | 'palette'
  | 'paint'
  | 'zoom'
  | 'hint'
  | 'undo_redo'
  | 'replay'
  | 'peek_fullscreen'
  | 'free_color'
  | 'gallery_daily'
  | 'custom_photo'
  | 'puzzle_presets'
  | 'infinite_zoom'
  | 'saves_export'
  | 'settings_a11y';

export type TutorialTriedActions = Record<TutorialStepKey, boolean>;

export function createInitialTutorialTried(): TutorialTriedActions {
  return {
    palette: false,
    paint: false,
    zoom: false,
    hint: false,
    undo_redo: false,
    replay: false,
    peek_fullscreen: false,
    free_color: false,
    gallery_daily: false,
    custom_photo: false,
    puzzle_presets: false,
    infinite_zoom: false,
    saves_export: false,
    settings_a11y: false,
  };
}

interface OnboardingTutorialProps {
  isOpen: boolean;
  isModalOpen?: boolean;
  isLoading?: boolean;
  stepIndex: number;
  triedActions: TutorialTriedActions;
  triedInCurrentVisit?: boolean;
  largeText?: boolean;
  onToggleLargeText?: () => void;
  onStepChange: (nextStep: number) => void;
  onTriggerHint: () => void;
  onComplete: () => void;
  onSkip: () => void;
}

export interface TutorialStepDef {
  key: TutorialStepKey;
  title: string;
  description: string;
  tryPrompt: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
}

export const TUTORIAL_STEPS: TutorialStepDef[] = [
  {
    key: 'palette',
    title: 'Pick a Color',
    description: 'Tap any numbered color at the bottom to select it.',
    tryPrompt: 'Try it: Tap a color below',
    icon: Palette,
  },
  {
    key: 'paint',
    title: 'Tap to Color',
    description:
      'Tap shapes matching your color, or tap the brush on the right to drag-paint.',
    tryPrompt: 'Try it: Tap a matching number on the picture',
    icon: Hand,
  },
  {
    key: 'zoom',
    title: 'Zoom & Move',
    description:
      'Pinch with two fingers to zoom in, or drag with one finger to look around.',
    tryPrompt: 'Try it: Pinch or scroll to zoom in',
    icon: ZoomIn,
  },
  {
    key: 'hint',
    title: 'Find Hard Shapes',
    description:
      'Can’t spot the last shape? Tap your selected color again to jump right to it.',
    tryPrompt: 'Try it: Tap your active color again',
    icon: Sparkles,
  },
  {
    key: 'undo_redo',
    title: 'Undo Mistakes',
    description:
      'Colored the wrong spot? Tap Undo on the right to step back.',
    tryPrompt: 'Try it: Tap Undo on the right (color a shape first)',
    icon: Undo2,
  },
  {
    key: 'replay',
    title: 'Watch a Replay',
    description:
      'Press and hold Undo anytime to watch your coloring play back like a video.',
    tryPrompt: 'Try it: Press and hold Undo',
    icon: Film,
  },
  {
    key: 'peek_fullscreen',
    title: 'Peek & Full Screen',
    description:
      'Tap the Eye icon to peek at the finished art, or Expand for extra room.',
    tryPrompt: 'Try it: Tap Eye or Expand above',
    icon: Eye,
  },
  {
    key: 'free_color',
    title: 'Paint Any Color',
    description:
      'Want your own shades? Turn on Free Colour Mode in Settings to paint any color you like.',
    tryPrompt: 'Try it: Open the gear menu and check Settings',
    icon: Paintbrush,
  },
  {
    key: 'gallery_daily',
    title: 'Daily Puzzle & Gallery',
    description:
      'Open the top-right menu and tap Create for today’s Daily Puzzle and extra pictures.',
    tryPrompt: 'Try it: Tap Menu > Create',
    icon: Compass,
  },
  {
    key: 'custom_photo',
    title: 'Turn Photos Into Art',
    description:
      'Tap the Photo button at the top to turn your own photo or drawing into a puzzle.',
    tryPrompt: 'Try it: Tap the Photo icon above',
    icon: Camera,
  },
  {
    key: 'puzzle_presets',
    title: 'Puzzle Styles & Presets',
    description:
      'In Menu > Create, pick a style like Line Art, Painterly, or Mosaic, or open the Preset Gallery to compare how each looks.',
    tryPrompt: 'Try it: Open Menu > Create and explore Preset Gallery',
    icon: Sparkles,
  },
  {
    key: 'infinite_zoom',
    title: 'Zoom Into Tiny Details',
    description:
      'In Menu > Create, pick Detail Tile to zoom way into small parts of your picture.',
    tryPrompt: 'Try it: Open Menu > Create > Detail Tile',
    icon: ZoomOut,
  },
  {
    key: 'saves_export',
    title: 'Your Saved Art',
    description:
      'Tap the top-left title pill anytime to switch pictures, save backups, or print pages.',
    tryPrompt: 'Try it: Tap the title pill top-left',
    icon: Save,
  },
  {
    key: 'settings_a11y',
    title: 'Settings & Text Size',
    description:
      'Tap the gear icon anytime for Large Text, sounds, easy tapping, and more.',
    tryPrompt: 'Try it: Tap the gear icon above (or Large Text)',
    icon: Sliders,
  },
];

export const OnboardingTutorial: React.FC<OnboardingTutorialProps> = ({
  isOpen,
  isModalOpen = false,
  isLoading = false,
  stepIndex,
  triedActions,
  triedInCurrentVisit = false,
  largeText = false,
  onToggleLargeText,
  onStepChange,
  onTriggerHint,
  onComplete,
  onSkip,
}) => {
  const autoAdvanceTimerRef = useRef<number | null>(null);
  const [showTopics, setShowTopics] = useState<boolean>(false);

  const clampedStep = Math.max(0, Math.min(TUTORIAL_STEPS.length - 1, stepIndex));
  const currentStep = TUTORIAL_STEPS[clampedStep];
  const isCurrentTried = Boolean(triedActions[currentStep.key]);
  const isLastStep = clampedStep === TUTORIAL_STEPS.length - 1;

  useEffect(() => {
    if (!isOpen) {
      setShowTopics(false);
    }
  }, [isOpen]);

  useEffect(() => {
    if (autoAdvanceTimerRef.current !== null) {
      window.clearTimeout(autoAdvanceTimerRef.current);
      autoAdvanceTimerRef.current = null;
    }
    if (
      !isOpen ||
      isModalOpen ||
      isLoading ||
      showTopics ||
      !triedInCurrentVisit
    ) {
      return;
    }

    autoAdvanceTimerRef.current = window.setTimeout(() => {
      autoAdvanceTimerRef.current = null;
      if (isLastStep) {
        onComplete();
      } else {
        onStepChange(clampedStep + 1);
      }
    }, 750);

    return () => {
      if (autoAdvanceTimerRef.current !== null) {
        window.clearTimeout(autoAdvanceTimerRef.current);
        autoAdvanceTimerRef.current = null;
      }
    };
  }, [
    isOpen,
    isModalOpen,
    isLoading,
    showTopics,
    triedInCurrentVisit,
    isLastStep,
    clampedStep,
    onStepChange,
    onComplete,
  ]);

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
  const progressPercent = Math.round(((clampedStep + 1) / TUTORIAL_STEPS.length) * 100);

  return (
    <div
      className="fixed inset-x-0 z-40 pointer-events-none flex justify-center px-3"
      style={{
        top: 'calc(var(--capy-tutorial-top, 4.75rem) + var(--sat, 0px))',
      }}
    >
      <div
        data-testid="onboarding-tutorial"
        className="pointer-events-auto w-full max-w-md max-h-[calc(100dvh-6.5rem)] overflow-y-auto rounded-2xl bg-slate-900/95 border border-amber-400/50 shadow-2xl backdrop-blur-xl px-3 py-2.5 sm:px-3.5 text-slate-100 space-y-2 animate-in fade-in slide-in-from-top-2 duration-200"
      >
        {onToggleLargeText && clampedStep === 0 && (
          <button
            type="button"
            data-testid="tutorial-large-text-btn"
            aria-pressed={largeText}
            onClick={onToggleLargeText}
            className={`w-full flex items-center justify-between gap-2 px-3 py-1 rounded-xl border text-left text-xs font-extrabold transition-colors cursor-pointer ${
              largeText
                ? 'bg-amber-400 text-slate-950 border-amber-300 hover:bg-amber-300'
                : 'bg-amber-400/10 text-amber-200 border-amber-400/45 hover:bg-amber-400/20'
            }`}
          >
            <span className="truncate">
              {largeText ? 'Large Text: On (tap to switch back)' : 'Too small? Switch to Large Text'}
            </span>
          </button>
        )}

        {/* Header */}
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-start gap-2 min-w-0">
            <span className="inline-flex items-center justify-center w-6 h-6 rounded-lg bg-amber-400/20 border border-amber-400/40 text-amber-300 flex-shrink-0 mt-0.5">
              <Icon size={14} />
            </span>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-1.5">
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
              <h3 className="text-xs sm:text-sm font-extrabold text-white leading-snug">
                {currentStep.title}
              </h3>
            </div>
          </div>

          <div className="flex items-center gap-1 flex-shrink-0">
            {onToggleLargeText && clampedStep > 0 && (
              <button
                type="button"
                data-testid="tutorial-large-text-btn"
                aria-pressed={largeText}
                aria-label={largeText ? 'Large Text On (Tap to Switch Back)' : 'Switch to Large Text'}
                title={largeText ? 'Large Text On (Tap to Switch Back)' : 'Switch to Large Text'}
                onClick={onToggleLargeText}
                className={`inline-flex items-center px-2 py-1 rounded-lg border text-[11px] font-bold transition-colors cursor-pointer flex-shrink-0 whitespace-nowrap ${
                  largeText
                    ? 'bg-amber-400 text-slate-950 border-amber-300 hover:bg-amber-300'
                    : 'bg-slate-800/90 text-amber-200 border-amber-400/50 hover:bg-slate-700'
                }`}
              >
                <span>{largeText ? 'Aa On' : 'Large Text'}</span>
              </button>
            )}

            <button
              type="button"
              onClick={onSkip}
              data-testid="tutorial-skip-btn"
              aria-label="Skip Tutorial"
              className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-bold text-slate-300 hover:text-white hover:bg-slate-800/80 transition-colors cursor-pointer flex-shrink-0"
            >
              <span>Skip</span>
              <X size={13} />
            </button>
          </div>
        </div>

        {/* Jump-to-Topic Drawer */}
        {showTopics && (
          <div
            data-testid="tutorial-topics-drawer"
            className="rounded-xl bg-slate-950/90 border border-slate-700/80 p-2 max-h-52 overflow-y-auto grid grid-cols-1 sm:grid-cols-2 gap-1.5"
          >
            {TUTORIAL_STEPS.map((step, idx) => {
              const isCurrent = idx === clampedStep;
              const isDone = Boolean(triedActions[step.key]);
              return (
                <button
                  key={step.key}
                  type="button"
                  data-testid={`tutorial-topic-item-${idx}`}
                  onClick={() => {
                    setShowTopics(false);
                    onStepChange(idx);
                  }}
                  className={`flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg border text-left text-[11px] font-bold transition-colors cursor-pointer ${
                    isCurrent
                      ? 'bg-amber-400/20 border-amber-400/70 text-amber-200'
                      : 'bg-slate-900/80 border-slate-800 text-slate-200 hover:bg-slate-800'
                  }`}
                >
                  <span className="min-w-0 truncate">
                    {idx + 1}. {step.title}
                  </span>
                  {isDone && <Check size={12} className="text-emerald-400 flex-shrink-0" />}
                </button>
              );
            })}
          </div>
        )}

        {/* Description */}
        <p className="text-[11px] sm:text-xs leading-snug text-slate-200">
          {currentStep.description}
        </p>

        {/* Lightweight Action Cue */}
        <div
          data-testid="tutorial-try-pill"
          className={`flex items-center justify-between gap-2 text-[11px] font-bold ${
            isCurrentTried ? 'text-emerald-300' : 'text-amber-300'
          }`}
        >
          <span className="min-w-0 leading-snug">{currentStep.tryPrompt}</span>
          {currentStep.key === 'hint' && (
            <button
              type="button"
              data-testid="tutorial-try-hint-btn"
              onClick={onTriggerHint}
              className="px-2.5 py-0.5 rounded-lg bg-amber-400 hover:bg-amber-300 text-slate-950 text-[10px] font-extrabold transition-colors cursor-pointer flex-shrink-0"
            >
              Try Hint
            </button>
          )}
        </div>

        {/* Sleek Progress Bar */}
        <div className="h-1 w-full rounded-full bg-slate-800 overflow-hidden">
          <div
            className="h-full rounded-full bg-amber-400 transition-all duration-200"
            style={{ width: `${progressPercent}%` }}
          />
        </div>

        {/* Topics Jump + Navigation */}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <button
            type="button"
            data-testid="tutorial-topics-btn"
            aria-expanded={showTopics}
            onClick={() => setShowTopics((prev) => !prev)}
            className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border text-xs font-bold transition-colors cursor-pointer ${
              showTopics
                ? 'bg-amber-400/20 text-amber-200 border-amber-400/60'
                : 'bg-slate-800 hover:bg-slate-700 text-slate-200 border-slate-700'
            }`}
          >
            <List size={13} />
            <span>All Topics</span>
          </button>

          <div className="flex flex-wrap items-center gap-1.5 ml-auto">
            {clampedStep > 0 && (
              <button
                type="button"
                data-testid="tutorial-prev-btn"
                onClick={() => {
                  setShowTopics(false);
                  onStepChange(clampedStep - 1);
                }}
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
                onClick={() => {
                  setShowTopics(false);
                  onStepChange(clampedStep + 1);
                }}
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
