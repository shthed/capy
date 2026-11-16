import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { FeatureOfferId } from '../services/FeatureOffersService';
import { TutorialStepKey } from './OnboardingTutorial';

export type SpotlightVariant = 'tutorial' | 'offer';

export interface SpotlightRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface SpotlightTargetSpec {
  selector: string;
  fallbackSelector?: string;
  fallbackSelectors?: string[];
  optional?: boolean;
  padding?: number;
  borderRadius?: number;
}

export interface SpotlightConnector {
  startX: number;
  startY: number;
  ctrlX: number;
  ctrlY: number;
  endX: number;
  endY: number;
  d: string;
  arrowPoints: string;
}

export const TUTORIAL_STEP_TARGETS: Record<TutorialStepKey, SpotlightTargetSpec[]> = {
  palette: [
    {
      selector: '[data-testid="palette-dock-tray"]',
      fallbackSelector: '[data-testid="palette-dock"]',
      padding: 4,
      borderRadius: 14,
    },
  ],
  paint: [
    {
      selector: '[data-testid="paint-mode-btn"]',
      padding: 4,
      borderRadius: 9999,
    },
  ],
  zoom: [
    {
      selector: '[data-testid="zoom-in-btn"]',
      optional: true,
      padding: 4,
      borderRadius: 9999,
    },
    {
      selector: '[data-testid="zoom-out-btn"]',
      optional: true,
      padding: 4,
      borderRadius: 9999,
    },
  ],
  hint: [
    {
      selector: '[data-testid="palette-dock"] button[data-testid^="palette-swatch-"][aria-pressed="true"]',
      fallbackSelectors: [
        '[data-testid="palette-dock-tray"]',
        '[data-testid="palette-dock"]',
      ],
      padding: 4,
      borderRadius: 14,
    },
  ],
  undo_redo: [
    {
      selector: '[data-testid="undo-btn"]',
      fallbackSelector: '[data-testid="topbar-settings-btn"]',
      padding: 3,
      borderRadius: 9999,
    },
    {
      selector: '[data-testid="redo-btn"]',
      optional: true,
      padding: 3,
      borderRadius: 9999,
    },
  ],
  replay: [
    {
      selector: '[data-testid="replay-controls-window"]',
      fallbackSelectors: [
        '[data-testid="replay-btn"]',
        '[data-testid="undo-btn"]',
        '[data-testid="topbar-settings-btn"]',
      ],
      padding: 4,
      borderRadius: 16,
    },
  ],
  peek_fullscreen: [
    {
      selector: '[data-testid="topbar-preview-btn"]',
      padding: 3,
      borderRadius: 9999,
    },
    {
      selector: '[data-testid="topbar-fullscreen-btn"]',
      optional: true,
      padding: 3,
      borderRadius: 9999,
    },
  ],
  free_color: [
    {
      selector: '[data-testid="palette-custom-btn"]',
      fallbackSelector: '[data-testid="topbar-settings-btn"]',
      padding: 3,
      borderRadius: 14,
    },
  ],
  gallery_daily: [
    {
      selector: '[data-testid="topbar-settings-btn"]',
      padding: 3,
      borderRadius: 9999,
    },
  ],
  custom_photo: [
    {
      selector: '[data-testid="topbar-upload-btn"]',
      padding: 3,
      borderRadius: 9999,
    },
  ],
  infinite_zoom: [
    {
      selector: '[data-testid="topbar-parent-puzzle-btn"]',
      fallbackSelector: '[data-testid="topbar-settings-btn"]',
      padding: 3,
      borderRadius: 9999,
    },
  ],
  saves_export: [
    {
      selector: '[data-testid="topbar-saves-btn"]',
      padding: 3,
      borderRadius: 9999,
    },
  ],
  settings_a11y: [
    {
      selector: '[data-testid="topbar-settings-btn"]',
      padding: 3,
      borderRadius: 9999,
    },
  ],
};

