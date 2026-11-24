import type { BorderExtensionSides, NanoBananaModelId, NanoBananaResolution } from '../../types';
import { BLOCKED_PROMPT_PATTERNS } from '../catalog/CatalogIdeasService';

export const MAX_USER_PROMPT_LENGTH = 200;
export const DEFAULT_NANO_BANANA_MODEL: NanoBananaModelId = 'gemini-nano-banana-2.1';
export const DEFAULT_NANO_BANANA_RESOLUTION: NanoBananaResolution = '1K';

export interface NanoBananaModelMeta {
  id: NanoBananaModelId;
  label: string;
  shortLabel: string;
  description: string;
  supportedResolutions: readonly NanoBananaResolution[];
  defaultResolution: NanoBananaResolution;
}

export const NANO_BANANA_MODELS: readonly NanoBananaModelMeta[] = [
  {
    id: 'gemini-nano-banana-2.1',
    label: 'Nano Banana 2.1 (Default)',
    shortLabel: '2.1',
    description: 'Balanced detail, crisp contours, and reliable style continuity across 1K and 2K.',
    supportedResolutions: ['1K', '2K'],
    defaultResolution: '1K',
  },
  {
    id: 'gemini-3.1-flash-lite-image',
    label: 'Nano Banana 2 Lite',
    shortLabel: '2 Lite',
    description: 'Fastest lightweight image generation for quick 1K zoom iterations.',
    supportedResolutions: ['1K'],
    defaultResolution: '1K',
  },
  {
    id: 'gemini-3.1-flash-image',
    label: 'Nano Banana 2',
    shortLabel: '2',
    description: 'High-fidelity scene detail across 512, 1K, and 2K resolutions.',
    supportedResolutions: ['512', '1K', '2K'],
    defaultResolution: '1K',
  },
] as const;

export const NANO_BANANA_MODEL_MAP: Record<NanoBananaModelId, NanoBananaModelMeta> = {
  'gemini-nano-banana-2.1': NANO_BANANA_MODELS[0],
  'gemini-3.1-flash-lite-image': NANO_BANANA_MODELS[1],
  'gemini-3.1-flash-image': NANO_BANANA_MODELS[2],
};

export interface PuterAspectRatio {
  w: number;
  h: number;
}

export interface PromptSanitizationResult {
  sanitized: string;
  blocked: boolean;
}

export type NanoBananaErrorCode =
  | 'PUTER_UNAVAILABLE_ANDROID'
  | 'PUTER_LOAD_FAILED'
  | 'PUTER_CANCELLED'
  | 'PUTER_BALANCE_EXHAUSTED'
  | 'MISSING_API_KEY'
  | 'INVALID_API_KEY'
  | 'RATE_LIMITED'
  | 'SAFETY_BLOCKED'
  | 'INVALID_RESPONSE'
  | 'TIMEOUT'
  | 'ABORTED'
  | 'NETWORK_ERROR'
  | 'INVALID_IMAGE';

export class NanoBananaError extends Error {
  readonly code: NanoBananaErrorCode;
  readonly canFallbackToGuided: boolean;
  readonly cause?: unknown;

  constructor(
    code: NanoBananaErrorCode,
    message: string,
    canFallbackToGuided: boolean = true,
    cause?: unknown
  ) {
    super(message);
    this.name = 'NanoBananaError';
    this.code = code;
    this.canFallbackToGuided = canFallbackToGuided;
    if (cause !== undefined) {
      this.cause = cause;
    }
  }
}

export interface InfillPromptOptions {
  userPrompt?: string;
  neighborPaletteHex?: string[];
  depth?: number;
  width?: number;
  height?: number;
}

export interface OutpaintPromptOptions {
  userPrompt?: string;
  sides: BorderExtensionSides;
  existingPaletteHex?: string[];
  width?: number;
  height?: number;
}

interface AspectRatioCandidate {
  label: string;
  w: number;
  h: number;
  ratio: number;
}

