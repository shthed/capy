import type {
  InfiniteZoomModelId,
  NanoBananaResolution,
  OpenAiImageModelId,
  OpenRouterImageModelId,
  XaiImageModelId,
} from '../../types';
import {
  loadOpenAiByokApiKey,
  loadOpenRouterByokApiKey,
  loadXaiByokApiKey,
} from '../storage/SettingsStorage';
import {
  bytesToDataUrl,
  createAbortRace,
  decodeBase64Strict,
  DEFAULT_NANO_BANANA_TIMEOUT_MS,
  detectRasterMimeFromMagicBytes,
  MAX_RECEIVED_IMAGE_BYTES,
  NanoBananaError,
  type NanoBananaGenerateParams,
  type NanoBananaGenerationResult,
  resolveNearestGeminiAspectRatio,
  resolveTemplatePayload,
} from './NanoBananaService';
import { CAPY_OPENROUTER_REFERER, CAPY_OPENROUTER_TITLE } from './openRouterAuth';

export const OPENROUTER_IMAGES_ENDPOINT = 'https://openrouter.ai/api/v1/images';
export const OPENAI_IMAGES_EDITS_ENDPOINT = 'https://api.openai.com/v1/images/edits';
export const OPENAI_API_KEYS_URL = 'https://platform.openai.com/api-keys';
export const XAI_IMAGES_EDITS_ENDPOINT = 'https://api.x.ai/v1/images/edits';
export const XAI_CONSOLE_KEYS_URL = 'https://console.x.ai/';

export interface OpenRouterImageModelMeta {
  id: OpenRouterImageModelId;
  label: string;
  shortLabel: string;
  supportedResolutions: readonly NanoBananaResolution[];
  defaultResolution: NanoBananaResolution;
}

export interface OpenAiImageModelMeta {
  id: OpenAiImageModelId;
  label: string;
  shortLabel: string;
}

export interface XaiImageModelMeta {
  id: XaiImageModelId;
  label: string;
  shortLabel: string;
}

export const DEFAULT_OPENROUTER_MODEL: OpenRouterImageModelId = 'google/gemini-3.1-flash-image';
export const DEFAULT_OPENAI_IMAGE_MODEL: OpenAiImageModelId = 'gpt-image-2.6-sunburst';
export const DEFAULT_XAI_IMAGE_MODEL: XaiImageModelId = 'grok-imagine-image-2.0';

export const OPENROUTER_IMAGE_MODELS: readonly OpenRouterImageModelMeta[] = [
  {
    id: 'google/gemini-3.1-flash-image',
    label: 'Nano Banana 2 (Google)',
    shortLabel: 'Nano Banana 2',
    supportedResolutions: ['512', '1K', '2K'],
    defaultResolution: '1K',
  },
  {
    id: 'google/gemini-3.1-flash-lite-image',
    label: 'Nano Banana 2 Lite (Fast)',
    shortLabel: 'Nano Banana 2 Lite',
    supportedResolutions: ['1K'],
    defaultResolution: '1K',
  },
  {
    id: 'openai/gpt-image-2.6-sunburst',
    label: 'ChatGPT GPT Image 2.6 Sunburst',
    shortLabel: 'GPT Image 2.6',
    supportedResolutions: ['1K', '2K'],
    defaultResolution: '1K',
  },
  {
    id: 'openai/gpt-image-2.6-flare',
    label: 'ChatGPT GPT Image 2.6 Flare (Fast)',
    shortLabel: 'GPT Image 2.6 Flare',
    supportedResolutions: ['1K', '2K'],
    defaultResolution: '1K',
  },
  {
    id: 'x-ai/grok-imagine-image-2.0',
    label: 'Grok Imagine 2.0 (xAI)',
    shortLabel: 'Grok Imagine 2.0',
    supportedResolutions: ['1K', '2K'],
    defaultResolution: '1K',
  },
  {
    id: 'bytedance-seed/seedream-4.5',
    label: 'Seedream 4.5 (ByteDance)',
    shortLabel: 'Seedream 4.5',
    supportedResolutions: ['1K', '2K'],
    defaultResolution: '1K',
  },
  {
    id: 'black-forest-labs/flux.2-pro',
    label: 'Flux 2 Pro (BFL)',
    shortLabel: 'Flux 2 Pro',
    supportedResolutions: ['1K', '2K'],
    defaultResolution: '1K',
  },
];

