import type {
  BorderExtensionSides,
  InfiniteZoomDirection,
  InfiniteZoomProviderMode,
  NanoBananaModelId,
  NanoBananaResolution,
} from '../../types';
import { base64ToUint8, uint8ToBase64 } from '../../utils/base64';
import { BLOCKED_PROMPT_PATTERNS } from '../catalog/CatalogIdeasService';
import { NativeBridge } from '../NativeBridge';
import { loadGeminiByokApiKey } from '../storage/SettingsStorage';
import { reportSwallowed } from '../telemetry';

export const MAX_USER_PROMPT_LENGTH = 200;
export const DEFAULT_NANO_BANANA_MODEL: NanoBananaModelId = 'gemini-nano-banana-2.1';
export const DEFAULT_NANO_BANANA_RESOLUTION: NanoBananaResolution = '1K';
export const PUTER_SDK_SCRIPT_URL = 'https://js.puter.com/v2/';
export const GEMINI_API_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/models';
export const GEMINI_APP_URL = 'https://gemini.google.com/';
export const GOOGLE_AI_STUDIO_KEY_URL = 'https://aistudio.google.com/apikey';
export const MAX_RECEIVED_IMAGE_BYTES = 16 * 1024 * 1024;
export const DEFAULT_NANO_BANANA_TIMEOUT_MS = 60_000;
export const DEFAULT_PUTER_LOAD_TIMEOUT_MS = 20_000;

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
    description: 'Balanced detail, crisp contours, and reliable style continuity at 1K.',
    supportedResolutions: ['512', '1K', '2K'],
    defaultResolution: '1K',
  },
  {
    id: 'gemini-3.1-flash-lite-image',
    label: 'Nano Banana 2 Lite',
    shortLabel: '2 Lite',
    description: 'Fastest lightweight image generation for quick zoom iterations.',
    supportedResolutions: ['512', '1K', '2K'],
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

export interface NanoBananaGenerateParams {
  prompt: string;
  templatePngBlob?: Blob;
  templateBase64?: string;
  templateDataUrl?: string;
  width: number;
  height: number;
  model?: NanoBananaModelId;
  resolution?: NanoBananaResolution;
  signal?: AbortSignal;
  timeoutMs?: number;
}

export interface NanoBananaGenerationResult {
  blob: Blob;
  dataUrl: string;
  mimeType: string;
  providerUsed: InfiniteZoomProviderMode;
  modelUsed: NanoBananaModelId;
}

export interface PuterTxt2ImgOptions {
  model: NanoBananaModelId;
  input_image: string;
  input_image_mime_type: string;
  ratio?: string;
}

export interface PuterAiLike {
  txt2img: (prompt: string, options: PuterTxt2ImgOptions) => Promise<unknown>;
}

export interface PuterGlobalLike {
  ai?: PuterAiLike;
}

export interface PuterProviderOptions {
  loadSdk?: (signal?: AbortSignal) => Promise<PuterGlobalLike>;
  getPuter?: () => PuterGlobalLike | null | undefined;
  isAndroid?: () => boolean;
  scriptLoadTimeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export interface DirectGeminiByokProviderOptions {
  fetchImpl?: typeof fetch;
  getApiKey?: () => string;
}

export interface GuidedGeminiHandoffInput {
  templatePngBlob: Blob;
  templateDataUrl: string;
  prompt: string;
  direction: InfiniteZoomDirection;
}

export interface GuidedGeminiHandoffPackage {
  prompt: string;
  templatePngBlob: Blob;
  templateDataUrl: string;
  direction: InfiniteZoomDirection;
  geminiUrl: string;
}

export interface DecodedGeminiImage {
  rgba: Uint8ClampedArray;
  width: number;
  height: number;
  blob: Blob;
  mimeType: string;
}

export type ImageRgbaDecoder = (
  blob: Blob,
  bytes: Uint8Array,
  mimeType: string
) => Promise<{ rgba: Uint8ClampedArray; width: number; height: number }>;

const SUPPORTED_ASPECT_RATIOS: ReadonlyArray<{ label: string; ratio: number }> = [
  { label: '1:1', ratio: 1 },
  { label: '4:3', ratio: 4 / 3 },
  { label: '3:4', ratio: 3 / 4 },
  { label: '3:2', ratio: 3 / 2 },
  { label: '2:3', ratio: 2 / 3 },
  { label: '16:9', ratio: 16 / 9 },
  { label: '9:16', ratio: 9 / 16 },
  { label: '4:5', ratio: 4 / 5 },
  { label: '5:4', ratio: 5 / 4 },
  { label: '21:9', ratio: 21 / 9 },
];

const ALLOWED_RASTER_MIMES = new Set<string>([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'image/bmp',
]);

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
// Aspect Ratio & Prompt Builders
// ---------------------------------------------------------------------------

export function resolveNearestGeminiAspectRatio(width: number, height: number): string {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return '1:1';
  }
  const targetRatio = width / height;
  let bestLabel = '1:1';
  let bestDelta = Infinity;
  for (const candidate of SUPPORTED_ASPECT_RATIOS) {
    const delta = Math.abs(Math.log(targetRatio / candidate.ratio));
    if (delta < bestDelta) {
      bestDelta = delta;
      bestLabel = candidate.label;
    }
  }
  return bestLabel;
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

// ---------------------------------------------------------------------------
// Shared Binary / MIME / Magic-Byte Validation Helpers
// ---------------------------------------------------------------------------

function normalizeImageMime(rawMime: string | undefined | null): string {
  if (typeof rawMime !== 'string') return '';
  const base = rawMime.trim().toLowerCase().split(';')[0].trim();
  if (base === 'image/jpg') return 'image/jpeg';
  return base;
}

function hasBytePrefix(bytes: Uint8Array, prefix: readonly number[], offset = 0): boolean {
  if (bytes.byteLength < offset + prefix.length) return false;
  for (let i = 0; i < prefix.length; i++) {
    if (bytes[offset + i] !== prefix[i]) return false;
  }
  return true;
}

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const;
const JPEG_MAGIC = [0xff, 0xd8, 0xff] as const;
const RIFF_MAGIC = [0x52, 0x49, 0x46, 0x46] as const;
const WEBP_MAGIC = [0x57, 0x45, 0x42, 0x50] as const;
const GIF87_MAGIC = [0x47, 0x49, 0x46, 0x38, 0x37, 0x61] as const;
const GIF89_MAGIC = [0x47, 0x49, 0x46, 0x38, 0x39, 0x61] as const;
const BMP_MAGIC = [0x42, 0x4d] as const;

const MAX_RECEIVED_IMAGE_BASE64_LENGTH = Math.ceil((MAX_RECEIVED_IMAGE_BYTES * 4) / 3) + 16;

export function detectRasterMimeFromMagicBytes(bytes: Uint8Array): string | null {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength < 4) return null;
  if (hasBytePrefix(bytes, PNG_MAGIC)) return 'image/png';
  if (hasBytePrefix(bytes, JPEG_MAGIC)) return 'image/jpeg';
  if (hasBytePrefix(bytes, RIFF_MAGIC) && hasBytePrefix(bytes, WEBP_MAGIC, 8)) return 'image/webp';
  if (hasBytePrefix(bytes, GIF87_MAGIC) || hasBytePrefix(bytes, GIF89_MAGIC)) return 'image/gif';
  if (bytes.byteLength >= 14 && hasBytePrefix(bytes, BMP_MAGIC)) return 'image/bmp';
  return null;
}

function decodeBase64Strict(
  base64: string,
  errorCode: NanoBananaErrorCode,
  canFallbackToGuided: boolean
): Uint8Array {
  const compact = base64.replace(/\s+/g, '');
  if (compact.length === 0) {
    throw new NanoBananaError(errorCode, 'Received image payload is empty.', canFallbackToGuided);
  }
  if (compact.length > MAX_RECEIVED_IMAGE_BASE64_LENGTH) {
    throw new NanoBananaError(
      errorCode,
      'Received image exceeds the 16 MB safety limit.',
      canFallbackToGuided
    );
  }
  try {
    return base64ToUint8(compact);
  } catch (err) {
    throw new NanoBananaError(
      errorCode,
      'Received image contains malformed base64 data.',
      canFallbackToGuided,
      err
    );
  }
}

function extractBase64FromDataUrl(dataUrl: string): { mimeType: string; base64: string } | null {
  const trimmed = dataUrl.trim();
  const match = /^data:([^;,]+);base64,([A-Za-z0-9+/=\s]+)$/i.exec(trimmed);
  if (!match) return null;
  const mimeType = normalizeImageMime(match[1]);
  const base64 = match[2].replace(/\s+/g, '');
  return { mimeType, base64 };
}

async function resolveTemplateBase64(params: NanoBananaGenerateParams): Promise<string> {
  if (typeof params.templateBase64 === 'string' && params.templateBase64.trim().length > 0) {
    const trimmed = params.templateBase64.trim();
    const parsed = extractBase64FromDataUrl(trimmed);
    return parsed ? parsed.base64 : trimmed;
  }
  if (typeof params.templateDataUrl === 'string' && params.templateDataUrl.trim().length > 0) {
    const parsed = extractBase64FromDataUrl(params.templateDataUrl);
    if (!parsed) {
      throw new NanoBananaError('INVALID_IMAGE', 'Invalid template image data URL.', true);
    }
    return parsed.base64;
  }
  if (params.templatePngBlob) {
    const bytes = new Uint8Array(await params.templatePngBlob.arrayBuffer());
    if (bytes.byteLength === 0) {
      throw new NanoBananaError('INVALID_IMAGE', 'Template PNG blob is empty.', true);
    }
    return uint8ToBase64(bytes);
  }
  throw new NanoBananaError('INVALID_IMAGE', 'A prepared template image is required.', true);
}

function bytesToDataUrl(bytes: Uint8Array, mimeType: string): string {
  return `data:${mimeType};base64,${uint8ToBase64(bytes)}`;
}

function createAbortRace<T>(
  promise: Promise<T>,
  signal?: AbortSignal,
  timeoutMs: number = DEFAULT_NANO_BANANA_TIMEOUT_MS
): Promise<T> {
  if (signal?.aborted) {
    promise.catch(() => {});
    return Promise.reject(new NanoBananaError('ABORTED', 'Generation was cancelled.', false));
  }
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const cleanup = () => {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      if (signal) {
        signal.removeEventListener('abort', onAbort);
      }
    };

    const onAbort = () => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new NanoBananaError('ABORTED', 'Generation was cancelled.', false));
    };

    if (signal) {
      signal.addEventListener('abort', onAbort, { once: true });
    }

    if (Number.isFinite(timeoutMs) && timeoutMs > 0) {
      timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(
          new NanoBananaError(
            'TIMEOUT',
            'Image generation timed out. You can retry or switch to Guided Gemini Handoff.',
            true
          )
        );
      }, timeoutMs);
    }

    promise.then(
      (value) => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(value);
      },
      (err) => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(err);
      }
    );
  });
}

