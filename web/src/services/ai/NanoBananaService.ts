import type {
  InfiniteZoomDirection,
  InfiniteZoomProviderMode,
  NanoBananaModelId,
  NanoBananaResolution,
} from '../../types';
import { base64ToUint8, uint8ToBase64 } from '../../utils/base64';
import { NativeBridge } from '../NativeBridge';
import { loadGeminiByokApiKey } from '../storage/SettingsStorage';
import { reportSwallowed } from '../telemetry';
import {
  DEFAULT_NANO_BANANA_MODEL,
  NanoBananaError,
  type NanoBananaErrorCode,
  type PuterAspectRatio,
  resolveNearestGeminiAspectRatio,
  resolveNearestPuterRatio,
  resolveSupportedModelResolution,
} from './nanoBananaPrompts';

export {
  buildNanoBananaInfillPrompt,
  buildNanoBananaOutpaintPrompt,
  DEFAULT_NANO_BANANA_MODEL,
  DEFAULT_NANO_BANANA_RESOLUTION,
  getNanoBananaModelMeta,
  MAX_USER_PROMPT_LENGTH,
  NANO_BANANA_MODEL_MAP,
  NANO_BANANA_MODELS,
  NanoBananaError,
  resolveNearestGeminiAspectRatio,
  resolveNearestPuterRatio,
  resolveSupportedModelResolution,
  sanitizeUserPrompt,
} from './nanoBananaPrompts';
export type {
  InfillPromptOptions,
  NanoBananaErrorCode,
  NanoBananaModelMeta,
  OutpaintPromptOptions,
  PromptSanitizationResult,
  PuterAspectRatio,
} from './nanoBananaPrompts';

export const PUTER_SDK_SCRIPT_URL = 'https://js.puter.com/v2/';
export const GEMINI_API_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/models';
export const GEMINI_APP_URL = 'https://gemini.google.com/';
export const GOOGLE_AI_STUDIO_KEY_URL = 'https://aistudio.google.com/apikey';
export const MAX_RECEIVED_IMAGE_BYTES = 16 * 1024 * 1024;
export const DEFAULT_NANO_BANANA_TIMEOUT_MS = 60_000;
export const DEFAULT_PUTER_LOAD_TIMEOUT_MS = 20_000;

export interface NanoBananaGenerateParams {
  prompt: string;
  templatePngBlob?: Blob;
  templateBase64?: string;
  templateDataUrl?: string;
  templateMimeType?: string;
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
  ratio?: PuterAspectRatio;
  quality?: NanoBananaResolution;
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
  templateMimeType?: string;
  prompt: string;
  direction: InfiniteZoomDirection;
}

export interface GuidedGeminiHandoffPackage {
  prompt: string;
  templatePngBlob: Blob;
  templateDataUrl: string;
  templateMimeType?: string;
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

const ALLOWED_RASTER_MIMES = new Set<string>([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'image/bmp',
]);

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

function normalizeAllowedRasterMime(rawMime: string | undefined | null): string | null {
  const normalized = normalizeImageMime(rawMime);
  return ALLOWED_RASTER_MIMES.has(normalized) ? normalized : null;
}

function isAsciiWhitespaceByte(b: number): boolean {
  return b === 0x20 || b === 0x09 || b === 0x0a || b === 0x0d || b === 0x0c;
}

function isSvgOrXmlPayloadBytes(bytes: Uint8Array): boolean {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength < 4) return false;
  let offset = 0;
  if (bytes.byteLength >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    offset = 3;
  }
  while (offset < bytes.byteLength && isAsciiWhitespaceByte(bytes[offset])) {
    offset += 1;
  }
  if (offset >= bytes.byteLength || bytes[offset] !== 0x3c) {
    return false;
  }
  const headLen = Math.min(bytes.byteLength - offset, 16);
  let head = '';
  for (let i = 0; i < headLen; i++) {
    head += String.fromCharCode(bytes[offset + i]);
  }
  const lower = head.toLowerCase();
  return (
    lower.startsWith('<svg') ||
    lower.startsWith('<?xml') ||
    lower.startsWith('<!doctype') ||
    lower.startsWith('<!--')
  );
}

