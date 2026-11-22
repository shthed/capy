import { APP_VERSION, resolveReleaseChannel } from '../version';
import { NativeBridge } from './NativeBridge';

export type FeedbackCategory = 'bug' | 'feature' | 'puzzle_idea' | 'general';

export interface FeedbackContext {
  appVersion?: string;
  channel?: string;
  platform?: string;
  viewport?: string;
}

export interface FeedbackDraft {
  category: FeedbackCategory;
  title: string;
  details: string;
  website?: string;
}

export type FeedbackSubmitResult =
  | {
      ok: true;
      issueNumber?: number;
      issueUrl?: string;
      accepted?: boolean;
    }
  | {
      ok: false;
      error: string;
      fallbackUrl: string;
      status?: number;
      code?: string;
    };

export interface FeedbackLocationLike {
  protocol?: string;
  hostname?: string;
  host?: string;
  origin?: string;
}

export const FEEDBACK_MIN_TITLE_CHARS = 3;
export const FEEDBACK_MAX_TITLE_CHARS = 120;
export const FEEDBACK_MIN_DETAILS_CHARS = 10;
export const FEEDBACK_MAX_DETAILS_CHARS = 2000;
export const FEEDBACK_MAX_FALLBACK_URL_CHARS = 4000;
export const PUBLIC_ISSUES_URL = 'https://github.com/capyboop/paint/issues';
export const CANONICAL_FEEDBACK_API_URL = 'https://capypaint.com/api/feedback';

const CATEGORY_CONFIG: Record<
  FeedbackCategory,
  { label: string; prefix: string; template: string; titlePlaceholder: string; detailsPlaceholder: string }
> = {
  bug: {
    label: 'Bug Report',
    prefix: '[Bug]',
    template: 'bug_report.yml',
    titlePlaceholder: 'Short summary of the bug...',
    detailsPlaceholder: 'What happened, and what did you expect instead?',
  },
  feature: {
    label: 'Feature Request',
    prefix: '[Feature]',
    template: 'feature_request.yml',
    titlePlaceholder: 'Feature idea in a few words...',
    detailsPlaceholder: 'How would this feature improve your coloring experience?',
  },
  puzzle_idea: {
    label: 'Puzzle Idea',
    prefix: '[Puzzle Idea]',
    template: 'puzzle_idea.yml',
    titlePlaceholder: 'e.g. Capybara astronaut floating in space',
    detailsPlaceholder: 'Describe the artwork theme, mood, or colors you would love to paint...',
  },
  general: {
    label: 'General',
    prefix: '[Feedback]',
    template: '',
    titlePlaceholder: 'Topic or quick headline...',
    detailsPlaceholder: 'Share any thoughts, questions, or suggestions...',
  },
};

export const FEEDBACK_CATEGORIES: ReadonlyArray<{
  id: FeedbackCategory;
  label: string;
  titlePlaceholder: string;
  detailsPlaceholder: string;
}> = (['bug', 'feature', 'puzzle_idea', 'general'] as const).map((id) => ({
  id,
  label: CATEGORY_CONFIG[id].label,
  titlePlaceholder: CATEGORY_CONFIG[id].titlePlaceholder,
  detailsPlaceholder: CATEGORY_CONFIG[id].detailsPlaceholder,
}));

export function resolveFeedbackApiUrl(
  explicitEnvUrl?: string,
  locationLike?: FeedbackLocationLike | null
): string {
  if (explicitEnvUrl && explicitEnvUrl.trim().length > 0) {
    try {
      const parsed = new URL(explicitEnvUrl.trim());
      const proto = parsed.protocol.toLowerCase();
      const host = parsed.hostname.toLowerCase();
      if (proto === 'https:') {
        return parsed.toString();
      }
      if (proto === 'http:' && (host === 'localhost' || host === '127.0.0.1' || host === '[::1]')) {
        return parsed.toString();
      }
    } catch {
      // Ignore malformed env override and fall back to host discovery
    }
  }

  const loc =
    locationLike !== undefined
      ? locationLike
      : typeof window !== 'undefined'
        ? window.location
        : null;

  const hostname = (loc?.hostname || '').toLowerCase();
  if (!hostname) {
    return CANONICAL_FEEDBACK_API_URL;
  }

  if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]') {
    return '/api/feedback';
  }

  if (hostname === 'www.capypaint.com') {
    return CANONICAL_FEEDBACK_API_URL;
  }

  if (
    hostname === 'capypaint.com' ||
    hostname === 'paint.capyboop.com' ||
    hostname.endsWith('.capypaint.com')
  ) {
    return '/api/feedback';
  }

  return CANONICAL_FEEDBACK_API_URL;
}

function sliceWithoutBrokenSurrogate(text: string, maxUnits: number): string {
  if (text.length <= maxUnits) return text;
  const sliced = text.slice(0, maxUnits);
  const lastCode = sliced.charCodeAt(sliced.length - 1);
  if (lastCode >= 0xd800 && lastCode <= 0xdbff) {
    return sliced.slice(0, -1);
  }
  return sliced;
}

