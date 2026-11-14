import React, { useCallback, useEffect, useLayoutEffect, useState } from 'react';
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
  isCanvasFocal?: boolean;
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
      selector: '[data-testid="palette-dock"] button[data-testid^="palette-swatch-"][aria-pressed="false"]',
      fallbackSelectors: [
        '[data-testid="palette-dock"] button[data-testid^="palette-swatch-"]',
        '[data-testid="palette-dock"]',
      ],
      padding: 6,
      borderRadius: 14,
    },
  ],
  paint: [
    {
      selector: '[data-testid="puzzle-canvas"]',
      isCanvasFocal: true,
      padding: 8,
      borderRadius: 18,
    },
    {
      selector: '[data-testid="paint-mode-btn"]',
      optional: true,
      padding: 6,
      borderRadius: 9999,
    },
  ],
  zoom: [
    {
      selector: '[data-testid="puzzle-canvas"]',
      isCanvasFocal: true,
      padding: 8,
      borderRadius: 18,
    },
  ],
  hint: [
    {
      selector: '[data-testid="palette-dock"] button[data-testid^="palette-swatch-"][aria-pressed="true"]',
      fallbackSelectors: [
        '[data-testid="tutorial-try-hint-btn"]',
        '[data-testid="palette-dock"]',
      ],
      padding: 6,
      borderRadius: 14,
    },
  ],
  undo_redo: [
    {
      selector: '[data-testid="undo-btn"]',
      fallbackSelector: '[data-testid="topbar-settings-btn"]',
      padding: 6,
      borderRadius: 9999,
    },
    {
      selector: '[data-testid="redo-btn"]',
      optional: true,
      padding: 6,
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
      padding: 6,
      borderRadius: 16,
    },
  ],
  peek_fullscreen: [
    {
      selector: '[data-testid="topbar-preview-btn"]',
      padding: 6,
      borderRadius: 9999,
    },
    {
      selector: '[data-testid="topbar-fullscreen-btn"]',
      optional: true,
      padding: 6,
      borderRadius: 9999,
    },
  ],
  free_color: [
    {
      selector: '[data-testid="palette-custom-btn"]',
      fallbackSelector: '[data-testid="topbar-settings-btn"]',
      padding: 6,
      borderRadius: 14,
    },
  ],
  gallery_daily: [
    {
      selector: '[data-testid="topbar-settings-btn"]',
      padding: 6,
      borderRadius: 9999,
    },
  ],
  custom_photo: [
    {
      selector: '[data-testid="topbar-upload-btn"]',
      padding: 6,
      borderRadius: 9999,
    },
  ],
  infinite_zoom: [
    {
      selector: '[data-testid="topbar-settings-btn"]',
      padding: 6,
      borderRadius: 9999,
    },
  ],
  saves_export: [
    {
      selector: '[data-testid="topbar-saves-btn"]',
      padding: 6,
      borderRadius: 9999,
    },
  ],
  cloud_coop: [
    {
      selector: '[data-testid="topbar-coop-btn"]',
      padding: 6,
      borderRadius: 9999,
    },
    {
      selector: '[data-testid="topbar-active-coop-pill"]',
      optional: true,
      padding: 6,
      borderRadius: 9999,
    },
  ],
  settings_a11y: [
    {
      selector: '[data-testid="topbar-settings-btn"]',
      padding: 6,
      borderRadius: 9999,
    },
  ],
};

