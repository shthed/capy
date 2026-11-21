import React, { useEffect, useRef, useState } from 'react';
import {
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
  | 'create_gallery'
  | 'saves_export'
  | 'settings'
  | 'hints';

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
    create_gallery: false,
    saves_export: false,
    settings: false,
    hints: false,
  };
}

interface OnboardingTutorialProps {
  isOpen: boolean;
  isModalOpen?: boolean;
  isSettingsOpen?: boolean;
  activeSettingsTab?: number;
  isLoading?: boolean;
  stepIndex: number;
  triedActions: TutorialTriedActions;
  triedInCurrentVisit?: boolean;
  largeText?: boolean;
  onToggleLargeText?: () => void;
  onStepChange: (nextStep: number) => void;
  onTriggerHint: () => void;
  onOpenSettingsTab?: (tabIndex: number) => void;
  onComplete: () => void;
  onSkip: () => void;
}

export interface TutorialStepDef {
  key: TutorialStepKey;
  title: string;
  description: string;
  tryPrompt: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  modalTab?: number;
  modalTabName?: string;
  modalTabPrompt?: string;
  modalControlPrompt?: string;
  actionLabel?: string;
  actionTestId?: string;
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
    tryPrompt: 'Try it: Pinch or drag to zoom in',
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
    title: 'Peek at the Art',
    description:
      'Tap the Eye icon at the top to peek at the finished artwork anytime.',
    tryPrompt: 'Try it: Tap the Eye icon above',
    icon: Eye,
  },
  {
    key: 'free_color',
    title: 'Paint Any Color',
    description:
      'Want your own shades? Turn on Free Color Mode in Settings to paint any color you like.',
    tryPrompt: 'Try it: Open Settings and turn on Free Color Mode',
    icon: Paintbrush,
    modalTab: 1,
    modalTabName: 'Settings',
    modalTabPrompt: 'Tap the Settings tab at the top',
    modalControlPrompt: 'Turn on Free Color Mode below',
    actionLabel: 'Open Settings',
    actionTestId: 'tutorial-open-free-color-btn',
  },
  {
    key: 'create_gallery',
    title: 'Daily Puzzle, Gallery & Photos',
    description:
      'Tap Photo above for your own pictures, or open Menu > Create for the Daily Puzzle, Gallery, Styles, and Detail Tiles.',
    tryPrompt: 'Try it: Tap Photo above or open Menu > Create',
    icon: Compass,
    modalTab: 3,
    modalTabName: 'Create',
    modalTabPrompt: 'Tap the Create tab at the top',
    modalControlPrompt: 'Tap Play Daily Puzzle or browse the Preset Gallery',
    actionLabel: 'Open Create',
    actionTestId: 'tutorial-open-create-btn',
  },
  {
    key: 'saves_export',
    title: 'Your Saved Art',
    description:
      'Tap the top-left title pill anytime to switch pictures, save backups, or print coloring pages.',
    tryPrompt: 'Try it: Tap the title pill top-left',
    icon: Save,
    modalTab: 4,
    modalTabName: 'Saves',
    modalTabPrompt: 'Tap the Saves tab at the top',
    modalControlPrompt: 'Pick a saved picture to switch, back up, or print',
    actionLabel: 'Open Saves',
    actionTestId: 'tutorial-open-saves-btn',
  },
  {
    key: 'settings',
    title: 'Customize Settings',
    description:
      'Adjust Accessibility (Text & UI Size, Fat-Finger Tap Assist), UI, Gameplay, Controls, and Audio in the Settings tab.',
    tryPrompt: 'Try it: Open Settings and explore your options',
    icon: Sliders,
    modalTab: 1,
    modalTabName: 'Settings',
    modalTabPrompt: 'Tap the Settings tab at the top',
    modalControlPrompt: 'Try Accessibility, UI, or Gameplay options above',
    actionLabel: 'Open Settings',
    actionTestId: 'tutorial-open-settings-btn',
  },
  {
    key: 'hints',
    title: 'Customize Hints',
    description:
      'Pick your Hint Style, Color, Auto-Pan, Coloring Mode, and Difficulty in the Hints tab.',
    tryPrompt: 'Try it: Open Hints to customize your hint style',
    icon: Sparkles,
    modalTab: 2,
    modalTabName: 'Hints',
    modalTabPrompt: 'Tap the Hints tab at the top',
    modalControlPrompt: 'Customize Hint Appearance, Mode, or Difficulty above',
    actionLabel: 'Open Hints',
    actionTestId: 'tutorial-open-hints-btn',
  },
];