export const FEATURE_OFFER_TARGETS: Record<FeatureOfferId, SpotlightTargetSpec[]> = {
  paint_mode: [
    {
      selector: '[data-testid="paint-mode-btn"]',
      padding: 4,
      borderRadius: 9999,
    },
  ],
  undo_replay: [
    {
      selector: '[data-testid="undo-btn"]',
      fallbackSelector: '[data-testid="redo-btn"]',
      padding: 3,
      borderRadius: 9999,
    },
    {
      selector: '[data-testid="redo-btn"]',
      optional: true,
      padding: 3,
      borderRadius: 9999,
    },
  ],
  replay_scrubber: [
    {
      selector: '[data-testid="replay-controls-window"]',
      fallbackSelector: '[data-testid="undo-btn"]',
      padding: 4,
      borderRadius: 16,
    },
  ],
  free_color: [
    {
      selector: '[data-testid="palette-custom-btn"]',
      fallbackSelectors: [
        '[data-testid="palette-dock-tray"]',
        '[data-testid="palette-dock"]',
      ],
      padding: 4,
      borderRadius: 14,
    },
  ],
  create_gallery: [
    {
      selector: '[data-testid="topbar-settings-btn"]',
      padding: 3,
      borderRadius: 9999,
    },
  ],
  photo_upload: [
    {
      selector: '[data-testid="topbar-upload-btn"]',
      fallbackSelector: '[data-testid="topbar-settings-btn"]',
      padding: 3,
      borderRadius: 9999,
    },
  ],
  infinite_zoom: [
    {
      selector: '[data-testid="topbar-parent-puzzle-btn"]',
      fallbackSelector: '[data-testid="topbar-saves-btn"]',
      padding: 3,
      borderRadius: 9999,
    },
  ],
  saves_export: [
    {
      selector: '[data-testid="topbar-saves-btn"]',
      padding: 3,
      borderRadius: 9999,
    },
  ],
};

export function clampRectToBounds(
  rect: SpotlightRect,
  viewport: { width: number; height: number },
  margin: number = 4
): SpotlightRect {
  const maxW = Math.max(0, viewport.width - margin * 2);
  const maxH = Math.max(0, viewport.height - margin * 2);
  const width = Math.max(0, Math.min(rect.width, maxW));
  const height = Math.max(0, Math.min(rect.height, maxH));
  const left = Math.max(margin, Math.min(rect.left, viewport.width - margin - width));
  const top = Math.max(margin, Math.min(rect.top, viewport.height - margin - height));
  return { left, top, width, height };
}

export function preventRingOverlap(
  rects: SpotlightRect[],
  minGap: number = 2
): SpotlightRect[] {
  const out = rects.map((r) => ({ ...r }));
  for (let i = 0; i < out.length; i++) {
    for (let j = i + 1; j < out.length; j++) {
      const a = out[i];
      const b = out[j];
      const horizOverlap = Math.min(a.left + a.width, b.left + b.width) - Math.max(a.left, b.left);
      const vertOverlap = Math.min(a.top + a.height, b.top + b.height) - Math.max(a.top, b.top);
      if (horizOverlap > -minGap && vertOverlap > -minGap) {
        const acx = a.left + a.width / 2;
        const bcx = b.left + b.width / 2;
        const acy = a.top + a.height / 2;
        const bcy = b.top + b.height / 2;
        if (Math.abs(bcx - acx) >= Math.abs(bcy - acy)) {
          const leftRing = acx <= bcx ? a : b;
          const rightRing = acx <= bcx ? b : a;
          const splitX = (leftRing.left + leftRing.width + rightRing.left) / 2;
          const nextLeftW = Math.max(16, splitX - minGap / 2 - leftRing.left);
          const nextRightLeft = splitX + minGap / 2;
          const nextRightW = Math.max(16, rightRing.left + rightRing.width - nextRightLeft);
          leftRing.width = nextLeftW;
          rightRing.left = nextRightLeft;
          rightRing.width = nextRightW;
        } else {
          const topRing = acy <= bcy ? a : b;
          const bottomRing = acy <= bcy ? b : a;
          const splitY = (topRing.top + topRing.height + bottomRing.top) / 2;
          const nextTopH = Math.max(16, splitY - minGap / 2 - topRing.top);
          const nextBottomTop = splitY + minGap / 2;
          const nextBottomH = Math.max(16, bottomRing.top + bottomRing.height - nextBottomTop);
          topRing.height = nextTopH;
          bottomRing.top = nextBottomTop;
          bottomRing.height = nextBottomH;
        }
      }
    }
  }
  return out;
}