function decodeBase64PrefixBytes(base64: string, maxChars = 512): Uint8Array | null {
  const windowStr = base64.trimStart().slice(0, maxChars * 2).replace(/\s+/g, '');
  if (windowStr.length < 4) return null;
  const slice =
    windowStr.length <= maxChars ? windowStr : windowStr.slice(0, Math.floor(maxChars / 4) * 4);
  try {
    return base64ToUint8(slice);
  } catch {
    return null;
  }
}

function isSvgOrXmlBase64Prefix(base64: string): boolean {
  const bytes = decodeBase64PrefixBytes(base64);
  return bytes !== null && isSvgOrXmlPayloadBytes(bytes);
}

function detectRasterMimeFromBase64Prefix(base64: string): string | null {
  const bytes = decodeBase64PrefixBytes(base64, 32);
  return bytes ? detectRasterMimeFromMagicBytes(bytes) : null;
}

function extensionForImageMime(mimeType: string): string {
  switch (normalizeImageMime(mimeType)) {
    case 'image/jpeg':
      return 'jpg';
    case 'image/webp':
      return 'webp';
    case 'image/gif':
      return 'gif';
    case 'image/bmp':
      return 'bmp';
    default:
      return 'png';
  }
}

function resolveHandoffTemplateMime(handoff: {
  templateMimeType?: string;
  templatePngBlob?: Blob;
  templateDataUrl?: string;
}): string {
  if (typeof handoff.templateDataUrl === 'string' && handoff.templateDataUrl.trim().length > 0) {
    const parsed = extractBase64FromDataUrl(handoff.templateDataUrl);
    if (parsed) {
      const fromUrl =
        detectRasterMimeFromBase64Prefix(parsed.base64) ||
        normalizeAllowedRasterMime(parsed.mimeType);
      if (fromUrl) return fromUrl;
    }
  }
  return (
    normalizeAllowedRasterMime(handoff.templateMimeType) ||
    normalizeAllowedRasterMime(handoff.templatePngBlob?.type) ||
    'image/png'
  );
}

function resolveTemplateFromBase64Input(
  rawBase64: string,
  explicitMime: string | null
): { base64: string; mimeType: string } {
  const trimmed = rawBase64.trim();
  const parsed = extractBase64FromDataUrl(trimmed);
  if (parsed) {
    if (!parsed.base64) {
      throw new NanoBananaError('INVALID_IMAGE', 'Invalid template image data URL.', true);
    }
    if (parsed.mimeType && !ALLOWED_RASTER_MIMES.has(parsed.mimeType)) {
      throw new NanoBananaError('INVALID_IMAGE', 'Unsupported template image type.', true);
    }
    if (isSvgOrXmlBase64Prefix(parsed.base64)) {
      throw new NanoBananaError(
        'INVALID_IMAGE',
        'Unsupported SVG or XML template image payload.',
        true
      );
    }
    const mimeType =
      detectRasterMimeFromBase64Prefix(parsed.base64) ||
      normalizeAllowedRasterMime(parsed.mimeType) ||
      explicitMime ||
      'image/png';
    return { base64: parsed.base64, mimeType };
  }
  if (isSvgOrXmlBase64Prefix(trimmed)) {
    throw new NanoBananaError(
      'INVALID_IMAGE',
      'Unsupported SVG or XML template image payload.',
      true
    );
  }
  const mimeType = detectRasterMimeFromBase64Prefix(trimmed) || explicitMime || 'image/png';
  return { base64: trimmed, mimeType };
}

function resolveTemplateFromDataUrlInput(
  rawDataUrl: string,
  explicitMime: string | null,
  blobType?: string
): { base64: string; mimeType: string } {
  const parsed = extractBase64FromDataUrl(rawDataUrl);
  if (!parsed || !parsed.base64) {
    throw new NanoBananaError('INVALID_IMAGE', 'Invalid template image data URL.', true);
  }
  if (parsed.mimeType && !ALLOWED_RASTER_MIMES.has(parsed.mimeType)) {
    throw new NanoBananaError('INVALID_IMAGE', 'Unsupported template image type.', true);
  }
  if (isSvgOrXmlBase64Prefix(parsed.base64)) {
    throw new NanoBananaError(
      'INVALID_IMAGE',
      'Unsupported SVG or XML template image payload.',
      true
    );
  }
  const mimeType =
    detectRasterMimeFromBase64Prefix(parsed.base64) ||
    normalizeAllowedRasterMime(parsed.mimeType) ||
    explicitMime ||
    normalizeAllowedRasterMime(blobType) ||
    'image/png';
  return { base64: parsed.base64, mimeType };
}