// ---------------------------------------------------------------------------
// Provider 1: Puter.js Web-Only Nano Banana Provider ($0 Developer Cost)
// ---------------------------------------------------------------------------

let sharedPuterLoadPromise: Promise<PuterGlobalLike> | null = null;
let sharedPuterScriptEl: HTMLScriptElement | null = null;

function readGlobalPuter(): PuterGlobalLike | null {
  const g = globalThis as { puter?: PuterGlobalLike };
  if (g.puter?.ai && typeof g.puter.ai.txt2img === 'function') {
    return g.puter;
  }
  return null;
}

export function resetPuterSdkLoaderForTests(): void {
  if (sharedPuterScriptEl) {
    sharedPuterScriptEl.onload = null;
    sharedPuterScriptEl.onerror = null;
    try {
      sharedPuterScriptEl.remove();
    } catch {
      // ignore
    }
    sharedPuterScriptEl = null;
  }
  sharedPuterLoadPromise = null;
}

export async function loadPuterSdk(
  signal?: AbortSignal,
  timeoutMs: number = DEFAULT_PUTER_LOAD_TIMEOUT_MS
): Promise<PuterGlobalLike> {
  if (NativeBridge.isAndroidNative()) {
    throw new NanoBananaError(
      'PUTER_UNAVAILABLE_ANDROID',
      'Puter.js is only available on Web. On Android, use Free Guided Gemini Handoff or Direct Gemini API (BYOK).',
      true
    );
  }
  if (signal?.aborted) {
    throw new NanoBananaError('ABORTED', 'Generation was cancelled.', false);
  }
  const existing = readGlobalPuter();
  if (existing) return existing;

  let loadPromise = sharedPuterLoadPromise;
  let loadScript = sharedPuterScriptEl;

  if (!loadPromise) {
    if (typeof document === 'undefined' || !document.head) {
      throw new NanoBananaError(
        'PUTER_LOAD_FAILED',
        'Unable to load Puter.js outside a browser document.',
        true
      );
    }

    const script = document.createElement('script');
    script.src = PUTER_SDK_SCRIPT_URL;
    script.async = true;
    script.crossOrigin = 'anonymous';

    let failedEarly = false;
    let createdPromise!: Promise<PuterGlobalLike>;
    createdPromise = new Promise<PuterGlobalLike>((resolve, reject) => {
      const fail = (message: string, cause?: unknown) => {
        failedEarly = true;
        script.onload = null;
        script.onerror = null;
        if (sharedPuterScriptEl === script) {
          sharedPuterScriptEl = null;
        }
        if (sharedPuterLoadPromise === createdPromise) {
          sharedPuterLoadPromise = null;
        }
        try {
          script.remove();
        } catch {
          // ignore
        }
        reject(new NanoBananaError('PUTER_LOAD_FAILED', message, true, cause));
      };

      script.onload = () => {
        script.onload = null;
        script.onerror = null;
        const loaded = readGlobalPuter();
        if (loaded) {
          resolve(loaded);
        } else {
          fail('Puter.js loaded but puter.ai.txt2img is unavailable.');
        }
      };

      script.onerror = (ev) => {
        fail('Failed to load Puter.js SDK from https://js.puter.com/v2/.', ev);
      };

      try {
        document.head.appendChild(script);
      } catch (err) {
        fail('Failed to inject Puter.js SDK script element.', err);
      }
    });

    loadPromise = createdPromise;
    loadScript = script;
    if (!failedEarly) {
      sharedPuterScriptEl = script;
      sharedPuterLoadPromise = createdPromise;
    }
  }

  try {
    return await createAbortRace(loadPromise, signal, timeoutMs);
  } catch (err) {
    if (err instanceof NanoBananaError && err.code === 'TIMEOUT') {
      if (sharedPuterLoadPromise === loadPromise) {
        sharedPuterLoadPromise = null;
      }
      if (loadScript && sharedPuterScriptEl === loadScript) {
        loadScript.onload = null;
        loadScript.onerror = null;
        sharedPuterScriptEl = null;
        try {
          loadScript.remove();
        } catch {
          // ignore
        }
      }
    }
    throw err;
  }
}