export function buildGitHubIssueFallbackUrl(
  draft: Partial<FeedbackDraft>,
  context?: FeedbackContext
): string {
  const category: FeedbackCategory =
    typeof draft.category === 'string' &&
    Object.prototype.hasOwnProperty.call(CATEGORY_CONFIG, draft.category)
      ? (draft.category as FeedbackCategory)
      : 'general';
  const cfg = CATEGORY_CONFIG[category];

  const assembleUrl = (titleValue: string, bodyValue: string): string => {
    const params = new URLSearchParams();
    if (cfg.template) {
      params.set('template', cfg.template);
    }
    if (titleValue) {
      params.set('title', `${cfg.prefix}: ${titleValue}`);
    }
    if (bodyValue) {
      params.set('body', bodyValue);
    }
    const query = params.toString();
    return query ? `${PUBLIC_ISSUES_URL}/new?${query}` : `${PUBLIC_ISSUES_URL}/new/choose`;
  };

  let effectiveTitle = sliceWithoutBrokenSurrogate((draft.title || '').trim(), FEEDBACK_MAX_TITLE_CHARS);
  const trimmedDetails = sliceWithoutBrokenSurrogate((draft.details || '').trim(), 1200);

  let suffix = '';
  if (trimmedDetails) {
    const metaParts: string[] = [];
    if (context?.appVersion) metaParts.push(`Version: ${context.appVersion}`);
    if (context?.channel) metaParts.push(`Channel: ${context.channel}`);
    if (context?.platform) metaParts.push(`Platform: ${context.platform}`);
    suffix = metaParts.length > 0 ? `\n\n---\n${metaParts.join(' | ')}` : '';
  }

  const initialBody = trimmedDetails ? `${trimmedDetails}${suffix}` : '';
  const initialUrl = assembleUrl(effectiveTitle, initialBody);
  if (initialUrl.length <= FEEDBACK_MAX_FALLBACK_URL_CHARS) {
    return initialUrl;
  }

  // Ensure the title itself fits within the URL cap before fitting details
  if (effectiveTitle && assembleUrl(effectiveTitle, '').length > FEEDBACK_MAX_FALLBACK_URL_CHARS) {
    const titleChars = Array.from(effectiveTitle);
    let lo = 0;
    let hi = titleChars.length;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      const candidate = titleChars.slice(0, mid).join('');
      if (assembleUrl(candidate, '').length <= FEEDBACK_MAX_FALLBACK_URL_CHARS) {
        lo = mid;
      } else {
        hi = mid - 1;
      }
    }
    effectiveTitle = titleChars.slice(0, lo).join('');
  }

  if (!trimmedDetails) {
    return assembleUrl(effectiveTitle, '');
  }

  const detailChars = Array.from(trimmedDetails);
  let lo = 0;
  let hi = detailChars.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    const candidateDetails =
      mid < detailChars.length ? `${detailChars.slice(0, mid).join('')}...` : trimmedDetails;
    if (assembleUrl(effectiveTitle, `${candidateDetails}${suffix}`).length <= FEEDBACK_MAX_FALLBACK_URL_CHARS) {
      lo = mid;
    } else {
      hi = mid - 1;
    }
  }

  if (lo > 0) {
    const finalDetails =
      lo < detailChars.length ? `${detailChars.slice(0, lo).join('')}...` : trimmedDetails;
    return assembleUrl(effectiveTitle, `${finalDetails}${suffix}`);
  }

  const suffixOnlyUrl = suffix ? assembleUrl(effectiveTitle, suffix.trimStart()) : '';
  if (suffixOnlyUrl && suffixOnlyUrl.length <= FEEDBACK_MAX_FALLBACK_URL_CHARS) {
    return suffixOnlyUrl;
  }
  return assembleUrl(effectiveTitle, '');
}

export function validateFeedbackDraft(
  draft: FeedbackDraft
): { ok: true; title: string; details: string } | { ok: false; error: string } {
  const title = draft.title.trim();
  if (title.length < FEEDBACK_MIN_TITLE_CHARS) {
    return {
      ok: false,
      error: `Please enter a title of at least ${FEEDBACK_MIN_TITLE_CHARS} characters.`,
    };
  }
  if (title.length > FEEDBACK_MAX_TITLE_CHARS) {
    return {
      ok: false,
      error: `Title must be ${FEEDBACK_MAX_TITLE_CHARS} characters or fewer.`,
    };
  }

  const details = draft.details.trim();
  if (details.length < FEEDBACK_MIN_DETAILS_CHARS) {
    return {
      ok: false,
      error: `Please enter at least ${FEEDBACK_MIN_DETAILS_CHARS} characters of details.`,
    };
  }
  if (details.length > FEEDBACK_MAX_DETAILS_CHARS) {
    return {
      ok: false,
      error: `Details must be ${FEEDBACK_MAX_DETAILS_CHARS} characters or fewer.`,
    };
  }

  return { ok: true, title, details };
}

