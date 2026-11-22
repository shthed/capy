import { Dispatch, MutableRefObject, SetStateAction, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PuzzleData, UserSettings } from '../types';
import { resolveScopedBackupKey } from '../services/StorageNamespace';
import { SafeLocalStore } from '../services/storage/SafeLocalStore';
import { TUTORIAL_COMPLETED_KEY } from '../services/storage/StorageKeys';
import { reportSwallowed } from '../services/telemetry';
import { NativeBridge } from '../services/NativeBridge';
import {
  FEATURE_OFFERS,
  FeatureOfferDef,
  FeatureOfferId,
  FeatureOffersService,
} from '../services/FeatureOffersService';
import {
  createInitialTutorialTried,
  TUTORIAL_STEPS,
  TutorialStepKey,
  TutorialTriedActions,
} from '../components/OnboardingTutorial';
import { useLatest } from './useLatest';

export interface TutorialSpotlightState {
  isActive: boolean;
  variant: 'tutorial' | 'offer';
  targetKey: TutorialStepKey | FeatureOfferId | null;
  cardSelector: string;
  isModalSpotlight: boolean;
  zIndexClass: string;
}

export interface TutorialSpotlightInput {
  isLoading: boolean;
  showTutorial: boolean;
  tutorialStep: number;
  showSettings: boolean;
  showPaletteOptions: boolean;
  isPreviewMode: boolean;
  activeFeatureOffer: FeatureOfferDef | null;
  isFeatureOfferSuppressed: boolean;
}

export interface UseTutorialAndOffersParams {
  isLoading: boolean;
  puzzle: PuzzleData | null;
  isPreviewMode: boolean;
  isPreviewModeRef: MutableRefObject<boolean>;
  showSettings: boolean;
  showSettingsRef: MutableRefObject<boolean>;
  showPaletteOptions: boolean;
  activeSettingsTab: number;
  activeSettingsTabRef: MutableRefObject<number>;
  settingsRef: MutableRefObject<UserSettings>;
  exitTutorialReplayRef: MutableRefObject<() => void>;
  setIsPreviewMode: Dispatch<SetStateAction<boolean>>;
  setShowSettings: Dispatch<SetStateAction<boolean>>;
  setSettingsInitialTab: Dispatch<SetStateAction<number | undefined>>;
  setSettingsTabRequestKey: Dispatch<SetStateAction<number>>;
  setActiveSettingsTab: Dispatch<SetStateAction<number>>;
  handleUpdateSettings: (updater: UserSettings | ((prev: UserSettings) => UserSettings)) => void;
}

/**
 * Pure helper to clamp a tutorial step index within valid TUTORIAL_STEPS bounds.
 */
export function clampTutorialStepIndex(stepIdx: number): number {
  const maxIdx = Math.max(0, TUTORIAL_STEPS.length - 1);
  if (typeof stepIdx !== 'number' || !Number.isFinite(stepIdx)) {
    return 0;
  }
  return Math.max(0, Math.min(maxIdx, Math.floor(stepIdx)));
}

/**
 * Pure helper to dequeue the next unseen feature offer from a FIFO queue.
 */
export function dequeueNextUnseenOffer(
  queue: FeatureOfferId[],
  hasSeen: (id: FeatureOfferId) => boolean = (id) => FeatureOffersService.hasSeenOffer(id)
): FeatureOfferDef | null {
  while (queue.length > 0) {
    const nextId = queue.shift()!;
    if (hasSeen(nextId)) continue;
    const offer = FEATURE_OFFERS[nextId];
    if (offer) {
      return offer;
    }
  }
  return null;
}

/**
 * Pure helper classifying which tutorial action & optional feature offer a settings update triggers.
 */