export const OnboardingTutorial: React.FC<OnboardingTutorialProps> = ({
  isOpen,
  isModalOpen = false,
  isSettingsOpen = false,
  activeSettingsTab,
  isLoading = false,
  stepIndex,
  triedActions,
  triedInCurrentVisit = false,
  largeText = false,
  onToggleLargeText,
  onStepChange,
  onTriggerHint,
  onOpenSettingsTab,
  onComplete,
  onSkip,
}) => {
  const autoAdvanceTimerRef = useRef<number | null>(null);
  const [showTopics, setShowTopics] = useState<boolean>(false);

  const clampedStep = Math.max(0, Math.min(TUTORIAL_STEPS.length - 1, stepIndex));
  const currentStep = TUTORIAL_STEPS[clampedStep];
  const isCurrentTried = Boolean(triedActions[currentStep.key]);
  const isLastStep = clampedStep === TUTORIAL_STEPS.length - 1;
  const isModalStep = currentStep.modalTab !== undefined;
  const isDockedInModal = Boolean(isSettingsOpen);
  const isOnTargetModalTab =
    isDockedInModal &&
    isModalStep &&
    activeSettingsTab !== undefined &&
    activeSettingsTab === currentStep.modalTab;

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
  const activePromptText = isDockedInModal
    ? isModalStep
      ? isOnTargetModalTab
        ? currentStep.modalControlPrompt || currentStep.tryPrompt
        : currentStep.modalTabPrompt || currentStep.tryPrompt
      : 'Close Menu (×) to try this on the picture, or tap Next'
    : currentStep.tryPrompt;
  const showOpenTabButton = Boolean(
    isModalStep &&
      currentStep.actionLabel &&
      onOpenSettingsTab &&
      !isOnTargetModalTab
  );

  return (
    <div
      className={`fixed inset-x-0 pointer-events-none flex justify-center ${
        isDockedInModal ? 'z-[60] px-2.5 sm:px-3' : 'z-40 px-3'
      }`}
      style={
        isDockedInModal
          ? {
              bottom: 'calc(0.5rem + var(--sab, 0px))',
            }
          : {
              top: 'calc(var(--capy-tutorial-top, 4.75rem) + var(--sat, 0px))',
            }
      }
    >
      <div
        data-testid="onboarding-tutorial"
        data-modal-docked={isDockedInModal ? 'true' : undefined}
        className={`pointer-events-auto w-full overflow-y-auto rounded-2xl bg-slate-900/95 border border-amber-400/50 shadow-2xl backdrop-blur-xl text-slate-100 animate-in fade-in duration-200 ${
          isDockedInModal
            ? 'max-w-lg max-h-[42dvh] px-3 py-2 sm:px-3.5 space-y-1.5 slide-in-from-bottom-2'
            : `flex flex-col max-w-md max-h-[calc(100dvh-6.5rem)] px-3 py-2.5 sm:px-3.5 slide-in-from-top-2 ${
                showTopics ? 'gap-2' : 'h-[11.75rem] sm:h-[11.25rem]'
              }`
        }`}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-2 flex-shrink-0">
          <div className="flex items-start gap-2 min-w-0">
            <span className="inline-flex items-center justify-center w-6 h-6 rounded-lg bg-amber-400/20 border border-amber-400/40 text-amber-300 flex-shrink-0 mt-0.5">
              <Icon size={14} />
            </span>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 whitespace-nowrap">
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
              <h3 className="text-xs sm:text-sm font-extrabold text-white leading-snug truncate">
                {currentStep.title}
              </h3>
            </div>
          </div>

          <div className="flex items-center gap-1 flex-shrink-0">
            {onToggleLargeText && !isDockedInModal && (
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
              className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-bold text-slate-300 hover:text-white hover:bg-slate-800/80 transition-colors cursor-pointer flex-shrink-0 whitespace-nowrap"
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
            className="rounded-xl bg-slate-950/90 border border-slate-700/80 p-2 max-h-52 overflow-y-auto grid grid-cols-1 sm:grid-cols-2 gap-1.5 flex-shrink-0"
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

        {/* Content Band (Description + Action Cue) */}
        <div
          className={
            isDockedInModal
              ? 'space-y-1'
              : 'flex-1 flex flex-col justify-center gap-1.5 min-h-[4.25rem] py-1'
          }
        >
          <p className="text-[11px] sm:text-xs leading-snug text-slate-200">
            {currentStep.description}
          </p>

          {/* Lightweight Action Cue */}
          <div
            data-testid="tutorial-try-pill"
            className={`flex items-center justify-between gap-2 min-h-[1.5rem] text-[11px] font-bold ${
              isCurrentTried ? 'text-emerald-300' : 'text-amber-300'
            }`}
          >
            <span className="min-w-0 leading-snug">{activePromptText}</span>
            {currentStep.key === 'hint' && !isDockedInModal && (
              <button
                type="button"
                data-testid="tutorial-try-hint-btn"
                onClick={onTriggerHint}
                className="px-2.5 py-0.5 rounded-lg bg-amber-400 hover:bg-amber-300 text-slate-950 text-[10px] font-extrabold transition-colors cursor-pointer flex-shrink-0 whitespace-nowrap"
              >
                Try Hint
              </button>
            )}
            {showOpenTabButton && (
              <button
                type="button"
                data-testid={currentStep.actionTestId}
                onClick={() => onOpenSettingsTab!(currentStep.modalTab!)}
                className="px-2.5 py-0.5 rounded-lg bg-amber-400 hover:bg-amber-300 text-slate-950 text-[10px] font-extrabold transition-colors cursor-pointer flex-shrink-0 whitespace-nowrap"
              >
                {currentStep.actionLabel}
              </button>
            )}
          </div>
        </div>

        {/* Footer Band (Progress Bar + Topics Jump + Navigation) */}
        <div className={isDockedInModal ? 'space-y-1.5' : 'mt-auto flex-shrink-0 space-y-2'}>
          <div className="h-1 w-full rounded-full bg-slate-800 overflow-hidden">
            <div
              className="h-full rounded-full bg-amber-400 transition-all duration-200"
              style={{ width: `${progressPercent}%` }}
            />
          </div>

          <div className="flex flex-nowrap items-center justify-between gap-2">
            <button
              type="button"
              data-testid="tutorial-topics-btn"
              aria-expanded={showTopics}
              onClick={() => setShowTopics((prev) => !prev)}
              className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border text-xs font-bold transition-colors cursor-pointer flex-shrink-0 whitespace-nowrap ${
                showTopics
                  ? 'bg-amber-400/20 text-amber-200 border-amber-400/60'
                  : 'bg-slate-800 hover:bg-slate-700 text-slate-200 border-slate-700'
              }`}
            >
              <List size={13} />
              <span>All Topics</span>
            </button>

            <div className="flex flex-nowrap items-center gap-1.5 ml-auto flex-shrink-0">
              {clampedStep > 0 && (
                <button
                  type="button"
                  data-testid="tutorial-prev-btn"
                  onClick={() => {
                    setShowTopics(false);
                    onStepChange(clampedStep - 1);
                  }}
                  className="inline-flex items-center gap-0.5 px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold border border-slate-700 transition-colors cursor-pointer flex-shrink-0 whitespace-nowrap"
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
                  className="inline-flex items-center gap-1 px-3 py-1 rounded-lg bg-amber-400 hover:bg-amber-300 text-slate-950 text-xs font-extrabold shadow transition-colors cursor-pointer flex-shrink-0 whitespace-nowrap"
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
                  className="inline-flex items-center gap-0.5 px-3 py-1 rounded-lg bg-amber-400 hover:bg-amber-300 text-slate-950 text-xs font-extrabold shadow transition-colors cursor-pointer flex-shrink-0 whitespace-nowrap"
                >
                  <span>Next</span>
                  <ChevronRight size={13} />
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
