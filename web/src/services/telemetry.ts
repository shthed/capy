import { isDebugEnvironmentEnabled } from '../utils/debugEnvironment';

export interface SwallowedErrorRecord {
  scope: string;
  message: string;
  ts: number;
  context?: Record<string, unknown>;
}

export const MAX_SWALLOWED_ERROR_RECORDS = 50;
const MAX_SCOPE_LENGTH = 80;
const MAX_MESSAGE_LENGTH = 240;

const swallowedErrorRing: SwallowedErrorRecord[] = [];

function sanitizeNonPiiMessage(err: unknown): string {
  let raw = 'Unknown error';
  if (err instanceof Error) {
    raw = err.message || err.name || 'Error';
  } else if (typeof err === 'string') {
    raw = err;
  } else if (err && typeof err === 'object' && 'message' in err) {
    const candidate = (err as { message?: unknown }).message;
    raw = typeof candidate === 'string' ? candidate : String(candidate ?? 'Object error');
  } else if (err !== undefined && err !== null) {
    try {
      raw = String(err);
    } catch {
      raw = 'Unserializable error';
    }
  }

  const redacted = raw
    .replace(/\s+/g, ' ')
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [redacted]')
    .replace(/\bya29\.[A-Za-z0-9_-]+/g, '[redacted-token]')
    .replace(/([?&](?:access_token|token|code|secret)=)[^&\s]+/gi, '$1[redacted]')
    .trim();

  if (!redacted) return 'Unknown error';
  return redacted.length > MAX_MESSAGE_LENGTH
    ? `${redacted.slice(0, MAX_MESSAGE_LENGTH - 3)}...`
    : redacted;
}

function sanitizeContext(
  context?: Record<string, unknown>
): Record<string, unknown> | undefined {
  if (!context || typeof context !== 'object') return undefined;
  const out: Record<string, unknown> = {};
  let count = 0;
  for (const [key, value] of Object.entries(context)) {
    if (count >= 8) break;
    const cleanKey = key.trim().slice(0, 48);
    if (!cleanKey) continue;
    if (
      value === null ||
      typeof value === 'boolean' ||
      (typeof value === 'number' && Number.isFinite(value))
    ) {
      out[cleanKey] = value;
      count++;
    } else if (typeof value === 'string') {
      const safeVal = value.replace(/\s+/g, ' ').trim();
      out[cleanKey] = safeVal.length > 160 ? `${safeVal.slice(0, 157)}...` : safeVal;
      count++;
    }
  }
  return count > 0 ? out : undefined;
}

/**
 * Records a non-fatal swallowed error inside a bounded non-PII ring buffer and emits
 * structured console diagnostics only when dev/debug mode is active.
 */
export function reportSwallowed(
  scope: string,
  err: unknown,
  context?: Record<string, unknown>
): void {
  const cleanScope =
    typeof scope === 'string' && scope.trim().length > 0
      ? scope.trim().slice(0, MAX_SCOPE_LENGTH)
      : 'unknown';
  const safeContext = sanitizeContext(context);
  const record: SwallowedErrorRecord = {
    scope: cleanScope,
    message: sanitizeNonPiiMessage(err),
    ts: Date.now(),
    ...(safeContext ? { context: safeContext } : {}),
  };

  if (swallowedErrorRing.length >= MAX_SWALLOWED_ERROR_RECORDS) {
    swallowedErrorRing.shift();
  }
  swallowedErrorRing.push(record);

  try {
    if (isDebugEnvironmentEnabled()) {
      console.warn(`[telemetry:${record.scope}] ${record.message}`, record.context ?? '');
    }
  } catch {
    // Telemetry reporting must never throw back into caller catch paths.
  }
}

export function getSwallowedErrorLog(): SwallowedErrorRecord[] {
  return swallowedErrorRing.map((entry) => ({
    ...entry,
    ...(entry.context ? { context: { ...entry.context } } : {}),
  }));
}

export function clearSwallowedErrorLog(): void {
  swallowedErrorRing.length = 0;
}