export const OPENAI_IMAGE_MODELS: readonly OpenAiImageModelMeta[] = [
  {
    id: 'gpt-image-2.6-sunburst',
    label: 'GPT Image 2.6 Sunburst (Recommended)',
    shortLabel: 'GPT Image 2.6',
  },
  {
    id: 'gpt-image-2.6-flare',
    label: 'GPT Image 2.6 Flare (Fast)',
    shortLabel: 'GPT Image 2.6 Flare',
  },
  {
    id: 'gpt-image-1.5',
    label: 'GPT Image 1.5',
    shortLabel: 'GPT Image 1.5',
  },
  {
    id: 'gpt-image-1',
    label: 'GPT Image 1',
    shortLabel: 'GPT Image 1',
  },
];

export const XAI_IMAGE_MODELS: readonly XaiImageModelMeta[] = [
  {
    id: 'grok-imagine-image-2.0',
    label: 'Grok Imagine 2.0 (Recommended)',
    shortLabel: 'Grok Imagine 2.0',
  },
  {
    id: 'grok-imagine-image',
    label: 'Grok Imagine (Standard)',
    shortLabel: 'Grok Imagine',
  },
];

const OPENROUTER_MODEL_MAP: ReadonlyMap<string, OpenRouterImageModelMeta> = new Map(
  OPENROUTER_IMAGE_MODELS.map((m) => [m.id, m])
);
const OPENAI_MODEL_MAP: ReadonlyMap<string, OpenAiImageModelMeta> = new Map(
  OPENAI_IMAGE_MODELS.map((m) => [m.id, m])
);
const XAI_MODEL_MAP: ReadonlyMap<string, XaiImageModelMeta> = new Map(
  XAI_IMAGE_MODELS.map((m) => [m.id, m])
);

export function getOpenRouterModelMeta(model?: string | null): OpenRouterImageModelMeta {
  return (model && OPENROUTER_MODEL_MAP.get(model)) || OPENROUTER_IMAGE_MODELS[0];
}

export function resolveSupportedOpenRouterResolution(
  model?: string | null,
  requested?: NanoBananaResolution | null
): NanoBananaResolution {
  const meta = getOpenRouterModelMeta(model);
  if (requested && meta.supportedResolutions.includes(requested)) {
    return requested;
  }
  return meta.defaultResolution;
}

export function getOpenAiImageModelMeta(model?: string | null): OpenAiImageModelMeta {
  return (model && OPENAI_MODEL_MAP.get(model)) || OPENAI_IMAGE_MODELS[0];
}

export function getXaiImageModelMeta(model?: string | null): XaiImageModelMeta {
  return (model && XAI_MODEL_MAP.get(model)) || XAI_IMAGE_MODELS[0];
}

export type OpenAiEditSize = '1024x1024' | '1536x1024' | '1024x1536';
export type OpenAiEditQuality = 'medium' | 'auto' | 'high';

export function resolveNearestOpenAiEditSize(width: number, height: number): OpenAiEditSize {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return '1024x1024';
  }
  const ratio = width / height;
  if (ratio >= 1.2) return '1536x1024';
  if (ratio <= 0.83) return '1024x1536';
  return '1024x1024';
}

export function resolveOpenAiEditQuality(resolution?: NanoBananaResolution): OpenAiEditQuality {
  if (resolution === '2K') return 'high';
  if (resolution === '512') return 'medium';
  return 'auto';
}

const XAI_ASPECT_RATIOS: ReadonlyArray<{ label: string; value: number }> = [
  { label: '1:1', value: 1 },
  { label: '4:3', value: 4 / 3 },
  { label: '3:4', value: 3 / 4 },
  { label: '3:2', value: 3 / 2 },
  { label: '2:3', value: 2 / 3 },
  { label: '16:9', value: 16 / 9 },
  { label: '9:16', value: 9 / 16 },
  { label: '2:1', value: 2 },
  { label: '1:2', value: 0.5 },
  { label: '20:9', value: 20 / 9 },
  { label: '9:20', value: 9 / 20 },
];

export function resolveNearestXaiAspectRatio(width: number, height: number): string {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return '1:1';
  }
  const target = Math.log(width / height);
  let best = XAI_ASPECT_RATIOS[0];
  let bestDiff = Infinity;
  for (const candidate of XAI_ASPECT_RATIOS) {
    const diff = Math.abs(Math.log(candidate.value) - target);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = candidate;
    }
  }
  return best.label;
}

// ---------------------------------------------------------------------------
// Shared JSON HTTP / Error / Image-Decode Helpers
// ---------------------------------------------------------------------------