export function classifySettingsChangeForTutorial(
  prev: UserSettings,
  nextSettings: UserSettings
): { action: keyof TutorialTriedActions; offer?: FeatureOfferId } {
  const enablingFreeColor = Boolean(nextSettings.isFreeColorMode && !prev.isFreeColorMode);
  const toggledFreeColor =
    nextSettings.isFreeColorMode !== prev.isFreeColorMode ||
    nextSettings.enableCustomColorForAllPuzzles !== prev.enableCustomColorForAllPuzzles;
  const changedHintSetting =
    nextSettings.highlightStyle !== prev.highlightStyle ||
    nextSettings.hintColorArgb !== prev.hintColorArgb ||
    nextSettings.hintFillStyle !== prev.hintFillStyle ||
    nextSettings.hintIntensity !== prev.hintIntensity ||
    nextSettings.highlightMatching !== prev.highlightMatching ||
    nextSettings.animateHint !== prev.animateHint ||
    nextSettings.showNextRegionHint !== prev.showNextRegionHint;

  if (toggledFreeColor) {
    return enablingFreeColor
      ? { action: 'free_color', offer: 'free_color' }
      : { action: 'free_color' };
  }
  if (changedHintSetting) {
    return { action: 'hints' };
  }
  return { action: 'settings' };
}

/**
 * Pure helper computing TargetSpotlightOverlay props from current tutorial/offer/modal state.
 */
export function deriveTutorialSpotlightState(
  input: TutorialSpotlightInput
): TutorialSpotlightState {
  const activeTutorialStep = TUTORIAL_STEPS[clampTutorialStepIndex(input.tutorialStep)];
  const isModalTutorialStep =
    input.showTutorial &&
    input.showSettings &&
    !input.showPaletteOptions &&
    activeTutorialStep?.modalTab !== undefined;

  const isActive =
    !input.isLoading &&
    !input.showPaletteOptions &&
    (!input.showSettings || isModalTutorialStep) &&
    (!input.isPreviewMode ||
      (input.showTutorial && activeTutorialStep?.key === 'peek_fullscreen')) &&
    (input.showTutorial ||
      Boolean(input.activeFeatureOffer && !input.isFeatureOfferSuppressed));

  return {
    isActive,
    variant: input.showTutorial ? 'tutorial' : 'offer',
    targetKey: input.showTutorial
      ? activeTutorialStep?.key ?? null
      : input.activeFeatureOffer?.id ?? null,
    cardSelector: input.showTutorial
      ? '[data-testid="onboarding-tutorial"]'
      : '[data-testid="feature-offer-banner"]',
    isModalSpotlight: isModalTutorialStep,
    zIndexClass: isModalTutorialStep ? 'z-[58]' : 'z-[38]',
  };
}

/**
 * Pure helper producing the next UserSettings when toggling Large Text from OnboardingTutorial.
 */
export function toggleTutorialLargeTextSettings(prev: UserSettings): UserSettings {
  const nextLargeText = !prev.largeText;
  return nextLargeText
    ? {
        ...prev,
        largeText: true,
        textScale: Math.max(prev.textScale || 1.0, 1.25),
        uiScale: Math.max(prev.uiScale || 1.0, 1.25),
        fatFingerAssist: true,
      }
    : {
        ...prev,
        largeText: false,
        textScale: 1.0,
        uiScale: 1.0,
      };
}