const PUTER_BALANCE_KEYWORDS = ['402', 'balance', 'insufficient', 'quota', 'funding'] as const;
const PUTER_CANCEL_KEYWORDS = ['cancel', 'closed', 'dismiss', 'denied', 'auth'] as const;
const PUTER_SAFETY_KEYWORDS = ['safety', 'policy', 'blocked', 'prohibited'] as const;

function containsAnyKeyword(text: string, keywords: readonly string[]): boolean {
  for (const kw of keywords) {
    if (text.includes(kw)) return true;
  }
  return false;
}

function classifyPuterError(err: unknown): NanoBananaError {
  if (err instanceof NanoBananaError) return err;
  const errObj = err && typeof err === 'object' ? (err as Record<string, unknown>) : null;
  const status =
    typeof errObj?.status === 'number'
      ? errObj.status
      : typeof errObj?.code === 'number'
        ? errObj.code
        : undefined;
  const msg =
    err instanceof Error
      ? err.message
      : typeof errObj?.message === 'string'
        ? errObj.message
        : String(err ?? 'Puter generation failed');
  const lower = msg.toLowerCase();

  if (err instanceof Error && err.name === 'AbortError') {
    return new NanoBananaError('ABORTED', 'Generation was cancelled.', false, err);
  }
  if (status === 402 || containsAnyKeyword(lower, PUTER_BALANCE_KEYWORDS)) {
    return new NanoBananaError(
      'PUTER_BALANCE_EXHAUSTED',
      'Your Puter usage balance is exhausted. Switch to Free Guided Gemini Handoff or Direct Gemini API (BYOK).',
      true,
      err
    );
  }
  if (containsAnyKeyword(lower, PUTER_SAFETY_KEYWORDS)) {
    return new NanoBananaError(
      'SAFETY_BLOCKED',
      'Nano Banana declined this prompt due to safety filters. Try rewording your prompt.',
      false,
      err
    );
  }
  if (containsAnyKeyword(lower, PUTER_CANCEL_KEYWORDS)) {
    return new NanoBananaError(
      'PUTER_CANCELLED',
      'Puter sign-in or generation popup was cancelled.',
      true,
      err
    );
  }
  return new NanoBananaError('NETWORK_ERROR', `Puter Nano Banana request failed: ${msg}`, true, err);
}