const SUPPORTED_ASPECT_RATIOS: readonly AspectRatioCandidate[] = [
  { label: '1:1', w: 1, h: 1, ratio: 1 },
  { label: '4:3', w: 4, h: 3, ratio: 4 / 3 },
  { label: '3:4', w: 3, h: 4, ratio: 3 / 4 },
  { label: '3:2', w: 3, h: 2, ratio: 3 / 2 },
  { label: '2:3', w: 2, h: 3, ratio: 2 / 3 },
  { label: '16:9', w: 16, h: 9, ratio: 16 / 9 },
  { label: '9:16', w: 9, h: 16, ratio: 9 / 16 },
  { label: '4:5', w: 4, h: 5, ratio: 4 / 5 },
  { label: '5:4', w: 5, h: 4, ratio: 5 / 4 },
  { label: '21:9', w: 21, h: 9, ratio: 21 / 9 },
];

const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;

// ---------------------------------------------------------------------------
// Hardened Linear-Time Prompt Sanitization
// ---------------------------------------------------------------------------

function containsBlockedPattern(text: string): boolean {
  if (!text) return false;
  for (const pattern of BLOCKED_PROMPT_PATTERNS) {
    if (pattern.global || pattern.sticky) {
      pattern.lastIndex = 0;
    }
    if (pattern.test(text)) {
      return true;
    }
  }
  return false;
}

function isInvisibleFormatOrJoinerCode(code: number): boolean {
  return (
    code === 0x00ad ||
    code === 0x034f ||
    code === 0x061c ||
    code === 0x180e ||
    (code >= 0x200b && code <= 0x200f) ||
    (code >= 0x202a && code <= 0x202e) ||
    (code >= 0x2060 && code <= 0x206f) ||
    (code >= 0xfe00 && code <= 0xfe0f) ||
    code === 0xfeff
  );
}

function stripZeroWidthAndControls(raw: string): string {
  const nfkc = raw.normalize('NFKC');
  let out = '';
  for (let i = 0; i < nfkc.length; i++) {
    const code = nfkc.charCodeAt(i);
    if (isInvisibleFormatOrJoinerCode(code)) {
      continue;
    }
    out += code <= 0x1f || code === 0x7f ? ' ' : nfkc[i];
  }
  return out;
}

function isAsciiWordChar(code: number): boolean {
  return (code >= 97 && code <= 122) || (code >= 48 && code <= 57) || code === 95;
}

function isAsciiWhitespace(code: number): boolean {
  return code === 0x20 || code === 0x09 || code === 0x0a || code === 0x0d || code === 0x0c;
}

function findClosingTagEnd(lower: string, closePrefix: string, startPos: number): number {
  let searchPos = startPos;
  while (searchPos < lower.length) {
    const closeIdx = lower.indexOf(closePrefix, searchPos);
    if (closeIdx === -1) return -1;
    let scan = closeIdx + closePrefix.length;
    while (scan < lower.length && isAsciiWhitespace(lower.charCodeAt(scan))) {
      scan++;
    }
    if (scan < lower.length && lower.charCodeAt(scan) === 0x3e) {
      return scan + 1;
    }
    searchPos = scan;
  }
  return -1;
}

function stripPairedTag(text: string, tagName: string): string {
  const rawLower = text.toLowerCase();
  const lower =
    rawLower.length === text.length
      ? rawLower
      : text.replace(/[A-Z]/g, (ch) => ch.toLowerCase());
  const openPrefix = `<${tagName}`;
  const closePrefix = `</${tagName}`;
  const parts: string[] = [];
  let cursor = 0;
  let pos = 0;

  while (pos < lower.length) {
    const openIdx = lower.indexOf(openPrefix, pos);
    if (openIdx === -1) break;
    const afterName = openIdx + openPrefix.length;
    if (afterName < lower.length && isAsciiWordChar(lower.charCodeAt(afterName))) {
      pos = afterName;
      continue;
    }
    const openEnd = lower.indexOf('>', afterName);
    if (openEnd === -1) {
      parts.push(text.slice(cursor, openIdx), ' ');
      cursor = text.length;
      break;
    }
    const closeEnd = findClosingTagEnd(lower, closePrefix, openEnd + 1);
    if (closeEnd === -1) {
      parts.push(text.slice(cursor, openIdx), ' ');
      cursor = text.length;
      break;
    }
    parts.push(text.slice(cursor, openIdx), ' ');
    cursor = closeEnd;
    pos = cursor;
  }

  if (parts.length === 0) return text;
  parts.push(text.slice(cursor));
  return parts.join('');
}

