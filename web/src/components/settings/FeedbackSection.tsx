import React, { useState } from 'react';
import { ExternalLink, MessageSquare } from 'lucide-react';
import {
  FEEDBACK_CATEGORIES,
  FEEDBACK_MAX_DETAILS_CHARS,
  FEEDBACK_MAX_TITLE_CHARS,
  FeedbackCategory,
  FeedbackSubmitResult,
  PUBLIC_ISSUES_URL,
  submitAnonymousFeedback,
} from '../../services/FeedbackService';

export const FeedbackSection: React.FC = () => {
  const [feedbackCategory, setFeedbackCategory] = useState<FeedbackCategory>('bug');
  const [feedbackTitle, setFeedbackTitle] = useState('');
  const [feedbackDetails, setFeedbackDetails] = useState('');
  const [feedbackHoneypot, setFeedbackHoneypot] = useState('');
  const [feedbackSubmitting, setFeedbackSubmitting] = useState(false);
  const [feedbackResult, setFeedbackResult] = useState<FeedbackSubmitResult | null>(null);

  const activeFeedbackCategoryMeta =
    FEEDBACK_CATEGORIES.find((c) => c.id === feedbackCategory) ?? FEEDBACK_CATEGORIES[0];

  const handleSubmitFeedback = async (e: React.FormEvent) => {
    e.preventDefault();
    if (feedbackSubmitting) return;
    setFeedbackSubmitting(true);
    setFeedbackResult(null);
    const result = await submitAnonymousFeedback({
      category: feedbackCategory,
      title: feedbackTitle,
      details: feedbackDetails,
      website: feedbackHoneypot,
    });
    setFeedbackResult(result);
    if (result.ok) {
      setFeedbackTitle('');
      setFeedbackDetails('');
      setFeedbackHoneypot('');
    }
    setFeedbackSubmitting(false);
  };

  return (
    <form
      data-testid="in-game-feedback-card"
      onSubmit={handleSubmitFeedback}
      noValidate
      className="p-3.5 sm:p-4 rounded-xl bg-slate-950/80 border border-sky-500/30 space-y-3"
    >
      <div className="flex items-center justify-between gap-2">
        <div>
          <h3 className="text-xs sm:text-sm font-bold text-slate-100">
            Send Anonymous Feedback
          </h3>
          <p className="text-[11px] text-slate-400 mt-0.5">
            Sent anonymously to capyboop/paint Issues — no account required. Includes app version
            &amp; platform only.
          </p>
        </div>
      </div>

      {/* Category Selector Pills */}
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Feedback category">
        {FEEDBACK_CATEGORIES.map((cat) => {
          const active = feedbackCategory === cat.id;
          return (
            <button
              key={cat.id}
              type="button"
              data-testid={`feedback-category-${cat.id}`}
              aria-pressed={active}
              onClick={() => {
                setFeedbackCategory(cat.id);
                setFeedbackResult(null);
              }}
              className={`px-2.5 py-1 rounded-lg text-[11px] font-bold border transition-colors cursor-pointer ${
                active
                  ? 'bg-amber-400 text-slate-950 border-amber-300'
                  : 'bg-slate-900 hover:bg-slate-800 text-slate-300 border-slate-700/80'
              }`}
            >
              {cat.label}
            </button>
          );
        })}
      </div>

      {/* Hidden Honeypot Field */}
      <input
        type="text"
        name="website"
        value={feedbackHoneypot}
        onChange={(e) => setFeedbackHoneypot(e.target.value)}
        tabIndex={-1}
        autoComplete="off"
        aria-hidden="true"
        className="hidden"
      />

      {/* Title Input */}
      <div className="space-y-1">
        <label
          htmlFor="capy-feedback-title"
          className="block text-[11px] font-semibold text-slate-300"
        >
          Title
        </label>
        <input
          id="capy-feedback-title"
          type="text"
          data-testid="feedback-title-input"
          value={feedbackTitle}
          onChange={(e) => setFeedbackTitle(e.target.value)}
          maxLength={FEEDBACK_MAX_TITLE_CHARS}
          placeholder={activeFeedbackCategoryMeta.titlePlaceholder}
          className="w-full px-2.5 py-1.5 rounded-lg bg-slate-900 border border-slate-700/90 text-xs text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-amber-400"
        />
      </div>

      {/* Details Textarea + Character Counter */}
      <div className="space-y-1">
        <div className="flex items-center justify-between gap-2">
          <label
            htmlFor="capy-feedback-details"
            className="block text-[11px] font-semibold text-slate-300"
          >
            Details
          </label>
          <span
            data-testid="feedback-details-counter"
            className="text-[10px] font-mono text-slate-400"
          >
            {feedbackDetails.length}/{FEEDBACK_MAX_DETAILS_CHARS}
          </span>
        </div>
        <textarea
          id="capy-feedback-details"
          data-testid="feedback-details-input"
          rows={3}
          value={feedbackDetails}
          onChange={(e) => setFeedbackDetails(e.target.value)}
          maxLength={FEEDBACK_MAX_DETAILS_CHARS}
          placeholder={activeFeedbackCategoryMeta.detailsPlaceholder}
          className="w-full px-2.5 py-1.5 rounded-lg bg-slate-900 border border-slate-700/90 text-xs text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-amber-400 resize-y"
        />
      </div>

      {/* Actions */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <button
          type="submit"
          data-testid="feedback-submit-btn"
          disabled={feedbackSubmitting}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-400 hover:bg-amber-300 disabled:opacity-50 disabled:cursor-not-allowed text-slate-950 text-xs font-extrabold shadow transition-colors cursor-pointer"
        >
          <MessageSquare size={13} />
          <span>{feedbackSubmitting ? 'Sending...' : 'Submit Feedback'}</span>
        </button>
        <a
          href={PUBLIC_ISSUES_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-[11px] font-semibold text-sky-400 hover:text-sky-300 underline underline-offset-2"
        >
          <span>Browse capyboop/paint Issues</span>
          <ExternalLink size={11} />
        </a>
      </div>

      {/* Inline Status Banner (zero blocking alert()) */}
      {feedbackResult && (
        <div
          data-testid="feedback-status-banner"
          role="status"
          className={`p-2.5 rounded-lg border text-xs space-y-1 ${
            feedbackResult.ok
              ? 'bg-emerald-950/60 border-emerald-500/40 text-emerald-200'
              : 'bg-amber-950/60 border-amber-500/40 text-amber-200'
          }`}
        >
          {feedbackResult.ok ? (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span>
                Thanks! Your anonymous feedback was submitted
                {feedbackResult.issueNumber ? ` as issue #${feedbackResult.issueNumber}` : ''}.
              </span>
              {feedbackResult.issueUrl && (
                <a
                  href={feedbackResult.issueUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  data-testid="feedback-issue-link"
                  className="inline-flex items-center gap-1 font-bold text-emerald-300 hover:text-emerald-200 underline underline-offset-2"
                >
                  <span>
                    {feedbackResult.issueNumber
                      ? `View Issue #${feedbackResult.issueNumber}`
                      : 'View Issue on GitHub'}
                  </span>
                  <ExternalLink size={11} />
                </a>
              )}
            </div>
          ) : (
            <div className="space-y-1">
              <div>{feedbackResult.error}</div>
              <a
                href={feedbackResult.fallbackUrl}
                target="_blank"
                rel="noopener noreferrer"
                data-testid="feedback-fallback-link"
                className="inline-flex items-center gap-1 font-bold text-amber-300 hover:text-amber-200 underline underline-offset-2"
              >
                <span>Open prefilled GitHub form</span>
                <ExternalLink size={11} />
              </a>
            </div>
          )}
        </div>
      )}
    </form>
  );
};