async function resolveTemplateFromBlobInput(
  blob: Blob,
  explicitMime: string | null
): Promise<{ base64: string; mimeType: string }> {
  const declared = normalizeImageMime(blob.type);
  if (declared && !ALLOWED_RASTER_MIMES.has(declared)) {
    throw new NanoBananaError('INVALID_IMAGE', 'Unsupported template image type.', true);
  }
  const bytes = new Uint8Array(await blob.arrayBuffer());
  if (bytes.byteLength === 0) {
    throw new NanoBananaError('INVALID_IMAGE', 'Template image blob is empty.', true);
  }
  if (isSvgOrXmlPayloadBytes(bytes)) {
    throw new NanoBananaError(
      'INVALID_IMAGE',
      'Unsupported SVG or XML template image payload.',
      true
    );
  }
  const mimeType =
    detectRasterMimeFromMagicBytes(bytes) ||
    explicitMime ||
    normalizeAllowedRasterMime(blob.type) ||
    'image/png';
  return { base64: uint8ToBase64(bytes), mimeType };
}

async function resolveTemplatePayload(
  params: NanoBananaGenerateParams
): Promise<{ base64: string; mimeType: string }> {
  let explicitMime: string | null = null;
  if (typeof params.templateMimeType === 'string' && params.templateMimeType.trim().length > 0) {
    explicitMime = normalizeAllowedRasterMime(params.templateMimeType);
    if (!explicitMime) {
      throw new NanoBananaError('INVALID_IMAGE', 'Unsupported template image type.', true);
    }
  }
  if (typeof params.templateBase64 === 'string' && params.templateBase64.trim().length > 0) {
    return resolveTemplateFromBase64Input(params.templateBase64, explicitMime);
  }
  if (typeof params.templateDataUrl === 'string' && params.templateDataUrl.trim().length > 0) {
    return resolveTemplateFromDataUrlInput(
      params.templateDataUrl,
      explicitMime,
      params.templatePngBlob?.type
    );
  }
  if (params.templatePngBlob) {
    return resolveTemplateFromBlobInput(params.templatePngBlob, explicitMime);
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
const PUTER_SAFETY_KEYWORDS = ['safety', 'policy', 'blocked', 'prohibited', 'moderation'] as const;

interface PuterErrorDetails {
  status?: number;
  codes: Set<string>;
  message: string;
  lower: string;
}

function containsAnyKeyword(text: string, keywords: readonly string[]): boolean {
  for (const kw of keywords) {
    if (text.includes(kw)) return true;
  }
  return false;
}

function asRecord(val: unknown): Record<string, unknown> | null {
  return val && typeof val === 'object' ? (val as Record<string, unknown>) : null;
}

function readFirstString(...candidates: unknown[]): string {
  for (const c of candidates) {
    if (typeof c === 'string' && c.trim().length > 0) return c.trim();
  }
  return '';
}

function readFirstStatus(...candidates: unknown[]): number | undefined {
  for (const c of candidates) {
    if (typeof c === 'number' && Number.isFinite(c)) return c;
    if (typeof c === 'string') {
      const trimmed = c.trim();
      if (/^\d{3}$/.test(trimmed)) return Number(trimmed);
    }
  }
  return undefined;
}

function collectPuterCodes(
  errObj: Record<string, unknown> | null,
  nested: Record<string, unknown> | null
): { codes: Set<string>; primaryCode: string } {
  const codes = new Set<string>();
  let primaryCode = '';
  const candidates = [
    errObj?.code,
    nested?.code,
    errObj?.errorCode,
    nested?.errorCode,
    errObj?.error_code,
    nested?.error_code,
  ];
  for (const raw of candidates) {
    if (typeof raw !== 'string') continue;
    const normalized = raw.trim().toLowerCase();
    if (!normalized) continue;
    if (!primaryCode) primaryCode = normalized;
    codes.add(normalized);
  }
  return { codes, primaryCode };
}

function hasCodePrefix(codes: Set<string>, prefix: string): boolean {
  for (const c of codes) {
    if (c.startsWith(prefix)) return true;
  }
  return false;
}

function hasCodeSubstring(codes: Set<string>, sub: string): boolean {
  for (const c of codes) {
    if (c.includes(sub)) return true;
  }
  return false;
}

function extractPuterErrorDetails(err: unknown): PuterErrorDetails {
  const errObj = asRecord(err);
  const nested = asRecord(errObj?.error);
  const status = readFirstStatus(errObj?.status, nested?.status, errObj?.code, nested?.code);
  const { codes, primaryCode } = collectPuterCodes(errObj, nested);
  const fallbackErrorStr = typeof errObj?.error === 'string' ? errObj.error : '';
  const message =
    (err instanceof Error && err.message.trim().length > 0 ? err.message.trim() : '') ||
    readFirstString(errObj?.message, nested?.message, fallbackErrorStr) ||
    (errObj ? primaryCode || 'Puter generation failed' : String(err ?? 'Puter generation failed'));
  return { status, codes, message, lower: message.toLowerCase() };
}

function isPuterSafetyError(details: PuterErrorDetails): boolean {
  return (
    details.codes.has('moderation_flagged') ||
    containsAnyKeyword(details.lower, PUTER_SAFETY_KEYWORDS)
  );
}

function isPuterBackendNetworkCode(details: PuterErrorDetails): boolean {
  return details.codes.has('access_denied') || hasCodePrefix(details.codes, 'upstream_');
}

function isPuterBalanceCode(details: PuterErrorDetails): boolean {
  return details.status === 402 || details.codes.has('insufficient_funds');
}

function isPuterInvalidRequestCode(details: PuterErrorDetails): boolean {
  return details.codes.has('bad_request') || details.codes.has('prompt_required');
}

function classifyPuterError(err: unknown): NanoBananaError {
  if (err instanceof NanoBananaError) return err;
  if (err instanceof Error && err.name === 'AbortError') {
    return new NanoBananaError('ABORTED', 'Generation was cancelled.', false, err);
  }
  const details = extractPuterErrorDetails(err);

  if (isPuterSafetyError(details)) {
    return new NanoBananaError(
      'SAFETY_BLOCKED',
      'Nano Banana declined this prompt due to safety filters. Try rewording your prompt.',
      false,
      err
    );
  }
  const hasStructuredNonCancelCode =
    isPuterBackendNetworkCode(details) ||
    isPuterBalanceCode(details) ||
    isPuterInvalidRequestCode(details);
  if (
    !hasStructuredNonCancelCode &&
    (hasCodeSubstring(details.codes, 'cancel') ||
      containsAnyKeyword(details.lower, PUTER_CANCEL_KEYWORDS))
  ) {
    return new NanoBananaError(
      'PUTER_CANCELLED',
      'Puter sign-in or generation popup was cancelled.',
      true,
      err
    );
  }
  if (isPuterBalanceCode(details) || containsAnyKeyword(details.lower, PUTER_BALANCE_KEYWORDS)) {
    return new NanoBananaError(
      'PUTER_BALANCE_EXHAUSTED',
      'Your Puter usage balance is exhausted. Switch to Free Guided Gemini Handoff or Direct Gemini API (BYOK).',
      true,
      err
    );
  }
  if (isPuterBackendNetworkCode(details)) {
    return new NanoBananaError(
      'NETWORK_ERROR',
      `Puter Nano Banana request failed: ${details.message}`,
      true,
      err
    );
  }
  if (isPuterInvalidRequestCode(details)) {
    return new NanoBananaError(
      'INVALID_RESPONSE',
      `Puter rejected the image request (${details.message}). Try switching model or resolution, or use Free Guided Gemini Handoff.`,
      true,
      err
    );
  }
  return new NanoBananaError(
    'NETWORK_ERROR',
    `Puter Nano Banana request failed: ${details.message}`,
    true,
    err
  );
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
    const quality = resolveSupportedModelResolution(model, params.resolution);
    const ratio = resolveNearestPuterRatio(params.width, params.height);
    const { base64: templateBase64, mimeType: templateMimeType } =
      await resolveTemplatePayload(params);
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
            input_image_mime_type: templateMimeType,
            ratio,
            quality,
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
    const resolution = resolveSupportedModelResolution(model, params.resolution);
    const aspectRatio = resolveNearestGeminiAspectRatio(params.width, params.height);
    const { base64: templateBase64, mimeType: templateMimeType } =
      await resolveTemplatePayload(params);
    const endpoint = `${GEMINI_API_BASE_URL}/${encodeURIComponent(model)}:generateContent`;
    const requestBody = {
      contents: [
        {
          parts: [
            { text: params.prompt },
            { inlineData: { mimeType: templateMimeType, data: templateBase64 } },
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
    throw new NanoBananaError('INVALID_IMAGE', 'Prepared template image is missing.', true);
  }
  const declaredBlobMime = normalizeImageMime(input.templatePngBlob.type);
  if (declaredBlobMime && !ALLOWED_RASTER_MIMES.has(declaredBlobMime)) {
    throw new NanoBananaError('INVALID_IMAGE', 'Unsupported template image type.', true);
  }
  if (typeof input.templateMimeType === 'string' && input.templateMimeType.trim().length > 0) {
    if (!normalizeAllowedRasterMime(input.templateMimeType)) {
      throw new NanoBananaError('INVALID_IMAGE', 'Unsupported template image type.', true);
    }
  }
  if (typeof input.templateDataUrl !== 'string') {
    throw new NanoBananaError('INVALID_IMAGE', 'Prepared template data URL is invalid.', true);
  }
  const parsed = extractBase64FromDataUrl(input.templateDataUrl);
  if (!parsed || !parsed.base64) {
    throw new NanoBananaError('INVALID_IMAGE', 'Prepared template data URL is invalid.', true);
  }
  if (!ALLOWED_RASTER_MIMES.has(parsed.mimeType)) {
    throw new NanoBananaError('INVALID_IMAGE', 'Unsupported template image type.', true);
  }
  if (isSvgOrXmlBase64Prefix(parsed.base64)) {
    throw new NanoBananaError(
      'INVALID_IMAGE',
      'Unsupported SVG or XML template image payload.',
      true
    );
  }
  return {
    prompt: input.prompt,
    templatePngBlob: input.templatePngBlob,
    templateDataUrl: input.templateDataUrl,
    templateMimeType: resolveHandoffTemplateMime(input),
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

async function encodeCanvasToPngBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  if (typeof canvas.toBlob === 'function') {
    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob((result) => resolve(result), 'image/png');
    });
    if (blob && blob.size > 0) {
      return blob.type === 'image/png' ? blob : new Blob([blob], { type: 'image/png' });
    }
  }
  if (typeof canvas.toDataURL === 'function') {
    const parsed = extractBase64FromDataUrl(canvas.toDataURL('image/png'));
    if (parsed && parsed.base64) {
      const bytes = base64ToUint8(parsed.base64);
      if (bytes.byteLength > 0) {
        return new Blob([new Uint8Array(bytes)], { type: 'image/png' });
      }
    }
  }
  throw new Error('Failed to encode template canvas to PNG blob');
}

async function transcodeSourceToPngCanvas(
  source: CanvasImageSource,
  width: number,
  height: number
): Promise<Blob> {
  if (width <= 0 || height <= 0) {
    throw new Error('Template image has invalid dimensions for PNG clipboard copy');
  }
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  try {
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Canvas 2D context unavailable for PNG clipboard copy');
    }
    ctx.drawImage(source, 0, 0, width, height);
    return await encodeCanvasToPngBlob(canvas);
  } finally {
    canvas.width = 0;
    canvas.height = 0;
  }
}

async function transcodeBlobOrDataUrlToPng(blob: Blob, dataUrl?: string): Promise<Blob> {
  if (blob && blob.size >= 8) {
    const header = new Uint8Array(await blob.slice(0, 8).arrayBuffer());
    if (detectRasterMimeFromMagicBytes(header) === 'image/png') {
      return new Blob([blob], { type: 'image/png' });
    }
  }
  if (typeof document === 'undefined' || typeof document.createElement !== 'function') {
    throw new Error('Canvas unavailable for PNG clipboard transcoding');
  }
  if (typeof createImageBitmap === 'function' && blob && blob.size > 0) {
    const bitmap = await createImageBitmap(blob);
    try {
      return await transcodeSourceToPngCanvas(bitmap, bitmap.width, bitmap.height);
    } finally {
      if (typeof bitmap.close === 'function') {
        bitmap.close();
      }
    }
  }
  let objectUrl: string | null = null;
  const imgSrc =
    blob && blob.size > 0 && typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function'
      ? (objectUrl = URL.createObjectURL(blob))
      : dataUrl || '';
  if (!imgSrc) {
    throw new Error('No image source available for PNG clipboard transcoding');
  }
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('Failed to load template image for PNG clipboard copy'));
      el.src = imgSrc;
    });
    const width = img.naturalWidth || img.width;
    const height = img.naturalHeight || img.height;
    return await transcodeSourceToPngCanvas(img, width, height);
  } finally {
    if (objectUrl && typeof URL !== 'undefined' && typeof URL.revokeObjectURL === 'function') {
      URL.revokeObjectURL(objectUrl);
    }
  }
}

