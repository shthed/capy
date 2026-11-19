/**
 * Shared chunk-safe binary <-> base64 conversion utilities for Web, Worker, Codec, and NativeBridge paths.
 */

const BASE64_CHUNK_SIZE = 0x2000;

export function uint8ToBase64(bytes: Uint8Array): string {
  const len = bytes.byteLength;
  if (len === 0) return '';
  let binary = '';
  for (let i = 0; i < len; i += BASE64_CHUNK_SIZE) {
    const end = Math.min(i + BASE64_CHUNK_SIZE, len);
    let chunk = '';
    for (let j = i; j < end; j++) {
      chunk += String.fromCharCode(bytes[j]);
    }
    binary += chunk;
  }
  return btoa(binary);
}

export function base64ToUint8(b64: string): Uint8Array {
  if (!b64) return new Uint8Array(0);
  const binary = atob(b64);
  const len = binary.length;
  const out = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    out[i] = binary.charCodeAt(i);
  }
  return out;
}