export const FEATURE_OFFER_TARGETS: Record<FeatureOfferId, SpotlightTargetSpec[]> = {
  paint_mode: [
    {
      selector: '[data-testid="paint-mode-btn"]',
      padding: 6,
      borderRadius: 9999,
    },
  ],
  undo_replay: [
    {
      selector: '[data-testid="undo-btn"]',
      fallbackSelector: '[data-testid="redo-btn"]',
      padding: 6,
      borderRadius: 9999,
    },
    {
      selector: '[data-testid="redo-btn"]',
      optional: true,
      padding: 6,
      borderRadius: 9999,
    },
  ],
  replay_scrubber: [
    {
      selector: '[data-testid="replay-controls-window"]',
      fallbackSelector: '[data-testid="undo-btn"]',
      padding: 6,
      borderRadius: 16,
    },
  ],
  free_color: [
    {
      selector: '[data-testid="palette-custom-btn"]',
      fallbackSelector: '[data-testid="palette-dock"]',
      padding: 6,
      borderRadius: 14,
    },
  ],
  create_gallery: [
    {
      selector: '[data-testid="topbar-settings-btn"]',
      padding: 6,
      borderRadius: 9999,
    },
  ],
  photo_upload: [
    {
      selector: '[data-testid="topbar-upload-btn"]',
      fallbackSelector: '[data-testid="topbar-settings-btn"]',
      padding: 6,
      borderRadius: 9999,
    },
  ],
  infinite_zoom: [
    {
      selector: '[data-testid="topbar-parent-puzzle-btn"]',
      fallbackSelector: '[data-testid="topbar-saves-btn"]',
      padding: 6,
      borderRadius: 9999,
    },
  ],
  saves_export: [
    {
      selector: '[data-testid="topbar-saves-btn"]',
      padding: 6,
      borderRadius: 9999,
    },
  ],
  cloud_coop: [
    {
      selector: '[data-testid="topbar-coop-btn"]',
      padding: 6,
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

export function computeCanvasFocalRect(
  cardRect: SpotlightRect | null,
  viewport: { width: number; height: number }
): SpotlightRect {
  const width = Math.max(110, Math.min(240, Math.round(viewport.width * 0.56)));
  const topFloor = cardRect ? cardRect.top + cardRect.height + 22 : Math.round(viewport.height * 0.38);
  const bottomCeil = Math.max(topFloor + 72, viewport.height - 108);
  const availableH = Math.max(72, bottomCeil - topFloor);
  const height = Math.max(72, Math.min(168, Math.round(availableH * 0.68)));
  const top = topFloor + Math.max(0, Math.round((availableH - height) / 2));
  const left = Math.round((viewport.width - width) / 2);
  return clampRectToBounds({ left, top, width, height }, viewport, 8);
}

export function computeSpotlightConnector(
  cardRect: SpotlightRect,
  targetRect: SpotlightRect
): SpotlightConnector {
  const cardCx = cardRect.left + cardRect.width / 2;
  const targetCx = targetRect.left + targetRect.width / 2;
  const targetCy = targetRect.top + targetRect.height / 2;

  let startX = cardCx;
  let startY = cardRect.top + cardRect.height;
  let endX = targetCx;
  let endY = targetRect.top - 5;
  let ctrlX = (startX + endX) / 2;
  let ctrlY = (startY + endY) / 2;

  if (targetCy < cardRect.top + 4) {
    startX = Math.max(cardRect.left + 20, Math.min(cardRect.left + cardRect.width - 20, targetCx));
    startY = cardRect.top;
    endX = targetCx;
    endY = Math.min(startY - 6, targetRect.top + targetRect.height + 5);
    const dx = endX - startX;
    const dy = endY - startY;
    ctrlX = startX + dx * 0.35 + (Math.abs(dx) < 16 ? 18 : 0);
    ctrlY = startY + dy * 0.55;
  } else if (targetCy > cardRect.top + cardRect.height - 4) {
    startX = Math.max(cardRect.left + 20, Math.min(cardRect.left + cardRect.width - 20, targetCx));
    startY = cardRect.top + cardRect.height;
    endX = targetCx;
    endY = Math.max(startY + 6, targetRect.top - 5);
    const dx = endX - startX;
    const dy = endY - startY;
    ctrlX = startX + dx * 0.35 + (Math.abs(dx) < 16 ? 18 : 0);
    ctrlY = startY + dy * 0.55;
  } else if (targetCx >= cardCx) {
    startX = cardRect.left + cardRect.width;
    startY = Math.max(cardRect.top + 16, Math.min(cardRect.top + cardRect.height - 16, targetCy));
    endX = Math.max(startX + 6, targetRect.left - 5);
    endY = targetCy;
    ctrlX = (startX + endX) / 2;
    ctrlY = (startY + endY) / 2 - 16;
  } else {
    startX = cardRect.left;
    startY = Math.max(cardRect.top + 16, Math.min(cardRect.top + cardRect.height - 16, targetCy));
    endX = Math.min(startX - 6, targetRect.left + targetRect.width + 5);
    endY = targetCy;
    ctrlX = (startX + endX) / 2;
    ctrlY = (startY + endY) / 2 - 16;
  }

  const tx = endX - ctrlX;
  const ty = endY - ctrlY;
  const len = Math.hypot(tx, ty) || 1;
  const ux = tx / len;
  const uy = ty / len;
  const px = -uy;
  const py = ux;
  const headLen = 9;
  const headHalfW = 5;
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

  const measure = useCallback(() => {
    if (!isActive || !targetKey || typeof window === 'undefined') {
      setLayout({ rings: [], connector: null });
      return;
    }

    const viewport = { width: window.innerWidth, height: window.innerHeight };
    const cardEl = document.querySelector(cardSelector);
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
      setLayout({ rings: [], connector: null });
      return;
    }

    const resolvedRings: ResolvedTargetRing[] = [];
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

      const pad = spec.padding ?? 6;
      const borderRadius = spec.borderRadius ?? 14;
      const targetTestId = el.getAttribute('data-testid') || '';

      if (spec.isCanvasFocal) {
        const focalRect = computeCanvasFocalRect(cardRect, viewport);
        resolvedRings.push({
          rect: focalRect,
          borderRadius,
          targetTestId,
          targetSelector: usedSelector,
        });
      } else {
        const raw = el.getBoundingClientRect();
        const padded: SpotlightRect = {
          left: raw.left - pad,
          top: raw.top - pad,
          width: raw.width + pad * 2,
          height: raw.height + pad * 2,
        };
        resolvedRings.push({
          rect: clampRectToBounds(padded, viewport, 2),
          borderRadius,
          targetTestId,
          targetSelector: usedSelector,
        });
      }
    }

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

    setLayout({ rings: resolvedRings, connector });
  }, [isActive, variant, targetKey, cardSelector]);

  useLayoutEffect(() => {
    measure();
  }, [measure, largeText]);

  useEffect(() => {
    if (!isActive || !targetKey) return;

    let rafId: number | null = null;
    const settleDeadline = performance.now() + 450;

    const tickSettle = () => {
      measure();
      if (performance.now() < settleDeadline) {
        rafId = window.requestAnimationFrame(tickSettle);
      } else {
        rafId = null;
      }
    };
    rafId = window.requestAnimationFrame(tickSettle);

    const onViewportChange = () => measure();
    window.addEventListener('resize', onViewportChange);
    window.addEventListener('scroll', onViewportChange, true);

    let ro: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(() => measure());
      const cardEl = document.querySelector(cardSelector);
      const headerEl = document.querySelector('header');
      const dockEl = document.querySelector('[data-testid="palette-dock"]');
      if (cardEl) ro.observe(cardEl);
      if (headerEl) ro.observe(headerEl);
      if (dockEl) ro.observe(dockEl);
    }

    return () => {
      if (rafId !== null) window.cancelAnimationFrame(rafId);
      window.removeEventListener('resize', onViewportChange);
      window.removeEventListener('scroll', onViewportChange, true);
      ro?.disconnect();
    };
  }, [isActive, targetKey, cardSelector, largeText, measure]);

  if (!isActive || !targetKey || layout.rings.length === 0) return null;

  const accentStroke = variant === 'tutorial' ? 'rgba(251, 191, 36, 0.95)' : 'rgba(56, 189, 248, 0.95)';
  const accentGlow =
    variant === 'tutorial'
      ? '0 0 0 2px rgba(251, 191, 36, 0.35), 0 0 18px rgba(251, 191, 36, 0.45)'
      : '0 0 0 2px rgba(56, 189, 248, 0.35), 0 0 18px rgba(56, 189, 248, 0.45)';

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
              ? 'transition-[left,top,width,height] duration-150 motion-reduce:transition-none capy-spotlight-pulse'
              : 'transition-none'
          }`}
          style={{
            left: `${ring.rect.left}px`,
            top: `${ring.rect.top}px`,
            width: `${ring.rect.width}px`,
            height: `${ring.rect.height}px`,
            borderRadius: ring.borderRadius === 9999 ? '9999px' : `${ring.borderRadius}px`,
            border: `2.5px solid ${accentStroke}`,
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
            strokeWidth={2.5}
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