export function computeSpotlightConnector(
  cardRect: SpotlightRect,
  targetRect: SpotlightRect
): SpotlightConnector | null {
  const cardCx = cardRect.left + cardRect.width / 2;
  const targetCx = targetRect.left + targetRect.width / 2;
  const targetCy = targetRect.top + targetRect.height / 2;
  const targetBottom = targetRect.top + targetRect.height;
  const cardBottom = cardRect.top + cardRect.height;

  let startX = cardCx;
  let startY = cardBottom;
  let endX = targetCx;
  let endY = targetRect.top - 4;
  let ctrlX = (startX + endX) / 2;
  let ctrlY = (startY + endY) / 2;

  if (targetBottom <= cardRect.top + 4) {
    // Target sits above the card (e.g., top bar controls)
    startX = Math.max(cardRect.left + 16, Math.min(cardRect.left + cardRect.width - 16, targetCx));
    startY = cardRect.top - 1;
    const rawGap = startY - targetBottom;
    if (rawGap < 6) return null;
    endX = targetCx;
    endY = Math.min(startY - 5, targetBottom + Math.min(4, rawGap * 0.25));
    const dx = endX - startX;
    const dy = endY - startY;
    ctrlX = Math.abs(dx) < 8 ? (startX + endX) / 2 : startX + dx * 0.3;
    ctrlY = startY + dy * 0.6;
  } else if (targetRect.top >= cardBottom - 4) {
    // Target sits below the card (e.g., bottom palette dock or right floating actions)
    startX = Math.max(cardRect.left + 16, Math.min(cardRect.left + cardRect.width - 16, targetCx));
    startY = cardBottom + 1;
    const rawGap = targetRect.top - startY;
    if (rawGap < 6) return null;
    endX = targetCx;
    endY = Math.max(startY + 5, targetRect.top - Math.min(4, rawGap * 0.25));
    const dx = endX - startX;
    const dy = endY - startY;
    ctrlX = Math.abs(dx) < 8 ? (startX + endX) / 2 : startX + dx * 0.3;
    ctrlY = startY + dy * 0.6;
  } else if (targetCx >= cardCx) {
    startX = cardRect.left + cardRect.width + 1;
    const rawGap = targetRect.left - startX;
    if (rawGap < 6) return null;
    startY = Math.max(cardRect.top + 16, Math.min(cardBottom - 16, targetCy));
    endX = Math.max(startX + 5, targetRect.left - Math.min(4, rawGap * 0.25));
    endY = targetCy;
    ctrlX = (startX + endX) / 2;
    ctrlY = (startY + endY) / 2 - 12;
  } else {
    startX = cardRect.left - 1;
    const targetRight = targetRect.left + targetRect.width;
    const rawGap = startX - targetRight;
    if (rawGap < 6) return null;
    startY = Math.max(cardRect.top + 16, Math.min(cardBottom - 16, targetCy));
    endX = Math.min(startX - 5, targetRight + Math.min(4, rawGap * 0.25));
    endY = targetCy;
    ctrlX = (startX + endX) / 2;
    ctrlY = (startY + endY) / 2 - 12;
  }

  const dist = Math.hypot(endX - startX, endY - startY);
  if (dist < 6) return null;

  const tx = endX - ctrlX;
  const ty = endY - ctrlY;
  const len = Math.hypot(tx, ty) || 1;
  const ux = tx / len;
  const uy = ty / len;
  const px = -uy;
  const py = ux;
  const headLen = Math.min(8, Math.max(4, dist * 0.42));
  const headHalfW = Math.min(4.5, headLen * 0.6);
  const baseX = endX - ux * headLen;
  const baseY = endY - uy * headLen;
  const leftX = baseX + px * headHalfW;
  const leftY = baseY + py * headHalfW;
  const rightX = baseX - px * headHalfW;
  const rightY = baseY - py * headHalfW;

  const d = `M ${startX.toFixed(1)} ${startY.toFixed(1)} Q ${ctrlX.toFixed(1)} ${ctrlY.toFixed(1)} ${baseX.toFixed(1)} ${baseY.toFixed(1)}`;
  const arrowPoints = `${endX.toFixed(1)},${endY.toFixed(1)} ${leftX.toFixed(1)},${leftY.toFixed(1)} ${rightX.toFixed(1)},${rightY.toFixed(1)}`;

  return { startX, startY, ctrlX, ctrlY, endX, endY, d, arrowPoints };
}