export function useTutorialAndOffers(params: UseTutorialAndOffersParams) {
  const {
    isLoading,
    puzzle,
    isPreviewMode,
    isPreviewModeRef,
    showSettings,
    showSettingsRef,
    showPaletteOptions,
    activeSettingsTabRef,
    settingsRef,
    exitTutorialReplayRef,
    setIsPreviewMode,
    setShowSettings,
    setSettingsInitialTab,
    setSettingsTabRequestKey,
    setActiveSettingsTab,
    handleUpdateSettings,
  } = params;

  const [showTutorial, setShowTutorial] = useState<boolean>(false);
  const showTutorialRef = useLatest(showTutorial);
  const [tutorialStep, setTutorialStep] = useState<number>(0);
  const tutorialStepRef = useLatest(tutorialStep);
  const [tutorialStepTriedInVisit, setTutorialStepTriedInVisit] = useState<boolean>(false);
  const [tutorialTried, setTutorialTried] = useState<TutorialTriedActions>(
    createInitialTutorialTried
  );
  const [activeFeatureOffer, setActiveFeatureOffer] = useState<FeatureOfferDef | null>(null);
  const activeFeatureOfferRef = useLatest(activeFeatureOffer);
  const featureOfferQueueRef = useRef<FeatureOfferId[]>([]);
  const tutorialOpenedSettingsRef = useRef<boolean>(false);
  const hasCheckedSettingsTipRef = useRef<boolean>(false);
  const tutorialTriggeredPreviewRef = useRef<boolean>(false);

  const isFeatureOfferSuppressed =
    isLoading || showTutorial || showSettings || showPaletteOptions;
  const isFeatureOfferSuppressedRef = useLatest(isFeatureOfferSuppressed);

  const advanceFeatureOffer = useCallback(() => {
    const nextOffer = dequeueNextUnseenOffer(featureOfferQueueRef.current);
    activeFeatureOfferRef.current = nextOffer;
    setActiveFeatureOffer(nextOffer);
  }, [activeFeatureOfferRef]);

  useEffect(() => {
    if (isFeatureOfferSuppressed || showTutorial) return;
    if (activeFeatureOffer) {
      FeatureOffersService.markOfferSeen(activeFeatureOffer.id);
      return;
    }
    if (featureOfferQueueRef.current.length > 0) {
      advanceFeatureOffer();
    }
  }, [isFeatureOfferSuppressed, showTutorial, activeFeatureOffer, advanceFeatureOffer]);

  const triggerFeatureOffer = useCallback(
    (id: FeatureOfferId) => {
      if (showTutorialRef.current) return;
      if (FeatureOffersService.hasSeenOffer(id)) return;
      const curOffer = activeFeatureOfferRef.current;
      if (curOffer?.id === id || featureOfferQueueRef.current.includes(id)) {
        return;
      }
      featureOfferQueueRef.current.push(id);
      if (!isFeatureOfferSuppressedRef.current && !curOffer) {
        advanceFeatureOffer();
      }
    },
    [advanceFeatureOffer, activeFeatureOfferRef, isFeatureOfferSuppressedRef, showTutorialRef]
  );

  const markTutorialActionTried = useCallback(
    (action: keyof TutorialTriedActions) => {
      setTutorialTried((prev) => (prev[action] ? prev : { ...prev, [action]: true }));
      if (showTutorialRef.current && TUTORIAL_STEPS[tutorialStepRef.current]?.key === action) {
        setTutorialStepTriedInVisit(true);
      }
    },
    [showTutorialRef, tutorialStepRef]
  );

  const cleanupTutorialTransientModes = useCallback(
    (nextStepKey: TutorialStepKey | null = null) => {
      if (nextStepKey !== 'replay') {
        exitTutorialReplayRef.current();
      }
      if (tutorialTriggeredPreviewRef.current && nextStepKey !== 'peek_fullscreen') {
        tutorialTriggeredPreviewRef.current = false;
        isPreviewModeRef.current = false;
        setIsPreviewMode(false);
      }
      const nextStepDef = nextStepKey
        ? TUTORIAL_STEPS.find((step) => step.key === nextStepKey)
        : undefined;
      if (tutorialOpenedSettingsRef.current && nextStepDef?.modalTab === undefined) {
        tutorialOpenedSettingsRef.current = false;
        setShowSettings(false);
      }
    },
    [exitTutorialReplayRef, isPreviewModeRef, setIsPreviewMode, setShowSettings]
  );

  const completeTutorial = useCallback(() => {
    cleanupTutorialTransientModes(null);
    setShowTutorial(false);
    setTutorialStepTriedInVisit(false);
    hasCheckedSettingsTipRef.current = true;
    FeatureOffersService.markOfferSeen('settings_hints_tip');
    SafeLocalStore.setScopedItem(TUTORIAL_COMPLETED_KEY, '1');
    NativeBridge.saveBackup(resolveScopedBackupKey(TUTORIAL_COMPLETED_KEY), '1');
  }, [cleanupTutorialTransientModes]);

  useEffect(() => {
    if (!showTutorial) return;
    return NativeBridge.pushBackHandler(completeTutorial);
  }, [showTutorial, completeTutorial]);

  useEffect(() => {
    if (isLoading || !puzzle || showTutorial || hasCheckedSettingsTipRef.current) return;
    hasCheckedSettingsTipRef.current = true;
    const skipTutorial =
      typeof window !== 'undefined' &&
      new URLSearchParams(window.location.search).has('skipTutorial');
    if (skipTutorial) return;
    let tutorialCompleted = false;
    try {
      tutorialCompleted =
        SafeLocalStore.getScopedItem(TUTORIAL_COMPLETED_KEY) === '1' ||
        NativeBridge.loadBackup(resolveScopedBackupKey(TUTORIAL_COMPLETED_KEY)) === '1';
    } catch (err) {
      reportSwallowed('App.tutorialCompletedCheck', err);
    }
    if (tutorialCompleted) {
      triggerFeatureOffer('settings_hints_tip');
    }
  }, [isLoading, puzzle, showTutorial, triggerFeatureOffer]);

  const handleStartTutorial = useCallback(() => {
    featureOfferQueueRef.current = [];
    activeFeatureOfferRef.current = null;
    setActiveFeatureOffer(null);
    tutorialOpenedSettingsRef.current = false;
    cleanupTutorialTransientModes(TUTORIAL_STEPS[0]?.key ?? null);
    setTutorialStepTriedInVisit(false);
    setTutorialStep(0);
    setTutorialTried(createInitialTutorialTried());
    setShowTutorial(true);
  }, [activeFeatureOfferRef, cleanupTutorialTransientModes]);

  const handleStartSettingsTour = useCallback(() => {
    featureOfferQueueRef.current = [];
    activeFeatureOfferRef.current = null;
    setActiveFeatureOffer(null);
    const targetKey: TutorialStepKey = activeSettingsTabRef.current === 2 ? 'hints' : 'settings';
    const targetIdx = Math.max(
      0,
      TUTORIAL_STEPS.findIndex((step) => step.key === targetKey)
    );
    const targetTab = TUTORIAL_STEPS[targetIdx]?.modalTab ?? 1;
    tutorialOpenedSettingsRef.current = false;
    cleanupTutorialTransientModes(targetKey);
    setSettingsInitialTab(targetTab);
    setSettingsTabRequestKey((k) => k + 1);
    setShowSettings(true);
    setTutorialStepTriedInVisit(false);
    setTutorialStep(targetIdx);
    setShowTutorial(true);
  }, [
    activeFeatureOfferRef,
    activeSettingsTabRef,
    cleanupTutorialTransientModes,
    setSettingsInitialTab,
    setSettingsTabRequestKey,
    setShowSettings,
  ]);

  const handleOpenTutorialSettingsTab = useCallback(
    (tabIndex: number) => {
      if (!showSettingsRef.current) {
        tutorialOpenedSettingsRef.current = true;
      }
      setSettingsInitialTab(tabIndex);
      setSettingsTabRequestKey((k) => k + 1);
      setShowSettings(true);
    },
    [setSettingsInitialTab, setSettingsTabRequestKey, setShowSettings, showSettingsRef]
  );

  const handleJumpToTutorialStep = useCallback(
    (stepIdx: number) => {
      const clampedIdx = clampTutorialStepIndex(stepIdx);
      const targetStep = TUTORIAL_STEPS[clampedIdx];
      advanceFeatureOffer();
      cleanupTutorialTransientModes(targetStep?.key ?? null);
      setTutorialStepTriedInVisit(false);
      setTutorialStep(clampedIdx);
      setShowTutorial(true);
      if (targetStep?.modalTab !== undefined) {
        if (!showSettingsRef.current) {
          tutorialOpenedSettingsRef.current = true;
        }
        setSettingsInitialTab(targetStep.modalTab);
        setSettingsTabRequestKey((k) => k + 1);
        setShowSettings(true);
      }
    },
    [
      advanceFeatureOffer,
      cleanupTutorialTransientModes,
      setSettingsInitialTab,
      setSettingsTabRequestKey,
      setShowSettings,
      showSettingsRef,
    ]
  );

  const handleTutorialStepChange = useCallback(
    (nextStep: number) => {
      const clampedIdx = clampTutorialStepIndex(nextStep);
      const nextStepDef = TUTORIAL_STEPS[clampedIdx];
      cleanupTutorialTransientModes(nextStepDef?.key ?? null);
      setTutorialStepTriedInVisit(false);
      setTutorialStep(clampedIdx);
      if (showSettingsRef.current && nextStepDef?.modalTab !== undefined) {
        setSettingsInitialTab(nextStepDef.modalTab);
        setSettingsTabRequestKey((k) => k + 1);
      }
    },
    [cleanupTutorialTransientModes, setSettingsInitialTab, setSettingsTabRequestKey, showSettingsRef]
  );

  const handleSettingsTabOpened = useCallback(
    (tabId: number) => {
      activeSettingsTabRef.current = tabId;
      setActiveSettingsTab(tabId);
      if (tabId === 1) {
        markTutorialActionTried('settings');
      } else if (tabId === 2) {
        markTutorialActionTried('hints');
      } else if (tabId === 3) {
        markTutorialActionTried('create_gallery');
        triggerFeatureOffer('create_gallery');
      } else if (tabId === 4) {
        markTutorialActionTried('saves_export');
        triggerFeatureOffer('saves_export');
      }
    },
    [activeSettingsTabRef, markTutorialActionTried, setActiveSettingsTab, triggerFeatureOffer]
  );

  const handleExplorePresetGallery = useCallback(() => {
    markTutorialActionTried('create_gallery');
  }, [markTutorialActionTried]);

  const handleSettingsUpdatedWithTracking = useCallback(
    (nextSettings: UserSettings) => {
      const prev = settingsRef.current;
      const classification = classifySettingsChangeForTutorial(prev, nextSettings);
      handleUpdateSettings(nextSettings);
      markTutorialActionTried(classification.action);
      if (classification.offer) {
        triggerFeatureOffer(classification.offer);
      }
    },
    [handleUpdateSettings, markTutorialActionTried, settingsRef, triggerFeatureOffer]
  );

  const handleTutorialToggleLargeText = useCallback(() => {
    handleUpdateSettings(toggleTutorialLargeTextSettings);
    if (TUTORIAL_STEPS[tutorialStepRef.current]?.key === 'settings') {
      markTutorialActionTried('settings');
    }
  }, [handleUpdateSettings, markTutorialActionTried, tutorialStepRef]);

  const spotlightState = useMemo(
    () =>
      deriveTutorialSpotlightState({
        isLoading,
        showTutorial,
        tutorialStep,
        showSettings,
        showPaletteOptions,
        isPreviewMode,
        activeFeatureOffer,
        isFeatureOfferSuppressed,
      }),
    [
      isLoading,
      showTutorial,
      tutorialStep,
      showSettings,
      showPaletteOptions,
      isPreviewMode,
      activeFeatureOffer,
      isFeatureOfferSuppressed,
    ]
  );

  return {
    showTutorial,
    setShowTutorial,
    showTutorialRef,
    tutorialStep,
    tutorialStepRef,
    tutorialStepTriedInVisit,
    tutorialTried,
    activeFeatureOffer,
    isFeatureOfferSuppressed,
    tutorialTriggeredPreviewRef,
    spotlightState,
    advanceFeatureOffer,
    triggerFeatureOffer,
    markTutorialActionTried,
    completeTutorial,
    handleStartTutorial,
    handleStartSettingsTour,
    handleOpenTutorialSettingsTab,
    handleJumpToTutorialStep,
    handleTutorialStepChange,
    handleSettingsTabOpened,
    handleExplorePresetGallery,
    handleSettingsUpdatedWithTracking,
    handleTutorialToggleLargeText,
  };
}