function validateAndWrapPuterImageBytes(
  bytes: Uint8Array,
  invalidMessage: string
): { blob: Blob; dataUrl: string; mimeType: string } {
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_RECEIVED_IMAGE_BYTES) {
    throw new NanoBananaError(
      'INVALID_RESPONSE',
      'Puter returned an empty or oversized image payload.',
      true
    );
  }
  const detected = detectRasterMimeFromMagicBytes(bytes);
  if (!detected || !ALLOWED_RASTER_MIMES.has(detected)) {
    throw new NanoBananaError('INVALID_RESPONSE', invalidMessage, true);
  }
  const blob = new Blob([new Uint8Array(bytes)], { type: detected });
  return { blob, dataUrl: bytesToDataUrl(bytes, detected), mimeType: detected };
}

function extractPuterOutputSource(rawResult: unknown): string | null {
  if (typeof rawResult === 'string') {
    return rawResult;
  }
  if (rawResult && typeof rawResult === 'object') {
    const candidate = rawResult as { src?: unknown; url?: unknown };
    if (typeof candidate.src === 'string' && candidate.src.length > 0) {
      return candidate.src;
    }
    if (typeof candidate.url === 'string' && candidate.url.length > 0) {
      return candidate.url;
    }
  }
  return null;
}

async function resolvePuterOutputToBlobAndDataUrl(
  rawResult: unknown,
  fetchImpl: typeof fetch,
  signal?: AbortSignal
): Promise<{ blob: Blob; dataUrl: string; mimeType: string }> {
  if (typeof Blob !== 'undefined' && rawResult instanceof Blob) {
    if (rawResult.size <= 0 || rawResult.size > MAX_RECEIVED_IMAGE_BYTES) {
      throw new NanoBananaError(
        'INVALID_RESPONSE',
        'Puter returned an empty or oversized image blob.',
        true
      );
    }
    const declaredMime = normalizeImageMime(rawResult.type);
    if (declaredMime && !ALLOWED_RASTER_MIMES.has(declaredMime)) {
      throw new NanoBananaError('INVALID_RESPONSE', 'Puter returned an unsupported image blob.', true);
    }
    const bytes = new Uint8Array(await rawResult.arrayBuffer());
    return validateAndWrapPuterImageBytes(bytes, 'Puter returned an invalid image blob.');
  }

  const src = extractPuterOutputSource(rawResult);
  if (!src) {
    throw new NanoBananaError(
      'INVALID_RESPONSE',
      'Puter returned an unexpected empty image response.',
      true
    );
  }

  const parsedDataUrl = extractBase64FromDataUrl(src);
  if (parsedDataUrl) {
    if (parsedDataUrl.mimeType && !ALLOWED_RASTER_MIMES.has(parsedDataUrl.mimeType)) {
      throw new NanoBananaError(
        'INVALID_RESPONSE',
        'Puter returned an unsupported image data URL.',
        true
      );
    }
    const bytes = decodeBase64Strict(parsedDataUrl.base64, 'INVALID_RESPONSE', true);
    return validateAndWrapPuterImageBytes(bytes, 'Puter returned an unsupported image data URL.');
  }

  if (/^(?:https:|blob:)/i.test(src)) {
    const res = await fetchImpl(src, signal ? { signal } : undefined);
    if (!res.ok) {
      throw new NanoBananaError(
        'NETWORK_ERROR',
        `Failed to fetch Puter generated image (HTTP ${res.status}).`,
        true
      );
    }
    const contentLengthHeader = res.headers?.get?.('content-length');
    if (contentLengthHeader) {
      const contentLength = Number(contentLengthHeader);
      if (Number.isFinite(contentLength) && contentLength > MAX_RECEIVED_IMAGE_BYTES) {
        throw new NanoBananaError(
          'INVALID_RESPONSE',
          'Puter generated image exceeds the 16 MB safety limit.',
          true
        );
      }
    }
    const bytes = new Uint8Array(await res.arrayBuffer());
    return validateAndWrapPuterImageBytes(
      bytes,
      'Puter generated image URL did not return a valid raster image.'
    );
  }

  throw new NanoBananaError(
    'INVALID_RESPONSE',
    'Puter returned an unrecognized image format.',
    true
  );
}

export class PuterNanoBananaProvider {
  private readonly loadSdkFn: (signal?: AbortSignal) => Promise<PuterGlobalLike>;
  private readonly getPuterFn: () => PuterGlobalLike | null | undefined;
  private readonly isAndroidFn: () => boolean;
  private readonly fetchFn: typeof fetch;