interface ResolvedTargetRing {
  rect: SpotlightRect;
  borderRadius: number;
  targetTestId: string;
  targetSelector: string;
}

interface ResolvedLayout {
  rings: ResolvedTargetRing[];
  connector: SpotlightConnector | null;
}

function areRectsEqual(a: SpotlightRect, b: SpotlightRect): boolean {
  return (
    Math.abs(a.left - b.left) < 0.25 &&
    Math.abs(a.top - b.top) < 0.25 &&
    Math.abs(a.width - b.width) < 0.25 &&
    Math.abs(a.height - b.height) < 0.25
  );
}

function areLayoutsEqual(a: ResolvedLayout, b: ResolvedLayout): boolean {
  if (a.rings.length !== b.rings.length) return false;
  for (let i = 0; i < a.rings.length; i++) {
    const ra = a.rings[i];
    const rb = b.rings[i];
    if (
      ra.borderRadius !== rb.borderRadius ||
      ra.targetTestId !== rb.targetTestId ||
      ra.targetSelector !== rb.targetSelector ||
      !areRectsEqual(ra.rect, rb.rect)
    ) {
      return false;
    }
  }
  if (a.connector === null && b.connector === null) return true;
  if (a.connector === null || b.connector === null) return false;
  return (
    a.connector.d === b.connector.d &&
    a.connector.arrowPoints === b.connector.arrowPoints
  );
}

function isSpotlightOverlayNode(node: Node | null): boolean {
  return (
    node instanceof Element &&
    (node.matches('[data-testid="spotlight-overlay"]') ||
      Boolean(node.closest('[data-testid="spotlight-overlay"]')))
  );
}

function hasRunningRelevantTransition(): boolean {
  if (typeof document === 'undefined' || typeof document.getAnimations !== 'function') {
    return false;
  }
  const hasCssTransitionCtor = typeof CSSTransition !== 'undefined';
  if (!hasCssTransitionCtor) return false;
  const anims = document.getAnimations();
  for (let i = 0; i < anims.length; i++) {
    const anim = anims[i];
    if (!(anim instanceof CSSTransition) || anim.playState !== 'running') continue;
    const effect = anim.effect;
    const target = effect && 'target' in effect ? (effect as KeyframeEffect).target : null;
    if (isSpotlightOverlayNode(target)) continue;
    return true;
  }
  return false;
}

export interface TargetSpotlightOverlayProps {
  isActive: boolean;
  variant: SpotlightVariant;
  targetKey: TutorialStepKey | FeatureOfferId | null;
  cardSelector: string;
  reducedMotion?: boolean;
  largeText?: boolean;
}

interface ClipBounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

function getScrollClipBounds(
  el: HTMLElement,
  viewport: { width: number; height: number }
): ClipBounds {
  let left = 0;
  let top = 0;
  let right = viewport.width;
  let bottom = viewport.height;
  let cur: HTMLElement | null = el.parentElement;
  while (cur && cur !== document.body && cur !== document.documentElement) {
    const st = window.getComputedStyle(cur);
    const clipsX =
      st.overflowX === 'auto' ||
      st.overflowX === 'scroll' ||
      st.overflowX === 'hidden' ||
      st.overflowX === 'clip';
    const clipsY =
      st.overflowY === 'auto' ||
      st.overflowY === 'scroll' ||
      st.overflowY === 'hidden' ||
      st.overflowY === 'clip';
    if (clipsX || clipsY) {
      const cr = cur.getBoundingClientRect();
      if (clipsX) {
        left = Math.max(left, cr.left);
        right = Math.min(right, cr.right);
      }
      if (clipsY) {
        top = Math.max(top, cr.top);
        bottom = Math.min(bottom, cr.bottom);
      }
    }
    cur = cur.parentElement;
  }
  return { left, top, right, bottom };
}

