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
  Users,
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
  | 'infinite_zoom'
  | 'saves_export'
  | 'cloud_coop'
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
    infinite_zoom: false,
    saves_export: false,
    cloud_coop: false,
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
    description:
      'Choose a numbered swatch from the bottom Palette Dock (or press 1–9). Colors stay sorted with your active pick centered; Easy Mode also auto-matches taps.',
    tryPrompt: 'Tap any color swatch below (or press 1–9)',
    icon: Palette,
  },
  {
    key: 'paint',
    title: 'Tap or Paint Shapes',
    description:
      'Tap matching regions to color them, or toggle the right-side Paintbrush button to drag-paint continuously across multiple shapes.',
    tryPrompt: 'Tap any matching shape on the puzzle to color it!',
    icon: Hand,
  },
  {
    key: 'zoom',
    title: 'Zoom & Pan',
    description:
      'Pinch with two fingers, double-tap & drag vertically (horizontal drags pan), scroll, or use Arrow / WASD, + / -, and 0 keys.',
    tryPrompt: 'Zoom or pan the puzzle (pinch, scroll, or + key)',
    icon: ZoomIn,
  },
  {
    key: 'hint',
    title: 'Smart Hints & Highlighting',
    description:
      'Tap the active color swatch again (or double-tap any swatch) to center a remaining shape. Customize Hint Styles, patterns, intensity & colors in Settings > Hints.',
    tryPrompt: 'Tap the highlighted swatch again (or tap Try Hint)',
    icon: Sparkles,
  },
  {
    key: 'undo_redo',
    title: 'Undo & Redo Mistakes',
    description:
      'Tap Undo (Ctrl+Z / Cmd+Z) to step back a stroke, or Redo (Ctrl+Y) to restore it. Toggle Undo visibility anytime in Settings.',
    tryPrompt: 'Tap Undo (Ctrl+Z) or Redo to try it (paint a shape first if Undo is disabled)',
    icon: Undo2,
  },
  {
    key: 'replay',
    title: 'Animated Replay & Timeline',
    description:
      'Long-press Undo or tap Play on completed art to open the timeline scrubber: adjust speed (0.5x–20x), Follow Painting, Auto-Loop, or Resume Here.',
    tryPrompt: 'Long-press Undo or tap Play to scrub your timeline (paint a shape first if Undo is disabled)',
    icon: Film,
  },
  {
    key: 'peek_fullscreen',
    title: 'Peek Original & Full Screen',
    description:
      'Tap the top Eye button to compare with the original artwork (toggle preview outlines in Settings), or go Full Screen for extra room.',
    tryPrompt: 'Tap the highlighted Eye icon to preview original art, or Full Screen to expand',
    icon: Eye,
  },
  {
    key: 'free_color',
    title: 'Free Colour & Custom Palettes',
    description:
      'Enable Free Colour Mode in Settings to paint any region any shade and unlock + Custom (live HSL/Hex picker and 5 curated Palette Themes).',
    tryPrompt: 'Turn on Free Colour Mode in Settings or tap + Custom in the palette dock',
    icon: Paintbrush,
  },
  {
    key: 'gallery_daily',
    title: 'Artwork Gallery & Daily Puzzle',
    description:
      'Open Menu > Create to play today’s rotating UTC Puzzle of the Day, search artworks, filter categories, or vote on Community Puzzle Ideas.',
    tryPrompt: 'Open Menu > Create to explore the Daily Puzzle and starter gallery',
    icon: Compass,
  },
  {
    key: 'custom_photo',
    title: 'Create Puzzles from Photos',
    description:
      'Tap the top Photo icon (or Choose Photo in Create) to convert any image using Auto, Line Art, Painterly, Posterized, or Mosaic styles and detail sliders.',
    tryPrompt: 'Tap the top Photo icon (or Choose Photo in Create) and select an image',
    icon: Camera,
  },
  {
    key: 'infinite_zoom',
    title: 'Infinite Zoom 2x Detail Tiles',
    description:
      'Need finer detail? Open Menu > Create and tap Infinite Zoom 2x Detail Tile to carve a zoomed sub-puzzle, with a top Parent Puzzle pill to return.',
    tryPrompt: 'Open Menu > Create and tap Infinite Zoom 2x Detail Tile',
    icon: ZoomOut,
  },
  {
    key: 'saves_export',
    title: 'Saves, .capy Backups & SVG',
    description:
      'Tap the top progress pill for Saves: switch Thumbnails or Detail list, Pin, Rename, set Replay on Load, import/export .capy files, or print .svg sheets.',
    tryPrompt: 'Tap the top progress pill for Saves, or export a .capy / .svg file',
    icon: Save,
  },
  {
    key: 'cloud_coop',
    title: 'Cloud Sync, Share & Live Co-op',
    description:
      'Inside Saves, sign in with Google or Play Games for CRDT Cloud Sync, copy <2 KB Share Progress links, or Host / Join a 6-char Live Co-op room.',
    tryPrompt: 'Tap the top Co-op icon or share/sync progress inside Saves',
    icon: Users,
  },
  {
    key: 'settings_a11y',
    title: 'Settings & Accessibility',
    description:
      'Tune Easy vs Normal, Auto-Advance, Canvas Background, Large Text, Reduced Motion, Sound & Haptics, Zoom Sensitivity, Zoom Stops, or Reset Progress.',
    tryPrompt: 'Open Menu > Settings (or adjust any option / Large Text) to finish',
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

  return (
    <div
      className="fixed inset-x-0 z-40 pointer-events-none flex justify-center px-3"
      style={{
        top: 'calc(var(--capy-tutorial-top, 3.55rem) + var(--sat, 0px))',
      }}
    >
      <div
        data-testid="onboarding-tutorial"
        className="pointer-events-auto w-full max-w-md max-h-[calc(100dvh-5.75rem)] overflow-y-auto rounded-2xl bg-slate-900/95 border border-amber-400/50 shadow-2xl backdrop-blur-xl p-3 sm:p-3.5 text-slate-100 space-y-2.5 animate-in fade-in slide-in-from-top-2 duration-200"
      >
        {onToggleLargeText && clampedStep === 0 && (
          <button
            type="button"
            data-testid="tutorial-large-text-btn"
            aria-pressed={largeText}
            onClick={onToggleLargeText}
            className={`w-full flex items-center justify-between gap-2 px-3 py-1.5 rounded-xl border text-left text-xs font-extrabold transition-colors cursor-pointer ${
              largeText
                ? 'bg-amber-400 text-slate-950 border-amber-300 hover:bg-amber-300'
                : 'bg-slate-950/90 text-amber-200 border-amber-400/60 hover:bg-slate-800'
            }`}
          >
            <span className="leading-snug">
              {largeText
                ? 'Large Text On (Tap to Switch Back)'
                : "Is this too small? Can't read this? Switch to Large Text"}
            </span>
          </button>
        )}

        {/* Header */}
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-start gap-2 min-w-0">
            <span className="inline-flex items-center justify-center w-7 h-7 rounded-xl bg-amber-400/20 border border-amber-400/40 text-amber-300 flex-shrink-0 mt-0.5">
              <Icon size={15} />
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
          <span className="min-w-0 leading-snug">{currentStep.tryPrompt}</span>
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

        {/* Step Dots Strip (Wraps cleanly without horizontal overflow) */}
        <div className="flex flex-wrap items-center gap-1 pt-0.5">
          {TUTORIAL_STEPS.map((step, idx) => (
            <button
              key={step.key}
              type="button"
              aria-label={`Go to tutorial step ${idx + 1}: ${step.title}`}
              onClick={() => {
                setShowTopics(false);
                onStepChange(idx);
              }}
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

        {/* Topics Jump + Navigation */}
        <div className="flex flex-wrap items-center justify-between gap-2 pt-0.5">
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
