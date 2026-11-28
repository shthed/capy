import { getUtf8ByteLength, isAllowedRelayOrigin } from './coopRoomProtocol';

export const MAX_FEEDBACK_BODY_BYTES = 8192;
export const MIN_TITLE_CHARS = 3;
export const MAX_TITLE_CHARS = 120;
export const MIN_DETAILS_CHARS = 10;
export const MAX_DETAILS_CHARS = 2000;
export const MAX_META_CHARS = 120;
export const MAX_FALLBACK_URL_CHARS = 4000;
export const DEFAULT_FEEDBACK_REPO = 'capyboop/paint';

export type FeedbackCategory = 'bug' | 'feature' | 'puzzle_idea' | 'general';

export interface FeedbackContext {
  appVersion?: string;
  channel?: string;
  platform?: string;
  viewport?: string;
}

export interface ValidatedFeedbackPayload {
  category: FeedbackCategory;
  title: string;
  details: string;
  context: FeedbackContext;
}

export type FeedbackValidationResult =
  | { ok: true; payload: ValidatedFeedbackPayload }
  | { ok: false; honeypot: true }
  | { ok: false; honeypot?: false; status?: 400 | 413; error: string };

export type ReadBodyTextResult =
  | { ok: true; text: string }
  | { ok: false; status: 413; error: string };

export interface GitHubIssuePayload {
  title: string;
  body: string;
  labels: string[];
}

export interface FeedbackCategoryMeta {
  prefix: string;
  labels: readonly string[];
  template: string;
  displayName: string;
}

const VALID_CATEGORIES = new Set<FeedbackCategory>(['bug', 'feature', 'puzzle_idea', 'general']);

const CATEGORY_META: Record<FeedbackCategory, FeedbackCategoryMeta> = {
  bug: {
    prefix: '[Bug]',
    labels: ['bug'],
    template: 'bug_report.yml',
    displayName: 'Bug Report',
  },
  feature: {
    prefix: '[Feature]',
    labels: ['enhancement'],
    template: 'feature_request.yml',
    displayName: 'Feature Request',
  },
  puzzle_idea: {
    prefix: '[Puzzle Idea]',
    labels: ['enhancement'],
    template: 'puzzle_idea.yml',
    displayName: 'Puzzle Idea',
  },
  general: {
    prefix: '[Feedback]',
    labels: ['question'],
    template: '',
    displayName: 'General Feedback',
  },
};

const VALID_REPO_OWNER_PATTERN = /^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,37}[a-zA-Z0-9])?$/;
const VALID_REPO_NAME_PATTERN = /^[a-zA-Z0-9_.-]{1,100}$/;

export function resolveFeedbackRepo(rawRepo?: string | null): string {
  const trimmed = typeof rawRepo === 'string' ? rawRepo.trim() : '';
  if (!trimmed) {
    return DEFAULT_FEEDBACK_REPO;
  }
  const segments = trimmed.split('/');
  if (segments.length !== 2) {
    return DEFAULT_FEEDBACK_REPO;
  }
  const [owner, repo] = segments;
  if (
    VALID_REPO_OWNER_PATTERN.test(owner) &&
    VALID_REPO_NAME_PATTERN.test(repo) &&
    repo !== '.' &&
    repo !== '..' &&
    !repo.includes('..')
  ) {
    return `${owner}/${repo}`;
  }
  return DEFAULT_FEEDBACK_REPO;
}

export function getFeedbackCategoryMeta(category: FeedbackCategory): FeedbackCategoryMeta {
  return CATEGORY_META[category];
}