  constructor(options: PuterProviderOptions = {}) {
    const loadTimeout = options.scriptLoadTimeoutMs ?? DEFAULT_PUTER_LOAD_TIMEOUT_MS;
    this.isAndroidFn = options.isAndroid ?? (() => NativeBridge.isAndroidNative());
    this.getPuterFn = options.getPuter ?? readGlobalPuter;
    this.loadSdkFn =
      options.loadSdk ?? ((signal?: AbortSignal) => loadPuterSdk(signal, loadTimeout));
    this.fetchFn = options.fetchImpl ?? ((...args) => globalThis.fetch(...args));
  }

  async generate(params: NanoBananaGenerateParams): Promise<NanoBananaGenerationResult> {
    if (this.isAndroidFn()) {
      throw new NanoBananaError(
        'PUTER_UNAVAILABLE_ANDROID',
        'Puter.js is only available on Web. Use Free Guided Gemini Handoff or Direct Gemini API (BYOK) on Android.',
        true
      );
    }
    if (params.signal?.aborted) {
      throw new NanoBananaError('ABORTED', 'Generation was cancelled.', false);
    }

    const model = params.model ?? DEFAULT_NANO_BANANA_MODEL;
    const ratio = resolveNearestGeminiAspectRatio(params.width, params.height);
    const templateBase64 = await resolveTemplateBase64(params);
    if (params.signal?.aborted) {
      throw new NanoBananaError('ABORTED', 'Generation was cancelled.', false);
    }

    const puter = this.getPuterFn() || (await this.loadSdkFn(params.signal));
    if (!puter?.ai || typeof puter.ai.txt2img !== 'function') {
      throw new NanoBananaError(
        'PUTER_LOAD_FAILED',
        'Puter.js AI image interface is unavailable.',
        true
      );
    }
    const puterAi = puter.ai;

    if (params.signal?.aborted) {
      throw new NanoBananaError('ABORTED', 'Generation was cancelled.', false);
    }
    const timeoutMs = params.timeoutMs ?? DEFAULT_NANO_BANANA_TIMEOUT_MS;
    const controller = new AbortController();
    let timedOut = false;
    const onExternalAbort = () => controller.abort();
    if (params.signal) {
      params.signal.addEventListener('abort', onExternalAbort, { once: true });
    }
    const timer =
      Number.isFinite(timeoutMs) && timeoutMs > 0
        ? setTimeout(() => {
            timedOut = true;
            controller.abort();
          }, timeoutMs)
        : null;

    try {
      const { blob, dataUrl, mimeType } = await createAbortRace(
        (async () => {
          const rawOutput = await puterAi.txt2img(params.prompt, {
            model,
            input_image: templateBase64,
            input_image_mime_type: 'image/png',
            ratio,
          });
          if (controller.signal.aborted) {
            throw timedOut
              ? new NanoBananaError(
                  'TIMEOUT',
                  'Image generation timed out. You can retry or switch to Guided Gemini Handoff.',
                  true
                )
              : new NanoBananaError('ABORTED', 'Generation was cancelled.', false);
          }
          return resolvePuterOutputToBlobAndDataUrl(rawOutput, this.fetchFn, controller.signal);
        })(),
        controller.signal,
        0
      );
      return {
        blob,
        dataUrl,
        mimeType,
        providerUsed: 'PUTER',
        modelUsed: model,
      };
    } catch (err) {
      if (timedOut) {
        throw new NanoBananaError(
          'TIMEOUT',
          'Image generation timed out. You can retry or switch to Guided Gemini Handoff.',
          true,
          err
        );
      }
      throw classifyPuterError(err);
    } finally {
      if (timer !== null) clearTimeout(timer);
      if (params.signal) params.signal.removeEventListener('abort', onExternalAbort);
    }
  }
}

// ---------------------------------------------------------------------------
// Provider 2: Direct Gemini API BYOK Provider (Web & Android, $0 Dev Cost)
// ---------------------------------------------------------------------------

interface GeminiInlineDataPart {
  inlineData?: { mimeType?: string; data?: string };
  inline_data?: { mime_type?: string; data?: string };
  text?: string;
}

interface GeminiGenerateContentResponse {
  candidates?: Array<{
    finishReason?: string;
    content?: {
      parts?: GeminiInlineDataPart[];
    };
  }>;
  promptFeedback?: {
    blockReason?: string;
  };
  error?: {
    code?: number;
    message?: string;
    status?: string;
  };
}

const GEMINI_SAFETY_FINISH_REASONS = new Set([
  'SAFETY',
  'IMAGE_SAFETY',
  'PROHIBITED_CONTENT',
  'BLOCKLIST',
  'RECITATION',
]);

function classifyGeminiHttpError(
  status: number,
  json: GeminiGenerateContentResponse | null
): NanoBananaError {
  const apiMsg = json?.error?.message || `HTTP ${status}`;
  const lower = apiMsg.toLowerCase();
  if (
    status === 401 ||
    status === 403 ||
    lower.includes('api_key_invalid') ||
    lower.includes('api key not valid') ||
    lower.includes('permission denied')
  ) {
    return new NanoBananaError(
      'INVALID_API_KEY',
      'Your Google AI Studio API key was rejected or lacks image generation access. Check your key in Menu > Create.',
      true
    );
  }
  if (status === 429 || lower.includes('resource_exhausted') || lower.includes('quota')) {
    return new NanoBananaError(
      'RATE_LIMITED',
      'Gemini API rate limit or quota reached. Wait a moment or use Free Guided Gemini Handoff.',
      true
    );
  }
  if (status === 400) {
    return new NanoBananaError(
      'INVALID_RESPONSE',
      `Gemini API rejected the request (${apiMsg}). Try switching model or resolution.`,
      true
    );
  }
  return new NanoBananaError('NETWORK_ERROR', `Gemini API returned an error (${apiMsg}).`, true);
}

