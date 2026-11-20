import React, { useEffect } from 'react';
import { BookOpen, Lightbulb, X } from 'lucide-react';
import { FeatureOfferDef } from '../services/FeatureOffersService';

interface FeatureOfferBannerProps {
  offer: FeatureOfferDef | null;
  isSuppressed?: boolean;
  onJumpToGuide: (tutorialStepIndex: number) => void;
  onDismiss: () => void;
}

export const FeatureOfferBanner: React.FC<FeatureOfferBannerProps> = ({
  offer,
  isSuppressed = false,
  onJumpToGuide,
  onDismiss,
}) => {
  useEffect(() => {
    if (!offer || isSuppressed) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onDismiss();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [offer, isSuppressed, onDismiss]);

  if (!offer || isSuppressed) return null;

  return (
    <div
      className="fixed inset-x-0 z-[39] pointer-events-none flex justify-center px-3"
      style={{
        top: 'calc(var(--capy-tutorial-top, 4.75rem) + var(--sat, 0px))',
      }}
    >
      <div
        role="status"
        aria-live="polite"
        data-testid="feature-offer-banner"
        data-offer-id={offer.id}
        className="pointer-events-auto w-full max-w-md max-h-[calc(100dvh-13rem)] overflow-y-auto rounded-2xl bg-slate-900/95 border border-sky-400/50 shadow-2xl backdrop-blur-xl px-3 py-2.5 text-slate-100 space-y-1.5 animate-in fade-in slide-in-from-top-2 duration-200"
      >
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-start gap-2 min-w-0">
            <span className="inline-flex items-center justify-center w-6 h-6 rounded-lg bg-sky-400/20 border border-sky-400/40 text-sky-300 flex-shrink-0 mt-0.5">
              <Lightbulb size={13} />
            </span>
            <div className="min-w-0">
              <div className="text-[10px] font-extrabold uppercase tracking-wider text-sky-300">
                Quick Tip
              </div>
              <h4 className="text-xs sm:text-sm font-extrabold text-white leading-snug">
                {offer.title}
              </h4>
            </div>
          </div>

          <button
            type="button"
            data-testid="feature-offer-close-btn"
            aria-label="Dismiss Feature Tip"
            onClick={onDismiss}
            className="capy-icon-btn p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800/80 transition-colors cursor-pointer flex-shrink-0"
          >
            <X size={14} />
          </button>
        </div>

        <p className="text-[11px] sm:text-xs leading-relaxed text-slate-300">
          {offer.message}
        </p>

        <div className="flex flex-wrap items-center justify-end gap-2 pt-0.5">
          <button
            type="button"
            data-testid="feature-offer-guide-btn"
            onClick={() => onJumpToGuide(offer.tutorialStepIndex)}
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-sky-200 border border-slate-700 text-xs font-bold transition-colors cursor-pointer"
          >
            <BookOpen size={12} />
            <span>Jump to Guide</span>
          </button>
          <button
            type="button"
            data-testid="feature-offer-dismiss-btn"
            onClick={onDismiss}
            className="px-3 py-1 rounded-lg bg-sky-400 hover:bg-sky-300 text-slate-950 text-xs font-extrabold shadow transition-colors cursor-pointer"
          >
            Got it
          </button>
        </div>
      </div>
    </div>
  );
};