interface ImageApiJsonPayload {
  data?: Array<{
    b64_json?: string;
    url?: string;
    media_type?: string;
  }>;
  error?:
    | string
    | {
        message?: string;
        code?: string | number;
        type?: string;
      };
  message?: string;
}

function extractApiErrorText(payload: ImageApiJsonPayload | null): string {
  if (!payload) return '';
  if (typeof payload.error === 'string') return payload.error;
  if (payload.error && typeof payload.error === 'object') {
    return [payload.error.message, payload.error.code, payload.error.type]
      .filter((part) => part !== undefined && part !== null && String(part).trim().length > 0)
      .join(' ');
  }
  return typeof payload.message === 'string' ? payload.message : '';
}

function classifyMultiProviderHttpError(
  providerLabel: string,
  status: number,
  payload: ImageApiJsonPayload | null
): NanoBananaError {
  const errText = extractApiErrorText(payload).toLowerCase();
  if (
    errText.includes('safety') ||
    errText.includes('moderation_blocked') ||
    errText.includes('content_policy') ||
    errText.includes('prohibited')
  ) {
    return new NanoBananaError(
      'SAFETY_BLOCKED',
      `${providerLabel} safety filter blocked this prompt or artwork. Try a softer prompt.`,
      false
    );
  }
  if (status === 401 || status === 403 || errText.includes('invalid_api_key')) {
    return new NanoBananaError(
      'INVALID_API_KEY',
      `${providerLabel} rejected your API key (HTTP ${status}). Update it in Menu > Create.`,
      true
    );
  }
  if (
    status === 402 ||
    errText.includes('insufficient_quota') ||
    errText.includes('billing') ||
    errText.includes('openrouter_credits') ||
    errText.includes('credit') ||
    errText.includes('balance')
  ) {
    return new NanoBananaError(
      'BALANCE_EXHAUSTED',
      `${providerLabel} credits or billing quota are exhausted (HTTP ${status}).`,
      true
    );
  }
  if (status === 429 || errText.includes('rate_limit')) {
    return new NanoBananaError(
      'RATE_LIMITED',
      `${providerLabel} rate limit reached (HTTP 429). Wait a moment or switch providers.`,
      true
    );
  }
  return new NanoBananaError(
    status >= 500 ? 'NETWORK_ERROR' : 'INVALID_RESPONSE',
    `${providerLabel} image request failed (HTTP ${status}).`,
    true
  );
}