function findInlineRasterPart(parts: GeminiInlineDataPart[]): string | null {
  for (const part of parts) {
    const rawMime = part?.inlineData?.mimeType ?? part?.inline_data?.mime_type;
    const rawData = part?.inlineData?.data ?? part?.inline_data?.data;
    if (typeof rawData === 'string' && rawData.length > 0) {
      const normalized = normalizeImageMime(rawMime);
      if (ALLOWED_RASTER_MIMES.has(normalized)) {
        return rawData;
      }
    }
  }
  return null;
}

function extractGeminiInlineImage(json: GeminiGenerateContentResponse | null): {
  bytes: Uint8Array;
  mimeType: string;
} {
  if (json?.promptFeedback?.blockReason) {
    throw new NanoBananaError(
      'SAFETY_BLOCKED',
      `Gemini blocked the request (${json.promptFeedback.blockReason}). Try a different description.`,
      false
    );
  }
  const candidate = json?.candidates?.[0];
  const finishReason = candidate?.finishReason?.toUpperCase() || '';
  if (GEMINI_SAFETY_FINISH_REASONS.has(finishReason)) {
    throw new NanoBananaError(
      'SAFETY_BLOCKED',
      'Gemini declined to generate this image due to safety filters. Try rewording your prompt.',
      false
    );
  }
  const parts = candidate?.content?.parts;
  if (!Array.isArray(parts)) {
    throw new NanoBananaError('INVALID_RESPONSE', 'Gemini API response did not include an image.', true);
  }

  const foundBase64 = findInlineRasterPart(parts);
  if (!foundBase64) {
    throw new NanoBananaError(
      'INVALID_RESPONSE',
      'Gemini API response did not contain a valid image payload.',
      true
    );
  }
  const bytes = decodeBase64Strict(foundBase64, 'INVALID_IMAGE', true);
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_RECEIVED_IMAGE_BYTES) {
    throw new NanoBananaError(
      'INVALID_IMAGE',
      'Gemini API returned an empty or oversized image payload.',
      true
    );
  }
  const detected = detectRasterMimeFromMagicBytes(bytes);
  if (!detected || !ALLOWED_RASTER_MIMES.has(detected)) {
    throw new NanoBananaError('INVALID_IMAGE', 'Gemini API returned an unsupported image encoding.', true);
  }
  return { bytes, mimeType: detected };
}

export class DirectGeminiByokProvider {
  private readonly fetchFn: typeof fetch;
  private readonly getApiKeyFn: () => string;

  constructor(options: DirectGeminiByokProviderOptions = {}) {
    this.fetchFn = options.fetchImpl ?? ((...args) => globalThis.fetch(...args));
    this.getApiKeyFn = options.getApiKey ?? loadGeminiByokApiKey;
  }