export function sanitizeFeedbackText(input: string, preserveNewlines: boolean): string {
  let cleaned = input.replace(/\r\n?/g, '\n');
  if (preserveNewlines) {
    cleaned = cleaned.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '');
  } else {
    cleaned = cleaned
      .replace(/[\u0000-\u001F\u007F]/g, ' ')
      .replace(/\s+/g, ' ');
  }

  // Prevent triple-backtick code fence breakouts in GitHub markdown
  cleaned = cleaned.replace(/`{3,}/g, "'''");

  // Neutralize GitHub @mentions across all Markdown/punctuation boundaries (including unclosed backticks)
  // while preserving email addresses like a@b.com and foo.bar@example.com
  cleaned = cleaned.replace(
    /(^|[^a-zA-Z0-9_])@([a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?(?:\/[a-zA-Z0-9_.-]+)?)/g,
    '$1@\u200B$2'
  );

  return cleaned.trim();
}

function sanitizeMetaField(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const cleaned = sanitizeFeedbackText(value, false).slice(0, MAX_META_CHARS).trim();
  return cleaned.length > 0 ? cleaned : undefined;
}

export async function readBodyTextWithLimit(
  request: Pick<Request, 'body'>,
  maxBytes: number = MAX_FEEDBACK_BODY_BYTES
): Promise<ReadBodyTextResult> {
  const limit = Number.isFinite(maxBytes)
    ? Math.max(0, Math.floor(maxBytes))
    : MAX_FEEDBACK_BODY_BYTES;

  if (!request.body) {
    return { ok: true, text: '' };
  }

  const reader = request.body.getReader();
  const decoder = new TextDecoder('utf-8');
  const parts: string[] = [];
  let totalBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value || value.byteLength === 0) continue;

      totalBytes += value.byteLength;
      if (totalBytes > limit) {
        try {
          await reader.cancel('Feedback payload exceeds byte limit');
        } catch {
          // Ignore cancellation errors after aborting an oversized stream
        }
        return {
          ok: false,
          status: 413,
          error: `Feedback payload exceeds the ${limit}-byte limit.`,
        };
      }

      parts.push(decoder.decode(value, { stream: true }));
    }

    const tail = decoder.decode();
    if (tail) {
      parts.push(tail);
    }

    return { ok: true, text: parts.join('') };
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // Ignore if reader lock is already released
    }
  }
}

export function validateFeedbackPayload(rawBody: string): FeedbackValidationResult {
  if (typeof rawBody !== 'string' || rawBody.trim().length === 0) {
    return { ok: false, status: 400, error: 'Request body must be a JSON object.' };
  }

  if (getUtf8ByteLength(rawBody) > MAX_FEEDBACK_BODY_BYTES) {
    return {
      ok: false,
      status: 413,
      error: `Feedback payload exceeds the ${MAX_FEEDBACK_BODY_BYTES}-byte limit.`,
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return { ok: false, status: 400, error: 'Malformed JSON body.' };
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, status: 400, error: 'Feedback payload must be a JSON object.' };
  }

  const record = parsed as Record<string, unknown>;

  if (typeof record.website === 'string' && record.website.trim().length > 0) {
    return { ok: false, honeypot: true };
  }

  const rawCategory = typeof record.category === 'string' ? record.category.trim() : '';
  if (!VALID_CATEGORIES.has(rawCategory as FeedbackCategory)) {
    return {
      ok: false,
      status: 400,
      error: 'Category must be one of: bug, feature, puzzle_idea, general.',
    };
  }
  const category = rawCategory as FeedbackCategory;

  if (typeof record.title !== 'string') {
    return { ok: false, status: 400, error: 'Title is required.' };
  }
  const title = sanitizeFeedbackText(record.title, false);
  if (title.length < MIN_TITLE_CHARS || title.length > MAX_TITLE_CHARS) {
    return {
      ok: false,
      status: 400,
      error: `Title must be between ${MIN_TITLE_CHARS} and ${MAX_TITLE_CHARS} characters.`,
    };
  }

  if (typeof record.details !== 'string') {
    return { ok: false, status: 400, error: 'Details are required.' };
  }
  const details = sanitizeFeedbackText(record.details, true);
  if (details.length < MIN_DETAILS_CHARS || details.length > MAX_DETAILS_CHARS) {
    return {
      ok: false,
      status: 400,
      error: `Details must be between ${MIN_DETAILS_CHARS} and ${MAX_DETAILS_CHARS} characters.`,
    };
  }

  const context: FeedbackContext = {};
  if (record.context && typeof record.context === 'object' && !Array.isArray(record.context)) {
    const ctx = record.context as Record<string, unknown>;
    const appVersion = sanitizeMetaField(ctx.appVersion);
    const channel = sanitizeMetaField(ctx.channel);
    const platform = sanitizeMetaField(ctx.platform);
    const viewport = sanitizeMetaField(ctx.viewport);
    if (appVersion) context.appVersion = appVersion;
    if (channel) context.channel = channel;
    if (platform) context.platform = platform;
    if (viewport) context.viewport = viewport;
  }

  return {
    ok: true,
    payload: {
      category,
      title,
      details,
      context,
    },
  };
}

export function buildGitHubIssuePayload(payload: ValidatedFeedbackPayload): GitHubIssuePayload {
  const meta = CATEGORY_META[payload.category];
  const issueTitle = `${meta.prefix}: ${payload.title}`.slice(0, 140);

  const envLines: string[] = [
    '- **Source**: Anonymous in-game feedback',
    `- **Category**: ${meta.displayName}`,
  ];
  if (payload.context.appVersion) {
    envLines.push(`- **App Version**: ${payload.context.appVersion}`);
  }
  if (payload.context.channel) {
    envLines.push(`- **Channel**: ${payload.context.channel}`);
  }
  if (payload.context.platform) {
    envLines.push(`- **Platform**: ${payload.context.platform}`);
  }
  if (payload.context.viewport) {
    envLines.push(`- **Viewport**: ${payload.context.viewport}`);
  }

  const body = [
    payload.details,
    '',
    '---',
    ...envLines,
  ].join('\n');

  return {
    title: issueTitle,
    body,
    labels: [...meta.labels],
  };
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

export function buildFallbackIssueUrl(
  draft: Partial<ValidatedFeedbackPayload>,
  rawRepo?: string | null
): string {
  const repo = resolveFeedbackRepo(rawRepo);
  const category: FeedbackCategory =
    draft.category && VALID_CATEGORIES.has(draft.category) ? draft.category : 'general';
  const meta = CATEGORY_META[category];

  const assembleUrl = (titleValue: string, bodyValue: string): string => {
    const params = new URLSearchParams();
    if (meta.template) {
      params.set('template', meta.template);
    }
    if (titleValue) {
      params.set('title', `${meta.prefix}: ${titleValue}`);
    }
    if (bodyValue) {
      params.set('body', bodyValue);
    }
    const query = params.toString();
    return query
      ? `https://github.com/${repo}/issues/new?${query}`
      : `https://github.com/${repo}/issues/new/choose`;
  };

  let effectiveTitle = draft.title
    ? sliceWithoutBrokenSurrogate(sanitizeFeedbackText(draft.title, false), MAX_TITLE_CHARS)
    : '';
  const cleanDetails = draft.details
    ? sliceWithoutBrokenSurrogate(sanitizeFeedbackText(draft.details, true), 1200)
    : '';

  let suffix = '';
  if (cleanDetails) {
    const contextParts: string[] = [];
    if (draft.context?.appVersion) contextParts.push(`Version: ${draft.context.appVersion}`);
    if (draft.context?.channel) contextParts.push(`Channel: ${draft.context.channel}`);
    if (draft.context?.platform) contextParts.push(`Platform: ${draft.context.platform}`);
    suffix = contextParts.length > 0 ? `\n\n---\n${contextParts.join(' | ')}` : '';
  }

  const initialBody = cleanDetails ? `${cleanDetails}${suffix}` : '';
  const initialUrl = assembleUrl(effectiveTitle, initialBody);
  if (initialUrl.length <= MAX_FALLBACK_URL_CHARS) {
    return initialUrl;
  }

  // Ensure the title itself fits within the URL cap before fitting details
  if (effectiveTitle && assembleUrl(effectiveTitle, '').length > MAX_FALLBACK_URL_CHARS) {
    const titleChars = Array.from(effectiveTitle);
    let lo = 0;
    let hi = titleChars.length;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      const candidate = titleChars.slice(0, mid).join('');
      if (assembleUrl(candidate, '').length <= MAX_FALLBACK_URL_CHARS) {
        lo = mid;
      } else {
        hi = mid - 1;
      }
    }
    effectiveTitle = titleChars.slice(0, lo).join('');
  }

  if (!cleanDetails) {
    return assembleUrl(effectiveTitle, '');
  }

  const detailChars = Array.from(cleanDetails);
  let lo = 0;
  let hi = detailChars.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    const candidateDetails =
      mid < detailChars.length ? `${detailChars.slice(0, mid).join('')}...` : cleanDetails;
    if (assembleUrl(effectiveTitle, `${candidateDetails}${suffix}`).length <= MAX_FALLBACK_URL_CHARS) {
      lo = mid;
    } else {
      hi = mid - 1;
    }
  }

  if (lo > 0) {
    const finalDetails =
      lo < detailChars.length ? `${detailChars.slice(0, lo).join('')}...` : cleanDetails;
    return assembleUrl(effectiveTitle, `${finalDetails}${suffix}`);
  }

  const suffixOnlyUrl = suffix ? assembleUrl(effectiveTitle, suffix.trimStart()) : '';
  if (suffixOnlyUrl && suffixOnlyUrl.length <= MAX_FALLBACK_URL_CHARS) {
    return suffixOnlyUrl;
  }
  return assembleUrl(effectiveTitle, '');
}

function parseStrictOrigin(originHeader: string | null | undefined): string | null {
  if (typeof originHeader !== 'string') return null;
  const trimmed = originHeader.trim();
  if (!trimmed || trimmed.includes('\\')) return null;
  try {
    const parsed = new URL(trimmed);
    if (
      parsed.origin === 'null' ||
      parsed.origin.toLowerCase() !== trimmed.toLowerCase() ||
      parsed.pathname !== '/' ||
      parsed.search !== '' ||
      parsed.hash !== ''
    ) {
      return null;
    }
    return parsed.origin;
  } catch {
    return null;
  }
}

export function buildFeedbackCorsHeaders(
  originHeader: string | null | undefined,
  allowedExtraOrigins?: string | null,
  allowLocalhostOrigins: boolean = false
): Record<string, string> {
  const canonicalOrigin = parseStrictOrigin(originHeader);
  if (
    canonicalOrigin &&
    isAllowedRelayOrigin(canonicalOrigin, allowedExtraOrigins, allowLocalhostOrigins)
  ) {
    return {
      'Access-Control-Allow-Origin': canonicalOrigin,
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400',
      Vary: 'Origin',
    };
  }
  return {
    Vary: 'Origin',
  };
}