async function postJsonWithTimeout(options: {
  fetchFn: typeof fetch;
  endpoint: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
  providerLabel: string;
  signal?: AbortSignal;
  timeoutMs?: number;
}): Promise<{ response: Response; json: ImageApiJsonPayload | null }> {
  const { fetchFn, endpoint, headers, body, providerLabel, signal } = options;
  if (signal?.aborted) {
    throw new NanoBananaError('ABORTED', 'Generation was cancelled.', false);
  }
  const timeoutMs = options.timeoutMs ?? DEFAULT_NANO_BANANA_TIMEOUT_MS;
  const deadlineMs = Number.isFinite(timeoutMs) && timeoutMs > 0 ? Date.now() + timeoutMs : null;

  const controller = new AbortController();
  let timedOut = false;
  const onAbort = () => controller.abort();
  signal?.addEventListener('abort', onAbort, { once: true });
  const timer =
    Number.isFinite(timeoutMs) && timeoutMs > 0
      ? setTimeout(() => {
          timedOut = true;
          controller.abort();
        }, timeoutMs)
      : null;

  let response: Response;
  try {
    response = await fetchFn(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err) {
    if (timedOut) {
      throw new NanoBananaError(
        'TIMEOUT',
        `${providerLabel} request timed out. Retry or use Free Guided Handoff.`,
        true,
        err
      );
    }
    if (signal?.aborted) {
      throw new NanoBananaError('ABORTED', 'Generation was cancelled.', false, err);
    }
    throw new NanoBananaError(
      'NETWORK_ERROR',
      `Could not reach ${providerLabel}. Check your connection or try Free Guided Handoff.`,
      true,
      err
    );
  } finally {
    if (timer !== null) clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }

  let json: ImageApiJsonPayload | null = null;
  try {
    const remainingMs = deadlineMs !== null ? Math.max(1, deadlineMs - Date.now()) : 0;
    json = (await createAbortRace(response.json(), signal, remainingMs)) as ImageApiJsonPayload;
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
  return { response, json };
}

function decodeB64ImageArrayPayload(
  json: ImageApiJsonPayload | null,
  providerLabel: string
): { blob: Blob; dataUrl: string; mimeType: string } {
  const first = Array.isArray(json?.data) ? json.data[0] : null;
  const rawB64 = typeof first?.b64_json === 'string' ? first.b64_json.trim() : '';
  if (!rawB64) {
    throw new NanoBananaError(
      'INVALID_RESPONSE',
      `${providerLabel} response did not include a base64 image payload.`,
      true
    );
  }
  const bytes = decodeBase64Strict(rawB64, 'INVALID_IMAGE', true);
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_RECEIVED_IMAGE_BYTES) {
    throw new NanoBananaError(
      'INVALID_IMAGE',
      `${providerLabel} returned an empty or oversized image payload.`,
      true
    );
  }
  const detectedMime = detectRasterMimeFromMagicBytes(bytes);
  if (!detectedMime) {
    throw new NanoBananaError(
      'INVALID_IMAGE',
      `${providerLabel} returned an unsupported image format.`,
      true
    );
  }
  const blob = new Blob([new Uint8Array(bytes)], { type: detectedMime });
  return {
    blob,
    dataUrl: bytesToDataUrl(bytes, detectedMime),
    mimeType: detectedMime,
  };
}

// ---------------------------------------------------------------------------
// Provider: OpenRouter Unified Images API (1-Click OAuth PKCE or Manual BYOK)
// ---------------------------------------------------------------------------

export interface MultiProviderClientOptions {
  fetchImpl?: typeof fetch;
  getApiKey?: () => string;
}

export interface MultiProviderGenerateParams extends Omit<NanoBananaGenerateParams, 'model'> {
  model?: InfiniteZoomModelId;
  apiKey?: string;
}

export class OpenRouterImageProvider {
  private readonly fetchFn: typeof fetch;
  private readonly getApiKeyFn: () => string;

  constructor(options: MultiProviderClientOptions = {}) {
    this.fetchFn = options.fetchImpl ?? ((...args) => globalThis.fetch(...args));
    this.getApiKeyFn = options.getApiKey ?? loadOpenRouterByokApiKey;
  }

  async generate(params: MultiProviderGenerateParams): Promise<NanoBananaGenerationResult> {
    if (params.signal?.aborted) {
      throw new NanoBananaError('ABORTED', 'Generation was cancelled.', false);
    }
    const apiKey = (
      typeof params.apiKey === 'string' ? params.apiKey : this.getApiKeyFn()
    ).trim();
    if (!apiKey) {
      throw new NanoBananaError(
        'MISSING_API_KEY',
        'Connect OpenRouter or save your OpenRouter API key in Menu > Create.',
        true
      );
    }

    const modelMeta = getOpenRouterModelMeta(params.model);
    const resolution = resolveSupportedOpenRouterResolution(modelMeta.id, params.resolution);
    const aspectRatio = resolveNearestGeminiAspectRatio(params.width, params.height);
    const { base64, mimeType: templateMime } = await resolveTemplatePayload({
      ...params,
      model: undefined,
    });
    const templateDataUrl = `data:${templateMime};base64,${base64}`;

    const { response, json } = await postJsonWithTimeout({
      fetchFn: this.fetchFn,
      endpoint: OPENROUTER_IMAGES_ENDPOINT,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
        'HTTP-Referer': CAPY_OPENROUTER_REFERER,
        'X-Title': CAPY_OPENROUTER_TITLE,
      },
      body: {
        model: modelMeta.id,
        prompt: params.prompt,
        response_format: 'b64_json',
        resolution,
        aspect_ratio: aspectRatio,
        input_references: [
          {
            type: 'image_url',
            image_url: { url: templateDataUrl },
          },
        ],
      },
      providerLabel: 'OpenRouter',
      signal: params.signal,
      timeoutMs: params.timeoutMs,
    });

    if (!response.ok) {
      throw classifyMultiProviderHttpError('OpenRouter', response.status, json);
    }
    const decoded = decodeB64ImageArrayPayload(json, 'OpenRouter');
    return {
      ...decoded,
      providerUsed: 'OPENROUTER',
      modelUsed: modelMeta.id,
    };
  }
}

// ---------------------------------------------------------------------------
// Provider: Direct OpenAI / ChatGPT GPT Image Edits API (BYOK)
// ---------------------------------------------------------------------------