function stripHtmlAndInjectionFraming(text: string): string {
  const withoutPaired = stripPairedTag(stripPairedTag(text, 'script'), 'svg');
  return withoutPaired
    .replace(/<\|[^<>|]*\|>/g, ' ')
    .replace(/<[^<>]*>/g, ' ')
    .replace(/[<>]/g, '')
    .replace(/```[a-z0-9_-]*/gi, ' ')
    .replace(/"""/g, ' ')
    .replace(/###+/g, ' ')
    .replace(/\b(?:system|assistant|user)\s*:/gi, ' ')
    .replace(
      /\b(?:ignore|disregard|forget)\s+(?:all\s+)?(?:previous|prior|above)\s+(?:instructions?|prompts?|rules?)\b/gi,
      ' '
    )
    .replace(/\s+/g, ' ')
    .trim();
}

export function sanitizeUserPrompt(rawPrompt: string): PromptSanitizationResult {
  if (typeof rawPrompt !== 'string') {
    return { sanitized: '', blocked: false };
  }
  const normalized = stripZeroWidthAndControls(rawPrompt);
  if (containsBlockedPattern(normalized)) {
    return { sanitized: '', blocked: true };
  }
  const stripped = stripHtmlAndInjectionFraming(normalized);
  if (containsBlockedPattern(stripped)) {
    return { sanitized: '', blocked: true };
  }
  const truncated = stripped.slice(0, MAX_USER_PROMPT_LENGTH).trim();
  if (containsBlockedPattern(truncated)) {
    return { sanitized: '', blocked: true };
  }
  return { sanitized: truncated, blocked: false };
}

// ---------------------------------------------------------------------------
// Resolution Tiers, Aspect Ratios & Prompt Builders
// ---------------------------------------------------------------------------

export function getNanoBananaModelMeta(
  model: NanoBananaModelId | string | undefined | null
): NanoBananaModelMeta {
  if (typeof model === 'string' && Object.prototype.hasOwnProperty.call(NANO_BANANA_MODEL_MAP, model)) {
    return NANO_BANANA_MODEL_MAP[model as NanoBananaModelId];
  }
  return NANO_BANANA_MODEL_MAP[DEFAULT_NANO_BANANA_MODEL];
}

export function resolveSupportedModelResolution(
  model: NanoBananaModelId,
  requested?: NanoBananaResolution
): NanoBananaResolution {
  const meta = getNanoBananaModelMeta(model);
  if (requested && meta.supportedResolutions.includes(requested)) {
    return requested;
  }
  return meta.defaultResolution;
}

function findNearestAspectCandidate(width: number, height: number): AspectRatioCandidate {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return SUPPORTED_ASPECT_RATIOS[0];
  }
  const logTarget = Math.log(width) - Math.log(height);
  let best = SUPPORTED_ASPECT_RATIOS[0];
  let bestDelta = Infinity;
  for (const candidate of SUPPORTED_ASPECT_RATIOS) {
    const delta = Math.abs(logTarget - Math.log(candidate.ratio));
    if (delta < bestDelta) {
      bestDelta = delta;
      best = candidate;
    }
  }
  return best;
}

export function resolveNearestGeminiAspectRatio(width: number, height: number): string {
  return findNearestAspectCandidate(width, height).label;
}

export function resolveNearestPuterRatio(width: number, height: number): PuterAspectRatio {
  const { w, h } = findNearestAspectCandidate(width, height);
  return { w, h };
}

function formatPaletteHint(hexList?: string[]): string {
  if (!Array.isArray(hexList) || hexList.length === 0) return '';
  const valid = hexList
    .map((h) => (typeof h === 'string' ? h.trim().toUpperCase() : ''))
    .filter((h) => HEX_COLOR_RE.test(h));
  const unique = Array.from(new Set(valid)).slice(0, 8);
  return unique.length > 0 ? `Harmonize with nearby palette colors (${unique.join(', ')}).` : '';
}

export function buildNanoBananaInfillPrompt(options: InfillPromptOptions): string {
  const { sanitized, blocked } = sanitizeUserPrompt(options.userPrompt ?? '');
  if (blocked) {
    throw new NanoBananaError(
      'SAFETY_BLOCKED',
      'Prompt contains restricted content. Please try a family-friendly description.',
      false
    );
  }
  const depthNote =
    typeof options.depth === 'number' && Number.isFinite(options.depth) && options.depth > 1
      ? ` This is zoom depth ${Math.round(options.depth)}, so depict finer miniature details that naturally belong inside the scene.`
      : '';
  const paletteNote = formatPaletteHint(options.neighborPaletteHex);
  const subjectInstruction = sanitized
    ? `Paint "${sanitized}" strictly inside the bright magenta (#FF00FF) highlighted region.`
    : 'Invent rich, cohesive micro-details that naturally belong strictly inside the bright magenta (#FF00FF) highlighted region.';

  return [
    'Edit this illustration for a color-by-number puzzle.',
    subjectInstruction,
    'Replace every bright magenta (#FF00FF) pixel and outline with clean, crisp, clearly bounded color shapes and matching illustration linework that seamlessly connect to the surrounding artwork.',
    'Do NOT alter, shift, crop, or re-style any pixel outside the magenta (#FF00FF) region. Leave no magenta (#FF00FF) guide pixels remaining.',
    'Keep shapes clean, bold, and uncluttered without text, watermarks, or tiny noisy speckles so the result segments cleanly into paintable regions.',
    paletteNote,
    depthNote.trim(),
  ]
    .filter(Boolean)
    .join(' ');
}

export function buildNanoBananaOutpaintPrompt(options: OutpaintPromptOptions): string {
  const { sanitized, blocked } = sanitizeUserPrompt(options.userPrompt ?? '');
  if (blocked) {
    throw new NanoBananaError(
      'SAFETY_BLOCKED',
      'Prompt contains restricted content. Please try a family-friendly description.',
      false
    );
  }
  const activeSides: string[] = [];
  if (options.sides.top) activeSides.push('top');
  if (options.sides.bottom) activeSides.push('bottom');
  if (options.sides.left) activeSides.push('left');
  if (options.sides.right) activeSides.push('right');
  const sidesDesc = activeSides.length > 0 ? activeSides.join(', ') : 'outer';
  const paletteNote = formatPaletteHint(options.existingPaletteHex);
  const subjectInstruction = sanitized
    ? `Continue the scene outward into the ${sidesDesc} bright magenta (#FF00FF) checkered margin(s) by adding "${sanitized}".`
    : `Naturally extend the scene outward into the ${sidesDesc} bright magenta (#FF00FF) checkered margin(s), continuing objects, background, lighting, and perspective cleanly across the boundary.`;

  return [
    'Outpaint this illustration for a color-by-number puzzle.',
    subjectInstruction,
    'Keep the entire original inner artwork 100% intact, uncropped, and unshifted in exact alignment.',
    'Replace all bright magenta (#FF00FF) and checkered margin pixels completely with matching illustration style, clean contours, and crisp paintable color regions, with no text, frames, borders, or watermarks.',
    paletteNote,
  ]
    .filter(Boolean)
    .join(' ');
}