  private async postGenerateContent(
    endpoint: string,
    apiKey: string,
    requestBody: Record<string, unknown>,
    signal?: AbortSignal,
    timeoutMs: number = DEFAULT_NANO_BANANA_TIMEOUT_MS
  ): Promise<Response> {
    if (signal?.aborted) {
      throw new NanoBananaError('ABORTED', 'Generation was cancelled.', false);
    }
    const controller = new AbortController();
    let timedOut = false;
    const onExternalAbort = () => controller.abort();
    if (signal) {
      signal.addEventListener('abort', onExternalAbort, { once: true });
    }
    const timer =
      Number.isFinite(timeoutMs) && timeoutMs > 0
        ? setTimeout(() => {
            timedOut = true;
            controller.abort();
          }, timeoutMs)
        : null;
    try {
      return await this.fetchFn(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': apiKey,
        },
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      });
    } catch (err) {
      if (timedOut) {
        throw new NanoBananaError(
          'TIMEOUT',
          'Gemini API request timed out. Retry or use Free Guided Gemini Handoff.',
          true,
          err
        );
      }
      if (signal?.aborted) {
        throw new NanoBananaError('ABORTED', 'Generation was cancelled.', false, err);
      }
      throw new NanoBananaError(
        'NETWORK_ERROR',
        'Could not reach generativelanguage.googleapis.com. Check your connection or try Guided Gemini Handoff.',
        true,
        err
      );
    } finally {
      if (timer !== null) clearTimeout(timer);
      if (signal) {
        signal.removeEventListener('abort', onExternalAbort);
      }
    }
  }

  private async readResponseJsonWithAbort(
    response: Response,
    signal?: AbortSignal,
    deadlineMs: number | null = null
  ): Promise<GeminiGenerateContentResponse | null> {
    if (signal?.aborted) {
      throw new NanoBananaError('ABORTED', 'Generation was cancelled.', false);
    }
    let remainingTimeoutMs = 0;
    if (deadlineMs !== null) {
      remainingTimeoutMs = deadlineMs - Date.now();
      if (remainingTimeoutMs <= 0) {
        throw new NanoBananaError(
          'TIMEOUT',
          'Gemini API request timed out. Retry or use Free Guided Gemini Handoff.',
          true
        );
      }
    }
    let json: GeminiGenerateContentResponse | null = null;
    try {
      json = (await createAbortRace(
        response.json(),
        signal,
        remainingTimeoutMs
      )) as GeminiGenerateContentResponse;
    } catch (err) {
      if (signal?.aborted) {
        throw new NanoBananaError('ABORTED', 'Generation was cancelled.', false, err);
      }
      if (err instanceof NanoBananaError && (err.code === 'ABORTED' || err.code === 'TIMEOUT')) {
        throw err;
      }
      json = null;
    }
    if (signal?.aborted) {
      throw new NanoBananaError('ABORTED', 'Generation was cancelled.', false);
    }
    return json;
  }

  async generate(
    params: NanoBananaGenerateParams & { apiKey?: string }
  ): Promise<NanoBananaGenerationResult> {
    if (params.signal?.aborted) {
      throw new NanoBananaError('ABORTED', 'Generation was cancelled.', false);
    }
    const apiKey = (
      typeof params.apiKey === 'string' ? params.apiKey : this.getApiKeyFn()
    ).trim();
    if (!apiKey) {
      throw new NanoBananaError(
        'MISSING_API_KEY',
        'Add your Google AI Studio API key in Menu > Create (or switch to Free Guided Gemini Handoff).',
        true
      );
    }

    const model = params.model ?? DEFAULT_NANO_BANANA_MODEL;
    const resolution = params.resolution ?? DEFAULT_NANO_BANANA_RESOLUTION;
    const aspectRatio = resolveNearestGeminiAspectRatio(params.width, params.height);
    const templateBase64 = await resolveTemplateBase64(params);
    const endpoint = `${GEMINI_API_BASE_URL}/${encodeURIComponent(model)}:generateContent`;
    const requestBody = {
      contents: [
        {
          parts: [
            { text: params.prompt },
            { inlineData: { mimeType: 'image/png', data: templateBase64 } },
          ],
        },
      ],
      generationConfig: {
        responseModalities: ['IMAGE'],
        imageConfig: { aspectRatio, imageSize: resolution },
      },
    };

    const timeoutMs = params.timeoutMs ?? DEFAULT_NANO_BANANA_TIMEOUT_MS;
    const deadlineMs =
      Number.isFinite(timeoutMs) && timeoutMs > 0 ? Date.now() + timeoutMs : null;

    const response = await this.postGenerateContent(
      endpoint,
      apiKey,
      requestBody,
      params.signal,
      timeoutMs
    );
    const json = await this.readResponseJsonWithAbort(response, params.signal, deadlineMs);
    if (!response.ok) {
      throw classifyGeminiHttpError(response.status, json);
    }

    const { bytes, mimeType } = extractGeminiInlineImage(json);
    const blob = new Blob([new Uint8Array(bytes)], { type: mimeType });
    return {
      blob,
      dataUrl: bytesToDataUrl(bytes, mimeType),
      mimeType,
      providerUsed: 'GEMINI_BYOK',
      modelUsed: model,
    };
  }
}

// ---------------------------------------------------------------------------
// Provider 3: Free Guided Gemini App Handoff (Web & Android, $0 Everyone)
// ---------------------------------------------------------------------------

export function prepareGuidedGeminiHandoff(
  input: GuidedGeminiHandoffInput
): GuidedGeminiHandoffPackage {
  if (!input.templatePngBlob || input.templatePngBlob.size <= 0) {
    throw new NanoBananaError('INVALID_IMAGE', 'Prepared template image is missing.', false);
  }
  if (typeof input.templateDataUrl !== 'string' || !input.templateDataUrl.startsWith('data:image/')) {
    throw new NanoBananaError('INVALID_IMAGE', 'Prepared template data URL is invalid.', false);
  }
  return {
    prompt: input.prompt,
    templatePngBlob: input.templatePngBlob,
    templateDataUrl: input.templateDataUrl,
    direction: input.direction,
    geminiUrl: GEMINI_APP_URL,
  };
}

export async function copyPromptToClipboard(prompt: string): Promise<boolean> {
  if (typeof prompt !== 'string' || prompt.length === 0) return false;
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(prompt);
      return true;
    }
  } catch (err) {
    reportSwallowed('NanoBananaService.copyPromptClipboard', err);
  }
  try {
    if (typeof document !== 'undefined' && document.body) {
      const textarea = document.createElement('textarea');
      textarea.value = prompt;
      textarea.setAttribute('readonly', '');
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      const copied = typeof document.execCommand === 'function' && document.execCommand('copy');
      textarea.remove();
      return copied;
    }
  } catch (err) {
    reportSwallowed('NanoBananaService.copyPromptFallback', err);
  }
  return false;
}

export async function launchGeminiHandoff(
  handoff: GuidedGeminiHandoffPackage
): Promise<{ copiedPrompt: boolean; openedExternal: boolean }> {
  const copiedPrompt = await copyPromptToClipboard(handoff.prompt);

  if (NativeBridge.isAndroidNative()) {
    await NativeBridge.shareImage('Capy Infinite Zoom Template', handoff.templateDataUrl);
    return { copiedPrompt, openedExternal: true };
  }

  try {
    await NativeBridge.exportOrShareFile({
      title: 'Capy Infinite Zoom Template',
      fileName: `capy_zoom_template_${Date.now()}.png`,
      mimeType: 'image/png',
      data: handoff.templatePngBlob,
    });
  } catch (err) {
    reportSwallowed('NanoBananaService.launchGeminiHandoffDownload', err);
  }

  let openedExternal = false;
  if (typeof window !== 'undefined' && typeof window.open === 'function') {
    const opened = window.open(handoff.geminiUrl, '_blank', 'noopener,noreferrer');
    openedExternal = Boolean(opened);
  }
  return { copiedPrompt, openedExternal };
}