export class DirectOpenAiImageProvider {
  private readonly fetchFn: typeof fetch;
  private readonly getApiKeyFn: () => string;

  constructor(options: MultiProviderClientOptions = {}) {
    this.fetchFn = options.fetchImpl ?? ((...args) => globalThis.fetch(...args));
    this.getApiKeyFn = options.getApiKey ?? loadOpenAiByokApiKey;
  }

  async generate(params: MultiProviderGenerateParams): Promise<NanoBananaGenerationResult> {
    if (params.signal?.aborted) {
      throw new NanoBananaError('ABORTED', 'Generation was cancelled.', false);
    }
    const apiKey = (
      typeof params.apiKey === 'string' ? params.apiKey : this.getApiKeyFn()
    ).trim();
    if (!apiKey) {
      throw new NanoBananaError(
        'MISSING_API_KEY',
        'Add your OpenAI (ChatGPT) API key in Menu > Create.',
        true
      );
    }

    const modelMeta = getOpenAiImageModelMeta(params.model);
    const size = resolveNearestOpenAiEditSize(params.width, params.height);
    const quality = resolveOpenAiEditQuality(params.resolution);
    const { base64, mimeType: templateMime } = await resolveTemplatePayload({
      ...params,
      model: undefined,
    });
    const templateDataUrl = `data:${templateMime};base64,${base64}`;

    const { response, json } = await postJsonWithTimeout({
      fetchFn: this.fetchFn,
      endpoint: OPENAI_IMAGES_EDITS_ENDPOINT,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: {
        model: modelMeta.id,
        prompt: params.prompt,
        images: [{ image_url: templateDataUrl }],
        size,
        quality,
      },
      providerLabel: 'OpenAI (ChatGPT)',
      signal: params.signal,
      timeoutMs: params.timeoutMs,
    });

    if (!response.ok) {
      throw classifyMultiProviderHttpError('OpenAI (ChatGPT)', response.status, json);
    }
    const decoded = decodeB64ImageArrayPayload(json, 'OpenAI (ChatGPT)');
    return {
      ...decoded,
      providerUsed: 'OPENAI_BYOK',
      modelUsed: modelMeta.id,
    };
  }
}

// ---------------------------------------------------------------------------
// Provider: Direct xAI / Grok Imagine Image Edits API (BYOK)
// ---------------------------------------------------------------------------

export class DirectXaiGrokImageProvider {
  private readonly fetchFn: typeof fetch;
  private readonly getApiKeyFn: () => string;

  constructor(options: MultiProviderClientOptions = {}) {
    this.fetchFn = options.fetchImpl ?? ((...args) => globalThis.fetch(...args));
    this.getApiKeyFn = options.getApiKey ?? loadXaiByokApiKey;
  }

  async generate(params: MultiProviderGenerateParams): Promise<NanoBananaGenerationResult> {
    if (params.signal?.aborted) {
      throw new NanoBananaError('ABORTED', 'Generation was cancelled.', false);
    }
    const apiKey = (
      typeof params.apiKey === 'string' ? params.apiKey : this.getApiKeyFn()
    ).trim();
    if (!apiKey) {
      throw new NanoBananaError(
        'MISSING_API_KEY',
        'Add your xAI (Grok) API key in Menu > Create.',
        true
      );
    }

    const modelMeta = getXaiImageModelMeta(params.model);
    const aspectRatio = resolveNearestXaiAspectRatio(params.width, params.height);
    const { base64, mimeType: templateMime } = await resolveTemplatePayload({
      ...params,
      model: undefined,
    });
    const templateDataUrl = `data:${templateMime};base64,${base64}`;

    const { response, json } = await postJsonWithTimeout({
      fetchFn: this.fetchFn,
      endpoint: XAI_IMAGES_EDITS_ENDPOINT,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: {
        model: modelMeta.id,
        prompt: params.prompt,
        image: {
          url: templateDataUrl,
          type: 'image_url',
        },
        response_format: 'b64_json',
        aspect_ratio: aspectRatio,
      },
      providerLabel: 'xAI (Grok)',
      signal: params.signal,
      timeoutMs: params.timeoutMs,
    });

    if (!response.ok) {
      throw classifyMultiProviderHttpError('xAI (Grok)', response.status, json);
    }
    const decoded = decodeB64ImageArrayPayload(json, 'xAI (Grok)');
    return {
      ...decoded,
      providerUsed: 'XAI_BYOK',
      modelUsed: modelMeta.id,
    };
  }
}
