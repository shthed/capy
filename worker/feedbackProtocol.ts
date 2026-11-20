import { getUtf8ByteLength, isAllowedRelayOrigin } from './coopRoomProtocol';

export const MAX_FEEDBACK_BODY_BYTES = 8192;
export const MIN_TITLE_CHARS = 3;
export const MAX_TITLE_CHARS = 120;
export const MIN_DETAILS_CHARS = 10;
export const MAX_DETAILS_CHARS = 2000;
export const MAX_META_CHARS = 120;
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

const VALID_REPO_PATTERN = /^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/;

export function resolveFeedbackRepo(rawRepo?: string | null): string {
  const trimmed = typeof rawRepo === 'string' ? rawRepo.trim() : '';
  if (trimmed && VALID_REPO_PATTERN.test(trimmed)) {
    return trimmed;
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

  // Neutralize GitHub @mentions so anonymous feedback cannot ping arbitrary users or teams
  cleaned = cleaned.replace(
    /(^|[\s(])@([a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?(?:\/[a-zA-Z0-9_.-]+)?)/g,
    '$1`@$2`'
  );

  return cleaned.trim();
}

function sanitizeMetaField(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const cleaned = sanitizeFeedbackText(value, false).slice(0, MAX_META_CHARS).trim();
  return cleaned.length > 0 ? cleaned : undefined;
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

export function buildFallbackIssueUrl(
  draft: Partial<ValidatedFeedbackPayload>,
  rawRepo?: string | null
): string {
  const repo = resolveFeedbackRepo(rawRepo);
  const category: FeedbackCategory =
    draft.category && VALID_CATEGORIES.has(draft.category) ? draft.category : 'general';
  const meta = CATEGORY_META[category];

  const params = new URLSearchParams();
  if (meta.template) {
    params.set('template', meta.template);
  }
  const cleanTitle = draft.title ? sanitizeFeedbackText(draft.title, false).slice(0, MAX_TITLE_CHARS) : '';
  if (cleanTitle) {
    params.set('title', `${meta.prefix}: ${cleanTitle}`);
  }
  const cleanDetails = draft.details
    ? sanitizeFeedbackText(draft.details, true).slice(0, 1200)
    : '';
  if (cleanDetails) {
    const contextParts: string[] = [];
    if (draft.context?.appVersion) contextParts.push(`Version: ${draft.context.appVersion}`);
    if (draft.context?.channel) contextParts.push(`Channel: ${draft.context.channel}`);
    if (draft.context?.platform) contextParts.push(`Platform: ${draft.context.platform}`);
    const suffix = contextParts.length > 0 ? `\n\n---\n${contextParts.join(' | ')}` : '';
    params.set('body', `${cleanDetails}${suffix}`);
  }

  const query = params.toString();
  return query
    ? `https://github.com/${repo}/issues/new?${query}`
    : `https://github.com/${repo}/issues/new/choose`;
}

export function buildFeedbackCorsHeaders(
  originHeader: string | null | undefined,
  allowedExtraOrigins?: string | null,
  allowLocalhostOrigins: boolean = false
): Record<string, string> {
  if (isAllowedRelayOrigin(originHeader, allowedExtraOrigins, allowLocalhostOrigins)) {
    return {
      'Access-Control-Allow-Origin': (originHeader as string).trim(),
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