export async function copyTemplateImageToClipboard(blob: Blob, dataUrl?: string): Promise<boolean> {
  if (
    typeof navigator === 'undefined' ||
    !navigator.clipboard ||
    typeof navigator.clipboard.write !== 'function' ||
    typeof ClipboardItem === 'undefined'
  ) {
    return false;
  }
  const hasBlob = typeof Blob !== 'undefined' && blob instanceof Blob && blob.size > 0;
  const hasDataUrl = typeof dataUrl === 'string' && dataUrl.trim().length > 0;
  if (!hasBlob && !hasDataUrl) {
    return false;
  }

  if (hasBlob && normalizeImageMime(blob.type) === 'image/png') {
    try {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      return true;
    } catch (err) {
      reportSwallowed('NanoBananaService.copyTemplateImageClipboard', err);
      return false;
    }
  }

  const pngPromise = transcodeBlobOrDataUrlToPng(blob, dataUrl);
  // Prevent unhandled rejection if ClipboardItem constructor throws synchronously.
  pngPromise.catch(() => {});

  let firstErr: unknown = null;
  try {
    const item = new ClipboardItem({ 'image/png': pngPromise });
    await navigator.clipboard.write([item]);
    return true;
  } catch (err) {
    firstErr = err;
    if ((err as { name?: string } | null)?.name === 'NotAllowedError') {
      reportSwallowed('NanoBananaService.copyTemplateImageClipboard', err);
      return false;
    }
  }

  try {
    const resolvedPng = await pngPromise;
    if (!resolvedPng || resolvedPng.size <= 0) {
      reportSwallowed(
        'NanoBananaService.copyTemplateImageClipboard',
        firstErr ?? new Error('Empty PNG blob')
      );
      return false;
    }
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': resolvedPng })]);
    return true;
  } catch (fallbackErr) {
    reportSwallowed('NanoBananaService.copyTemplateImageClipboard', fallbackErr ?? firstErr);
    return false;
  }
}

export async function launchGeminiHandoff(
  handoff: GuidedGeminiHandoffPackage
): Promise<{ copiedPrompt: boolean; openedExternal: boolean }> {
  const copiedPrompt = await copyPromptToClipboard(handoff.prompt);

  if (NativeBridge.isAndroidNative()) {
    await NativeBridge.shareImage('Capy Infinite Zoom Template', handoff.templateDataUrl);
    return { copiedPrompt, openedExternal: true };
  }

  const mimeType = resolveHandoffTemplateMime(handoff);
  const ext = extensionForImageMime(mimeType);
  try {
    await NativeBridge.exportOrShareFile({
      title: 'Capy Infinite Zoom Template',
      fileName: `capy_zoom_template_${Date.now()}.${ext}`,
      mimeType,
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
  copyTemplateImageToClipboard,
  launchGeminiHandoff,
  decodeReceivedGeminiImage,
};
