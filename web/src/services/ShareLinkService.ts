import { PuzzleSourceRef, SAMPLE_GALLERY, SampleArtwork } from '../types';
import {
  decodeProgressDeltaToken,
  encodeProgressDeltaToken,
  ProgressDeltaV2,
} from './CapyCodec';

const UNAMBIGUOUS_ROOM_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export interface ParsedShareLink {
  roomCode: string | null;
  delta: ProgressDeltaV2 | null;
  matchedSample: SampleArtwork | null;
}

export function generateCoopRoomCode(length: number = 6): string {
  let code = '';
  for (let i = 0; i < length; i++) {
    code += UNAMBIGUOUS_ROOM_ALPHABET[Math.floor(Math.random() * UNAMBIGUOUS_ROOM_ALPHABET.length)];
  }
  return code;
}

export function resolveSampleFromSourceRef(sourceRef?: PuzzleSourceRef): SampleArtwork | null {
  if (!sourceRef) return null;
  if (sourceRef.kind === 'sample' || sourceRef.kind === 'catalog') {
    const cleanUri = sourceRef.uri.replace(/^\.\//, '');
    const byPath = SAMPLE_GALLERY.find(
      (s) => s.assetPath.replace(/^\.\//, '') === cleanUri || s.id === sourceRef.uri
    );
    if (byPath) return byPath;
  }
  return null;
}

export const CANONICAL_PRODUCTION_URL = 'https://capypaint.com/';

function getCanonicalBaseUrl(): string {
  if (typeof window === 'undefined') return CANONICAL_PRODUCTION_URL;
  // On Android WebView asset loader host, generate public HTTPS App Link URL so friends can open it anywhere
  if (window.location.hostname === 'appassets.androidplatform.net') {
    return CANONICAL_PRODUCTION_URL;
  }
  const url = new URL(window.location.href);
  url.search = '';
  url.hash = '';
  return url.toString();
}

export async function buildShareProgressUrl(options: {
  sourceRef?: PuzzleSourceRef;
  filledRegionIds: number[];
  paintedRegionColors?: Record<number, number>;
  isFreeColor?: boolean;
  resetEpoch?: number;
  roomCode?: string | null;
}): Promise<{ url: string; token: string }> {
  const delta: ProgressDeltaV2 = {
    version: 2,
    ...(options.sourceRef ? { sourceRef: options.sourceRef } : {}),
    filledRegionIds: options.filledRegionIds,
    ...(options.paintedRegionColors && Object.keys(options.paintedRegionColors).length > 0
      ? { paintedRegionColors: options.paintedRegionColors }
      : {}),
    ...(options.isFreeColor ? { isFreeColor: true } : {}),
    ...(options.resetEpoch && options.resetEpoch > 0 ? { resetEpoch: options.resetEpoch } : {}),
    updatedAt: Date.now(),
  };

  const token = await encodeProgressDeltaToken(delta);
  const base = new URL(getCanonicalBaseUrl());
  if (options.roomCode) {
    base.searchParams.set('room', options.roomCode.toUpperCase());
  }
  base.hash = `s=${token}`;
  return { url: base.toString(), token };
}

export async function parseShareLinkFromUrl(rawUrl: string): Promise<ParsedShareLink> {
  try {
    const parsed = new URL(rawUrl, CANONICAL_PRODUCTION_URL);
    const roomParam = parsed.searchParams.get('room');
    const roomCode = roomParam
      ? roomParam.trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8) || null
      : null;

    let token: string | null = null;
    const rawHash = parsed.hash.startsWith('#') ? parsed.hash.slice(1) : parsed.hash;
    if (rawHash) {
      const hashParams = new URLSearchParams(rawHash);
      token = hashParams.get('s');
    }
    if (!token) {
      token = parsed.searchParams.get('s');
    }

    let delta: ProgressDeltaV2 | null = null;
    let matchedSample: SampleArtwork | null = null;
    if (token) {
      delta = await decodeProgressDeltaToken(token);
      matchedSample = resolveSampleFromSourceRef(delta.sourceRef);
    }

    return {
      roomCode,
      delta,
      matchedSample,
    };
  } catch {
    return { roomCode: null, delta: null, matchedSample: null };
  }
}

export function clearShareHashFromWindowUrl(keepRoomCode?: string | null): void {
  if (typeof window === 'undefined') return;
  try {
    const url = new URL(window.location.href);
    url.hash = '';
    url.searchParams.delete('s');
    if (keepRoomCode) {
      url.searchParams.set('room', keepRoomCode);
    } else {
      url.searchParams.delete('room');
    }
    window.history.replaceState(null, '', url.pathname + url.search + url.hash);
  } catch {
    // Ignore history errors in restricted frames
  }
}