async function decodeBlobWithBrowserCanvas(blob: Blob): Promise<{
  rgba: Uint8ClampedArray;
  width: number;
  height: number;
}> {
  if (typeof document === 'undefined') {
    throw new NanoBananaError(
      'INVALID_IMAGE',
      'Image decoding requires a browser canvas or injected decoder.',
      false
    );
  }

  if (typeof createImageBitmap === 'function') {
    let bitmap: ImageBitmap;
    try {
      bitmap = await createImageBitmap(blob);
    } catch (err) {
      throw new NanoBananaError('INVALID_IMAGE', 'Failed to decode image.', false, err);
    }
    try {
      const width = bitmap.width;
      const height = bitmap.height;
      if (width <= 0 || height <= 0) {
        throw new NanoBananaError('INVALID_IMAGE', 'Decoded image has invalid dimensions.', false);
      }
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        throw new NanoBananaError('INVALID_IMAGE', 'Canvas 2D context unavailable.', false);
      }
      ctx.drawImage(bitmap, 0, 0);
      const imageData = ctx.getImageData(0, 0, width, height);
      return { rgba: imageData.data, width, height };
    } finally {
      bitmap.close();
    }
  }

  const objectUrl = URL.createObjectURL(blob);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new NanoBananaError('INVALID_IMAGE', 'Failed to decode image.', false));
      el.src = objectUrl;
    });
    const width = img.naturalWidth || img.width;
    const height = img.naturalHeight || img.height;
    if (width <= 0 || height <= 0) {
      throw new NanoBananaError('INVALID_IMAGE', 'Decoded image has invalid dimensions.', false);
    }
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new NanoBananaError('INVALID_IMAGE', 'Canvas 2D context unavailable.', false);
    }
    ctx.drawImage(img, 0, 0);
    const imageData = ctx.getImageData(0, 0, width, height);
    return { rgba: imageData.data, width, height };
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

export async function decodeReceivedGeminiImage(
  input: Blob | File | string,
  decodeImpl?: ImageRgbaDecoder
): Promise<DecodedGeminiImage> {
  let bytes: Uint8Array;
  let declaredMime = '';

  if (typeof input === 'string') {
    const parsed = extractBase64FromDataUrl(input);
    if (!parsed) {
      throw new NanoBananaError(
        'INVALID_IMAGE',
        'Please paste, drop, or share a valid raster image (PNG, JPEG, or WebP).',
        false
      );
    }
    declaredMime = parsed.mimeType;
    if (declaredMime === 'image/svg+xml' || !ALLOWED_RASTER_MIMES.has(declaredMime)) {
      throw new NanoBananaError(
        'INVALID_IMAGE',
        'Unsupported image type. Use PNG, JPEG, WebP, GIF, or BMP.',
        false
      );
    }
    bytes = decodeBase64Strict(parsed.base64, 'INVALID_IMAGE', false);
  } else if (typeof Blob !== 'undefined' && input instanceof Blob) {
    declaredMime = normalizeImageMime(input.type);
    if (declaredMime && !ALLOWED_RASTER_MIMES.has(declaredMime)) {
      throw new NanoBananaError(
        'INVALID_IMAGE',
        'Unsupported image type. Use PNG, JPEG, WebP, GIF, or BMP.',
        false
      );
    }
    if (input.size <= 0 || input.size > MAX_RECEIVED_IMAGE_BYTES) {
      throw new NanoBananaError(
        'INVALID_IMAGE',
        'Received image is empty or exceeds the 16 MB safety limit.',
        false
      );
    }
    bytes = new Uint8Array(await input.arrayBuffer());
  } else {
    throw new NanoBananaError('INVALID_IMAGE', 'Invalid image input.', false);
  }

  if (bytes.byteLength === 0 || bytes.byteLength > MAX_RECEIVED_IMAGE_BYTES) {
    throw new NanoBananaError(
      'INVALID_IMAGE',
      'Received image is empty or exceeds the 16 MB safety limit.',
      false
    );
  }

  const detectedMime = detectRasterMimeFromMagicBytes(bytes);
  if (!detectedMime || !ALLOWED_RASTER_MIMES.has(detectedMime)) {
    throw new NanoBananaError(
      'INVALID_IMAGE',
      'Image bytes did not match a valid PNG, JPEG, WebP, GIF, or BMP header.',
      false
    );
  }

  const blob = new Blob([new Uint8Array(bytes)], { type: detectedMime });
  const decoded = decodeImpl
    ? await decodeImpl(blob, bytes, detectedMime)
    : await decodeBlobWithBrowserCanvas(blob);

  if (
    !Number.isInteger(decoded.width) ||
    !Number.isInteger(decoded.height) ||
    decoded.width <= 0 ||
    decoded.height <= 0 ||
    decoded.rgba.length !== decoded.width * decoded.height * 4
  ) {
    throw new NanoBananaError('INVALID_IMAGE', 'Decoded image pixel buffer is invalid.', false);
  }

  return {
    rgba: decoded.rgba,
    width: decoded.width,
    height: decoded.height,
    blob,
    mimeType: detectedMime,
  };
}

export const GuidedGeminiHandoffProvider = {
  prepareGuidedGeminiHandoff,
  copyPromptToClipboard,
  launchGeminiHandoff,
  decodeReceivedGeminiImage,
};