function isVisibleElement(
  el: Element | null,
  viewport?: { width: number; height: number }
): el is HTMLElement {
  if (!(el instanceof HTMLElement)) return false;
  const style = window.getComputedStyle(el);
  if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
    return false;
  }
  const rect = el.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return false;
  if (!viewport) return true;
  const clip = getScrollClipBounds(el, viewport);
  const visW = Math.min(rect.right, clip.right) - Math.max(rect.left, clip.left);
  const visH = Math.min(rect.bottom, clip.bottom) - Math.max(rect.top, clip.top);
  return visW >= Math.min(8, rect.width) && visH >= Math.min(8, rect.height);
}

function findFirstVisibleElement(
  selector: string,
  viewport: { width: number; height: number }
): HTMLElement | null {
  const nodes = document.querySelectorAll(selector);
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    if (isVisibleElement(node, viewport)) {
      return node;
    }
  }
  return null;
}

export const TargetSpotlightOverlay: React.FC<TargetSpotlightOverlayProps> = ({
  isActive,
  variant,
  targetKey,
  cardSelector,
  reducedMotion = false,
  largeText = false,
}) => {
  const [layout, setLayout] = useState<ResolvedLayout>({ rings: [], connector: null });
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const observedElementsRef = useRef<Set<Element>>(new Set());

  const syncObservedElements = useCallback((nextElements: Element[]) => {
    const ro = resizeObserverRef.current;
    if (!ro) return;
    const nextSet = new Set(nextElements);
    for (const prevEl of observedElementsRef.current) {
      if (!nextSet.has(prevEl)) {
        ro.unobserve(prevEl);
      }
    }
    for (const nextEl of nextSet) {
      if (!observedElementsRef.current.has(nextEl)) {
        ro.observe(nextEl);
      }
    }
    observedElementsRef.current = nextSet;
  }, []);

  const measure = useCallback(() => {
    if (!isActive || !targetKey || typeof window === 'undefined') {
      syncObservedElements([]);
      setLayout((prev) =>
        prev.rings.length === 0 && prev.connector === null ? prev : { rings: [], connector: null }
      );
      return;
    }

    const viewport = { width: window.innerWidth, height: window.innerHeight };
    const cardEl = document.querySelector(cardSelector);
    const headerEl = document.querySelector('header');
    const dockEl = document.querySelector('[data-testid="palette-dock"]');
    const observeTargets: Element[] = [];
    if (cardEl) observeTargets.push(cardEl);
    if (headerEl) observeTargets.push(headerEl);
    if (dockEl) observeTargets.push(dockEl);

    const cardDomRect = isVisibleElement(cardEl) ? cardEl.getBoundingClientRect() : null;
    const cardRect: SpotlightRect | null = cardDomRect
      ? {
          left: cardDomRect.left,
          top: cardDomRect.top,
          width: cardDomRect.width,
          height: cardDomRect.height,
        }
      : null;

    const specs =
      variant === 'tutorial'
        ? TUTORIAL_STEP_TARGETS[targetKey as TutorialStepKey]
        : FEATURE_OFFER_TARGETS[targetKey as FeatureOfferId];

    if (!specs || specs.length === 0) {
      syncObservedElements(observeTargets);
      setLayout((prev) =>
        prev.rings.length === 0 && prev.connector === null ? prev : { rings: [], connector: null }
      );
      return;
    }

    const rawRings: ResolvedTargetRing[] = [];
    for (const spec of specs) {
      const candidates = [
        spec.selector,
        ...(spec.fallbackSelectors || []),
        ...(spec.fallbackSelector ? [spec.fallbackSelector] : []),
      ];
      let el: HTMLElement | null = null;
      let usedSelector = spec.selector;
      for (const candidate of candidates) {
        const match = findFirstVisibleElement(candidate, viewport);
        if (match) {
          el = match;
          usedSelector = candidate;
          break;
        }
      }

      if (!el) {
        continue;
      }

      observeTargets.push(el);
      if (el.parentElement) {
        observeTargets.push(el.parentElement);
      }

      const pad = spec.padding ?? 4;
      const borderRadius = spec.borderRadius ?? 14;
      const targetTestId = el.getAttribute('data-testid') || '';

      const raw = el.getBoundingClientRect();
      const clip = getScrollClipBounds(el, viewport);
      const minX = Math.max(4, clip.left);
      const maxX = Math.min(viewport.width - 4, clip.right);
      const minY = Math.max(4, clip.top);
      const maxY = Math.min(viewport.height - 4, clip.bottom);
      const clippedLeft = Math.max(raw.left - pad, minX);
      const clippedRight = Math.min(raw.left + raw.width + pad, maxX);
      const clippedTop = Math.max(raw.top - pad, minY);
      const clippedBottom = Math.min(raw.top + raw.height + pad, maxY);
      const padded: SpotlightRect =
        clippedRight > clippedLeft + 8 && clippedBottom > clippedTop + 8
          ? {
              left: clippedLeft,
              top: clippedTop,
              width: clippedRight - clippedLeft,
              height: clippedBottom - clippedTop,
            }
          : {
              left: raw.left - pad,
              top: raw.top - pad,
              width: raw.width + pad * 2,
              height: raw.height + pad * 2,
            };
      rawRings.push({
        rect: clampRectToBounds(padded, viewport, 2),
        borderRadius,
        targetTestId,
        targetSelector: usedSelector,
      });
    }

    syncObservedElements(observeTargets);

    const separatedRects = preventRingOverlap(rawRings.map((r) => r.rect), 2);
    const resolvedRings = rawRings.map((ring, idx) => ({
      ...ring,
      rect: separatedRects[idx],
    }));

    let connector: SpotlightConnector | null = null;
    if (cardRect && resolvedRings.length > 0) {
      let anchorRect = resolvedRings[0].rect;
      if (resolvedRings.length >= 2) {
        const r0 = resolvedRings[0].rect;
        const r1 = resolvedRings[1].rect;
        const c0x = r0.left + r0.width / 2;
        const c0y = r0.top + r0.height / 2;
        const c1x = r1.left + r1.width / 2;
        const c1y = r1.top + r1.height / 2;
        if (Math.hypot(c1x - c0x, c1y - c0y) <= 110) {
          const minL = Math.min(r0.left, r1.left);
          const minT = Math.min(r0.top, r1.top);
          const maxR = Math.max(r0.left + r0.width, r1.left + r1.width);
          const maxB = Math.max(r0.top + r0.height, r1.top + r1.height);
          anchorRect = {
            left: minL,
            top: minT,
            width: maxR - minL,
            height: maxB - minT,
          };
        }
      }
      connector = computeSpotlightConnector(cardRect, anchorRect);
    }

    const nextLayout: ResolvedLayout = { rings: resolvedRings, connector };
    setLayout((prev) => (areLayoutsEqual(prev, nextLayout) ? prev : nextLayout));
  }, [isActive, variant, targetKey, cardSelector, syncObservedElements]);

  useLayoutEffect(() => {
    measure();
  }, [measure, largeText]);

  useEffect(() => {
    if (!isActive || !targetKey) return;

    let transitionRafId: number | null = null;
    let transitionCapDeadline = 0;
    let mutationRafId: number | null = null;

    const stopTransitionLoop = () => {
      if (transitionRafId !== null) {
        window.cancelAnimationFrame(transitionRafId);
        transitionRafId = null;
      }
    };

    const tickTransition = () => {
      measure();
      if (performance.now() < transitionCapDeadline && hasRunningRelevantTransition()) {
        transitionRafId = window.requestAnimationFrame(tickTransition);
      } else {
        transitionRafId = null;
      }
    };

    const startTransitionLoop = (maxMs: number = 650) => {
      transitionCapDeadline = Math.max(transitionCapDeadline, performance.now() + maxMs);
      if (transitionRafId === null) {
        transitionRafId = window.requestAnimationFrame(tickTransition);
      }
    };

    const onViewportChange = () => measure();
    const onTransitionStart = (ev: TransitionEvent) => {
      if (isSpotlightOverlayNode(ev.target as Node | null)) return;
      startTransitionLoop(650);
    };
    const onTransitionEnd = (ev: TransitionEvent) => {
      if (isSpotlightOverlayNode(ev.target as Node | null)) return;
      measure();
      if (!hasRunningRelevantTransition()) {
        stopTransitionLoop();
      }
    };

    window.addEventListener('resize', onViewportChange);
    window.addEventListener('scroll', onViewportChange, true);
    window.addEventListener('transitionstart', onTransitionStart, true);
    window.addEventListener('transitionend', onTransitionEnd, true);
    window.addEventListener('transitioncancel', onTransitionEnd, true);

    let ro: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(() => measure());
      resizeObserverRef.current = ro;
    }

    measure();
    if (hasRunningRelevantTransition()) {
      startTransitionLoop(650);
    }

    let mo: MutationObserver | null = null;
    if (typeof MutationObserver !== 'undefined' && document.body) {
      mo = new MutationObserver((mutations) => {
        const hasExternalMutation = mutations.some((m) => {
          if (isSpotlightOverlayNode(m.target)) return false;
          if (m.type === 'childList') {
            for (let i = 0; i < m.addedNodes.length; i++) {
              if (!isSpotlightOverlayNode(m.addedNodes[i])) return true;
            }
            for (let i = 0; i < m.removedNodes.length; i++) {
              if (!isSpotlightOverlayNode(m.removedNodes[i])) return true;
            }
            return false;
          }
          return true;
        });
        if (!hasExternalMutation) return;
        if (mutationRafId === null) {
          mutationRafId = window.requestAnimationFrame(() => {
            mutationRafId = null;
            measure();
            if (hasRunningRelevantTransition()) {
              startTransitionLoop(650);
            }
          });
        }
      });
      mo.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['style', 'class', 'hidden', 'data-minimized', 'aria-pressed'],
      });
    }

    return () => {
      stopTransitionLoop();
      if (mutationRafId !== null) {
        window.cancelAnimationFrame(mutationRafId);
      }
      window.removeEventListener('resize', onViewportChange);
      window.removeEventListener('scroll', onViewportChange, true);
      window.removeEventListener('transitionstart', onTransitionStart, true);
      window.removeEventListener('transitionend', onTransitionEnd, true);
      window.removeEventListener('transitioncancel', onTransitionEnd, true);
      mo?.disconnect();
      ro?.disconnect();
      resizeObserverRef.current = null;
      observedElementsRef.current.clear();
    };
  }, [isActive, targetKey, cardSelector, largeText, measure]);

  if (!isActive || !targetKey || layout.rings.length === 0) return null;

  const accentStroke = variant === 'tutorial' ? 'rgba(251, 191, 36, 0.95)' : 'rgba(56, 189, 248, 0.95)';
  const accentGlow =
    variant === 'tutorial'
      ? '0 0 0 1px rgba(251, 191, 36, 0.25), 0 0 12px rgba(251, 191, 36, 0.35)'
      : '0 0 0 1px rgba(56, 189, 248, 0.25), 0 0 12px rgba(56, 189, 248, 0.35)';

  return (
    <div
      data-testid="spotlight-overlay"
      data-variant={variant}
      aria-hidden="true"
      className="fixed inset-0 z-[38] pointer-events-none overflow-hidden"
    >
      {layout.rings.map((ring, idx) => (
        <div
          key={`${ring.targetSelector}-${idx}`}
          data-testid="spotlight-ring"
          data-target-testid={ring.targetTestId}
          data-target-selector={ring.targetSelector}
          className={`fixed pointer-events-none ${
            !reducedMotion
              ? 'transition-opacity duration-150 motion-reduce:transition-none capy-spotlight-pulse'
              : 'transition-none'
          }`}
          style={{
            left: `${ring.rect.left}px`,
            top: `${ring.rect.top}px`,
            width: `${ring.rect.width}px`,
            height: `${ring.rect.height}px`,
            borderRadius: ring.borderRadius === 9999 ? '9999px' : `${ring.borderRadius}px`,
            border: `2px solid ${accentStroke}`,
            boxShadow: accentGlow,
          }}
        />
      ))}

      {layout.connector && (
        <svg
          data-testid="spotlight-pointer"
          className="fixed inset-0 w-full h-full pointer-events-none overflow-visible"
        >
          <path
            d={layout.connector.d}
            fill="none"
            stroke={accentStroke}
            strokeWidth={2}
            strokeLinecap="round"
            strokeDasharray={!reducedMotion ? '5 4' : undefined}
            className={!reducedMotion ? 'capy-spotlight-dash' : undefined}
          />
          <polygon points={layout.connector.arrowPoints} fill={accentStroke} />
        </svg>
      )}
    </div>
  );
};