function buildRuntimeFeedbackContext(): FeedbackContext {
  const channelInfo = resolveReleaseChannel();
  const platform = NativeBridge.isAndroid ? 'Android' : 'Web';
  const viewport =
    typeof window !== 'undefined' && window.innerWidth > 0 && window.innerHeight > 0
      ? `${window.innerWidth}x${window.innerHeight}`
      : undefined;
  return {
    appVersion: `v${APP_VERSION}`,
    channel: channelInfo.channel,
    platform,
    viewport,
  };
}

async function readJsonObjectSafely(response: Response): Promise<Record<string, unknown> | null> {
  try {
    const parsed = await response.json();
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // Non-JSON upstream error body
  }
  return null;
}

const GITHUB_ISSUES_PATH_PATTERN = /^\/[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,37}[a-zA-Z0-9])?\/[a-zA-Z0-9_.-]{1,100}\/issues(?:\/|$)/;

/**
 * Validates that an upstream feedback issue/fallback link is strictly an HTTPS URL on
 * `github.com` under `/<owner>/<repo>/issues`, rejecting phishing redirects, credentials,
 * non-default ports, and control characters.
 */
export function sanitizeGitHubIssueUrl(rawUrl: unknown): string | undefined {
  if (typeof rawUrl !== 'string') return undefined;
  const trimmed = rawUrl.trim();
  if (!trimmed || /[\s\u0000-\u001F\u007F]/.test(trimmed)) return undefined;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol.toLowerCase() !== 'https:') return undefined;
    if (parsed.hostname.toLowerCase() !== 'github.com') return undefined;
    if (parsed.port !== '' || parsed.username !== '' || parsed.password !== '') return undefined;
    if (!GITHUB_ISSUES_PATH_PATTERN.test(parsed.pathname) || parsed.pathname.includes('..')) {
      return undefined;
    }
    return parsed.toString();
  } catch {
    return undefined;
  }
}

function interpretFeedbackResponse(
  response: Response,
  payload: Record<string, unknown> | null,
  fallbackUrl: string
): FeedbackSubmitResult {
  if (response.ok) {
    return {
      ok: true,
      issueNumber: typeof payload?.issueNumber === 'number' ? payload.issueNumber : undefined,
      issueUrl: sanitizeGitHubIssueUrl(payload?.issueUrl),
      accepted: payload?.accepted === true ? true : undefined,
    };
  }

  const serverFallback = sanitizeGitHubIssueUrl(payload?.fallbackUrl) ?? fallbackUrl;
  const serverCode = typeof payload?.code === 'string' ? payload.code : undefined;

  if (response.status === 429) {
    return {
      ok: false,
      status: 429,
      code: serverCode ?? 'rate_limited',
      error: 'Too many submissions right now. Please wait a minute and try again.',
      fallbackUrl: serverFallback,
    };
  }

  const serverError =
    typeof payload?.error === 'string' && payload.error.trim().length > 0
      ? payload.error.trim()
      : 'Could not send feedback right now. You can open the prefilled GitHub form instead.';

  return {
    ok: false,
    status: response.status,
    code: serverCode,
    error: serverError,
    fallbackUrl: serverFallback,
  };
}

export async function submitAnonymousFeedback(
  draft: FeedbackDraft,
  options?: {
    apiUrl?: string;
    fetchImpl?: typeof fetch;
    context?: FeedbackContext;
  }
): Promise<FeedbackSubmitResult> {
  const context = options?.context ?? buildRuntimeFeedbackContext();
  const fallbackUrl = buildGitHubIssueFallbackUrl(draft, context);

  const check = validateFeedbackDraft(draft);
  if (!check.ok) {
    return {
      ok: false,
      error: check.error,
      fallbackUrl,
    };
  }

  const envUrl =
    typeof import.meta !== 'undefined'
      ? (import.meta as unknown as { env?: Record<string, string | undefined> }).env
          ?.VITE_CAPY_FEEDBACK_API_URL
      : undefined;
  const endpoint = options?.apiUrl ?? resolveFeedbackApiUrl(envUrl);
  const fetchFn = options?.fetchImpl ?? fetch;

  try {
    const response = await fetchFn(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        category: draft.category,
        title: check.title,
        details: check.details,
        website: draft.website ?? '',
        context,
      }),
    });
    const payload = await readJsonObjectSafely(response);
    return interpretFeedbackResponse(response, payload, fallbackUrl);
  } catch {
    return {
      ok: false,
      code: 'network_error',
      error: 'Unable to reach the feedback server (offline or blocked). Use the prefilled GitHub form instead.',
      fallbackUrl,
    };
  }
}
