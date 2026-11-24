import { uint8ToBase64 } from '../utils/base64';

export type HapticType = 'tick' | 'success' | 'warning' | 'error';

interface CapyAndroidInterface {
  haptic?: (type: string) => void;
  setModalOpen?: (isOpen: boolean) => void;
  saveBackup?: (key: string, data: string) => boolean;
  loadBackup?: (key: string) => string | null;
  saveCloudSnapshot?: (slotKey: string, payloadJson: string) => boolean;
  loadCloudSnapshot?: (slotKey: string) => string | null;
  saveCloudBinaryChunk?: (
    blobKey: string,
    chunkIndex: number,
    totalChunks: number,
    base64Chunk: string
  ) => boolean;
  loadCloudBinaryChunk?: (blobKey: string, chunkIndex: number) => string | null;
  requestCloudSnapshotPull?: (slotKey: string) => boolean;
  isPlayGamesConfigured?: () => boolean;
  signInPlayGames?: () => string | null;
  shareImage?: (title: string, dataUrl: string) => void;
  shareTextLink?: (title: string, url: string) => void;
  shareFile?: (title: string, fileName: string, mimeType: string, base64Data: string) => void;
  consumePendingSharedImage?: () => string | null;
  consumePendingDeepLink?: () => string | null;
  openExternalOAuth?: (authUrl: string) => boolean;
  getAppVersion?: () => string;
  getSafeAreaInsets?: () => string;
}

declare global {
  interface Window {
    CapyAndroid?: CapyAndroidInterface;
    __capyCloseModal?: () => boolean;
    __capyReceiveSharedImage?: (title: string, dataUrl: string) => void;
    __capyReceiveDeepLink?: (url: string) => void;
    __capyReceiveOAuthCallback?: (url: string) => void;
    __capyReceivePlayGamesProfile?: (
      profile: { playerId?: string; displayName?: string } | string
    ) => void;
    __capyReceivePlayGamesError?: (reason: string) => void;
    __capyReceiveCloudSnapshot?: (slotKey: string, payloadJson: string) => void;
    __capyReceiveCloudSnapshotError?: (slotKey: string, reason: string) => void;
    webkit?: {
      messageHandlers?: {
        CapyIOS?: {
          postMessage: (msg: Record<string, unknown>) => void;
        };
      };
    };
  }
}

const ALLOWED_ROOT_DEEP_LINK_HOSTS = new Set([
  'capypaint.com',
  'www.capypaint.com',
  'paint.capyboop.com',
]);
const ALLOWED_PAGES_DEEP_LINK_HOSTS = new Set(['shthed.github.io', 'capyboop.github.io']);

export function isValidAndroidDeepLink(rawUrl: string): boolean {
  if (!rawUrl || typeof rawUrl !== 'string') return false;
  const trimmed = rawUrl.trim();
  if (!trimmed || /\s/.test(trimmed) || /[\u0000-\u001F\u007F]/.test(trimmed)) {
    return false;
  }
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol.toLowerCase() !== 'https:') return false;
    if (parsed.port !== '' || parsed.username !== '' || parsed.password !== '') {
      return false;
    }
    const normalizedPath = parsed.pathname.toLowerCase();
    if (
      normalizedPath === '/privacy-policy.html' ||
      normalizedPath.endsWith('/privacy-policy.html')
    ) {
      return false;
    }
    const host = parsed.hostname.toLowerCase();
    if (ALLOWED_ROOT_DEEP_LINK_HOSTS.has(host)) {
      return true;
    }
    if (ALLOWED_PAGES_DEEP_LINK_HOSTS.has(host)) {
      if (parsed.pathname === '/capy' || parsed.pathname.startsWith('/capy/')) {
        return true;
      }
      if (
        host === 'capyboop.github.io' &&
        (parsed.pathname === '/paint' || parsed.pathname.startsWith('/paint/'))
      ) {
        return true;
      }
      return false;
    }
    return false;
  } catch {
    return false;
  }
}

export function isAllowedSharedImageDataUrl(rawUrl: string): boolean {
  if (!rawUrl || typeof rawUrl !== 'string') return false;
  const trimmed = rawUrl.trim();
  if (/[\u0000-\u001F\u007F]/.test(trimmed)) return false;
  return /^data:image\/(?:png|jpeg|jpg|webp|gif|bmp|avif|heic|heif);base64,[A-Za-z0-9+/=]+$/i.test(
    trimmed
  );
}

const ALLOWED_SHARED_IMAGE_MIMES = new Set<string>([
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/webp',
  'image/gif',
  'image/bmp',
  'image/avif',
  'image/heic',
  'image/heif',
]);

function isAllowedSharedImageMime(rawMime: string | undefined | null): boolean {
  if (typeof rawMime !== 'string') return false;
  const normalized = rawMime.split(';')[0].trim().toLowerCase();
  return ALLOWED_SHARED_IMAGE_MIMES.has(normalized);
}

async function isSvgOrXmlSharedBlob(blob: Blob): Promise<boolean> {
  if (typeof blob.slice !== 'function') return false;
  try {
    const bytes = new Uint8Array(await blob.slice(0, 64).arrayBuffer());
    let offset = 0;
    if (bytes.byteLength >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
      offset = 3;
    }
    while (
      offset < bytes.byteLength &&
      (bytes[offset] === 0x20 ||
        bytes[offset] === 0x09 ||
        bytes[offset] === 0x0a ||
        bytes[offset] === 0x0d ||
        bytes[offset] === 0x0c)
    ) {
      offset += 1;
    }
    if (offset >= bytes.byteLength || bytes[offset] !== 0x3c) return false;
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
  } catch {
    return false;
  }
}

function resolveSharedImageMimeAndExt(
  dataUrl: string,
  blobType?: string
): { mimeType: string; ext: string } {
  const dataMatch = /^data:(image\/[a-z0-9.+-]+);base64,/i.exec(dataUrl.trim());
  const rawMime = (dataMatch?.[1] || blobType || '').split(';')[0].trim().toLowerCase();
  switch (rawMime) {
    case 'image/jpeg':
    case 'image/jpg':
      return { mimeType: 'image/jpeg', ext: 'jpg' };
    case 'image/webp':
      return { mimeType: 'image/webp', ext: 'webp' };
    case 'image/gif':
      return { mimeType: 'image/gif', ext: 'gif' };
    case 'image/bmp':
      return { mimeType: 'image/bmp', ext: 'bmp' };
    case 'image/avif':
      return { mimeType: 'image/avif', ext: 'avif' };
    case 'image/heic':
      return { mimeType: 'image/heic', ext: 'heic' };
    case 'image/heif':
      return { mimeType: 'image/heif', ext: 'heif' };
    default:
      return { mimeType: 'image/png', ext: 'png' };
  }
}

export interface BridgeListenOptions {
  once?: boolean;
}

export interface CloudSnapshotListenOptions extends BridgeListenOptions {
  slotKey?: string;
  slotFilter?: (slotKey: string) => boolean;
}

export class NativeBridgeService {
  private primaryModalCloseHandler: (() => void) | null = null;
  private overlayBackStack: Array<() => void> = [];
  private sharedImageHandler: ((title: string, dataUrl: string) => void) | null = null;
  private sharedImageInterceptors: Array<{ handler: (title: string, dataUrl: string) => void }> =
    [];
  private deepLinkHandler: ((url: string) => void) | null = null;
  private playGamesProfileHandlers = new Set<
    (profile: { playerId: string; displayName: string }) => boolean | void
  >();
  private playGamesErrorHandlers = new Set<(reason: string) => boolean | void>();
  private cloudSnapshotHandlers = new Set<
    (slotKey: string, payloadJson: string) => boolean | void
  >();
  private cloudSnapshotErrorHandlers = new Set<
    (slotKey: string, reason: string) => boolean | void
  >();
  private pendingSharedImages: Array<{ title: string; dataUrl: string }> = [];
  private pendingDeepLinks: string[] = [];
  private pendingPlayGamesProfiles: Array<{ playerId: string; displayName: string }> = [];
  private pendingPlayGamesErrors: string[] = [];
  private pendingCloudSnapshots: Array<{ slotKey: string; payloadJson: string }> = [];
  private pendingCloudSnapshotErrors: Array<{ slotKey: string; reason: string }> = [];
  private abortedInFlightCloudSlots = new Set<string>();

  private static pushBounded<T>(queue: T[], item: T, maxItems = 128): void {
    if (queue.length >= maxItems) {
      queue.shift();
    }
    queue.push(item);
  }

  discardAbortedCloudPulls(slots: Iterable<string>): void {
    const slotSet = new Set<string>();
    for (const slot of slots) {
      if (typeof slot === 'string' && slot.length > 0) {
        slotSet.add(slot);
      }
    }
    if (slotSet.size === 0) return;
    this.pendingCloudSnapshots = this.pendingCloudSnapshots.filter(
      (item) => !slotSet.has(item.slotKey)
    );
    this.pendingCloudSnapshotErrors = this.pendingCloudSnapshotErrors.filter(
      (item) => !slotSet.has(item.slotKey)
    );
    for (const slot of slotSet) {
      if (this.abortedInFlightCloudSlots.size >= 256 && !this.abortedInFlightCloudSlots.has(slot)) {
        const oldest = this.abortedInFlightCloudSlots.values().next().value;
        if (oldest !== undefined) {
          this.abortedInFlightCloudSlots.delete(oldest);
        }
      }
      this.abortedInFlightCloudSlots.add(slot);
    }
  }

  clearAbortedCloudPulls(slots: Iterable<string>): void {
    for (const slot of slots) {
      if (typeof slot === 'string' && slot.length > 0) {
        this.abortedInFlightCloudSlots.delete(slot);
      }
    }
  }

  constructor() {
    this.attachWindowCallbacks();
  }

  attachWindowCallbacks(): void {
    if (typeof window !== 'undefined') {
      this.applySafeAreaInsets();

      window.__capyCloseModal = () => {
        if (this.overlayBackStack.length > 0) {
          const topHandler = this.overlayBackStack[this.overlayBackStack.length - 1];
          topHandler();
          return true;
        }
        if (this.primaryModalCloseHandler) {
          this.primaryModalCloseHandler();
          return true;
        }
        return false;
      };

      window.__capyReceiveSharedImage = (title: string, dataUrl: string) => {
        if (!isAllowedSharedImageDataUrl(dataUrl)) return;
        const resolvedTitle =
          typeof title === 'string' && title.trim().length > 0
            ? title.replace(/[\u0000-\u001F\u007F]/g, '').trim().slice(0, 80) || 'Shared Photo'
            : 'Shared Photo';
        if (this.sharedImageInterceptors.length > 0) {
          const topInterceptor =
            this.sharedImageInterceptors[this.sharedImageInterceptors.length - 1];
          topInterceptor.handler(resolvedTitle, dataUrl);
        } else if (this.sharedImageHandler) {
          this.sharedImageHandler(resolvedTitle, dataUrl);
        } else {
          NativeBridgeService.pushBounded(this.pendingSharedImages, {
            title: resolvedTitle,
            dataUrl,
          });
        }
      };

      window.__capyReceiveDeepLink = (url: string) => {
        if (!isValidAndroidDeepLink(url)) return;
        if (this.deepLinkHandler) {
          this.deepLinkHandler(url);
        } else {
          NativeBridgeService.pushBounded(this.pendingDeepLinks, url);
        }
      };

      window.__capyReceivePlayGamesProfile = (raw) => {
        try {
          const parsed =
            typeof raw === 'string'
              ? (JSON.parse(raw) as { playerId?: string; displayName?: string })
              : raw;
          if (parsed && parsed.playerId && parsed.displayName) {
            const profile = {
              playerId: parsed.playerId.trim(),
              displayName: parsed.displayName.trim(),
            };
            if (!profile.playerId || !profile.displayName) return;
            let matchedAndConsumed = false;
            if (this.playGamesProfileHandlers.size > 0) {
              for (const handler of [...this.playGamesProfileHandlers]) {
                try {
                  if (handler(profile) !== false) {
                    matchedAndConsumed = true;
                  }
                } catch {
                  // Throwing listener still consumed the delivery
                  matchedAndConsumed = true;
                }
              }
            }
            if (!matchedAndConsumed) {
              NativeBridgeService.pushBounded(this.pendingPlayGamesProfiles, profile);
            }
          }
        } catch {
          // Ignore malformed payload
        }
      };

      window.__capyReceivePlayGamesError = (reason: string) => {
        const cleanReason = (reason || 'PLAY_GAMES_UNAVAILABLE').trim();
        let matchedAndConsumed = false;
        if (this.playGamesErrorHandlers.size > 0) {
          for (const handler of [...this.playGamesErrorHandlers]) {
            try {
              if (handler(cleanReason) !== false) {
                matchedAndConsumed = true;
              }
            } catch {
              // Throwing listener still consumed the delivery
              matchedAndConsumed = true;
            }
          }
        }
        if (!matchedAndConsumed) {
          NativeBridgeService.pushBounded(this.pendingPlayGamesErrors, cleanReason);
        }
      };

      window.__capyReceiveCloudSnapshot = (slotKey: string, payloadJson: string) => {
        if (!slotKey || !payloadJson) return;
        let matchedAndConsumed = false;
        if (this.cloudSnapshotHandlers.size > 0) {
          for (const handler of [...this.cloudSnapshotHandlers]) {
            try {
              if (handler(slotKey, payloadJson) !== false) {
                matchedAndConsumed = true;
              }
            } catch {
              // Throwing listener still consumed the delivery
              matchedAndConsumed = true;
            }
          }
        }
        if (!matchedAndConsumed) {
          if (this.abortedInFlightCloudSlots.delete(slotKey)) {
            return;
          }
          NativeBridgeService.pushBounded(
            this.pendingCloudSnapshots,
            { slotKey, payloadJson },
            128
          );
        }
      };

      window.__capyReceiveCloudSnapshotError = (slotKey: string, reason: string) => {
        if (!slotKey) return;
        const cleanSlot = String(slotKey).trim();
        if (!cleanSlot) return;
        const cleanReason =
          typeof reason === 'string' && reason.trim().length > 0
            ? reason.trim()
            : 'PLAY_GAMES_SNAPSHOT_FAILED';
        let matchedAndConsumed = false;
        if (this.cloudSnapshotErrorHandlers.size > 0) {
          for (const handler of [...this.cloudSnapshotErrorHandlers]) {
            try {
              if (handler(cleanSlot, cleanReason) !== false) {
                matchedAndConsumed = true;
              }
            } catch {
              // Throwing listener still consumed the delivery
              matchedAndConsumed = true;
            }
          }
        }
        if (!matchedAndConsumed) {
          if (this.abortedInFlightCloudSlots.delete(cleanSlot)) {
            return;
          }
          NativeBridgeService.pushBounded(
            this.pendingCloudSnapshotErrors,
            { slotKey: cleanSlot, reason: cleanReason },
            128
          );
        }
      };
    }
  }

  get platform(): 'android' | 'ios' | 'web' {
    if (typeof window === 'undefined') return 'web';
    if (window.CapyAndroid) return 'android';
    if (window.webkit?.messageHandlers?.CapyIOS) return 'ios';
    return 'web';
  }

  get isNative(): boolean {
    return this.platform !== 'web';
  }

  get isAndroid(): boolean {
    return this.platform === 'android';
  }

  isAndroidNative(): boolean {
    return this.isAndroid;
  }

  getSafeAreaInsets(): { top: number; bottom: number; left: number; right: number } {
    try {
      if (typeof window !== 'undefined' && window.CapyAndroid?.getSafeAreaInsets) {
        const raw = window.CapyAndroid.getSafeAreaInsets();
        if (raw) return JSON.parse(raw);
      }
    } catch {
      // ignore
    }
    return { top: 0, bottom: 0, left: 0, right: 0 };
  }

  applySafeAreaInsets(): void {
    if (typeof window === 'undefined' || typeof document === 'undefined') return;
    const insets = this.getSafeAreaInsets();
    if (insets.top > 0) {
      document.documentElement.style.setProperty('--safe-area-top', `${insets.top}px`);
    }
    if (insets.bottom > 0) {
      document.documentElement.style.setProperty('--safe-area-bottom', `${insets.bottom}px`);
    }
    if (insets.left > 0) {
      document.documentElement.style.setProperty('--safe-area-left', `${insets.left}px`);
    }
    if (insets.right > 0) {
      document.documentElement.style.setProperty('--safe-area-right', `${insets.right}px`);
    }
  }

  haptic(type: HapticType = 'tick', enabled: boolean = true): void {
    if (!enabled || typeof window === 'undefined') return;

    try {
      if (window.CapyAndroid?.haptic) {
        window.CapyAndroid.haptic(type);
        return;
      }
      if (window.webkit?.messageHandlers?.CapyIOS) {
        window.webkit.messageHandlers.CapyIOS.postMessage({ action: 'haptic', type });
        return;
      }
      if (typeof navigator !== 'undefined' && navigator.vibrate) {
        switch (type) {
          case 'tick':
            navigator.vibrate(8);
            break;
          case 'success':
            navigator.vibrate([15, 40, 25]);
            break;
          case 'warning':
            navigator.vibrate(20);
            break;
          case 'error':
            navigator.vibrate([30, 50, 30]);
            break;
        }
      }
    } catch {
      // Ignore haptic errors on unsupported devices
    }
  }

  private syncNativeModalFlag(): void {
    if (typeof window === 'undefined') return;
    const anyOpen = this.overlayBackStack.length > 0 || this.primaryModalCloseHandler !== null;
    try {
      if (window.CapyAndroid?.setModalOpen) {
        window.CapyAndroid.setModalOpen(anyOpen);
      } else if (window.webkit?.messageHandlers?.CapyIOS) {
        window.webkit.messageHandlers.CapyIOS.postMessage({ action: 'setModalOpen', isOpen: anyOpen });
      }
    } catch {
      // Ignore bridge errors
    }
  }

  setBackModalOpen(isOpen: boolean, onClose?: () => void): void {
    this.primaryModalCloseHandler = isOpen && onClose ? onClose : null;
    this.syncNativeModalFlag();
  }

  /**
   * Pushes a transient popover/overlay back handler onto a LIFO stack so dismissing
   * a child popover via Android Back never unregisters a parent modal's back listener.
   */
  pushBackHandler(onClose: () => void): () => void {
    this.overlayBackStack.push(onClose);
    this.syncNativeModalFlag();
    return () => {
      const idx = this.overlayBackStack.lastIndexOf(onClose);
      if (idx >= 0) {
        this.overlayBackStack.splice(idx, 1);
        this.syncNativeModalFlag();
      }
    };
  }

  saveBackup(key: string, data: string): boolean {
    if (typeof window === 'undefined' || !key || typeof data !== 'string') return false;
    try {
      if (window.CapyAndroid?.saveBackup) {
        return window.CapyAndroid.saveBackup(key, data);
      }
      if (window.webkit?.messageHandlers?.CapyIOS) {
        window.webkit.messageHandlers.CapyIOS.postMessage({ action: 'saveBackup', key, data });
        return true;
      }
    } catch {
      // Ignore
    }
    return false;
  }

  loadBackup(key: string): string | null {
    if (typeof window === 'undefined' || !key) return null;
    try {
      if (window.CapyAndroid?.loadBackup) {
        const result = window.CapyAndroid.loadBackup(key);
        return result && result.length > 0 ? result : null;
      }
    } catch {
      // Ignore
    }
    return null;
  }

  onSharedImage(handler: (title: string, dataUrl: string) => void): () => void {
    this.sharedImageHandler = handler;
    if (this.pendingSharedImages.length > 0) {
      const queued = this.pendingSharedImages.splice(0, this.pendingSharedImages.length);
      for (const item of queued) {
        if (isAllowedSharedImageDataUrl(item.dataUrl)) {
          handler(item.title, item.dataUrl);
        }
      }
    }
    try {
      if (typeof window !== 'undefined' && window.CapyAndroid?.consumePendingSharedImage) {
        const raw = window.CapyAndroid.consumePendingSharedImage();
        if (raw) {
          const parsed = JSON.parse(raw) as { title?: string; dataUrl?: string };
          if (parsed.dataUrl && isAllowedSharedImageDataUrl(parsed.dataUrl)) {
            handler(parsed.title || 'Shared Photo', parsed.dataUrl);
          }
        }
      }
    } catch {
      // Ignore
    }
    return () => {
      if (this.sharedImageHandler === handler) {
        this.sharedImageHandler = null;
      }
    };
  }

  /**
   * Pushes a transient shared-image interceptor onto a LIFO stack above the base
   * `onSharedImage` subscriber (e.g. Guided Gemini Handoff modal) without draining
   * unrelated cold-start shared photos or clobbering the base handler on unmount.
   */
  pushSharedImageInterceptor(handler: (title: string, dataUrl: string) => void): () => void {
    const entry = { handler };
    this.sharedImageInterceptors.push(entry);
    let removed = false;
    return () => {
      if (removed) return;
      removed = true;
      const idx = this.sharedImageInterceptors.indexOf(entry);
      if (idx >= 0) {
        this.sharedImageInterceptors.splice(idx, 1);
      }
    };
  }

  async shareImage(title: string, dataUrl: string): Promise<boolean> {
    if (typeof dataUrl !== 'string') return false;
    const trimmedUrl = dataUrl.trim();
    const isBlobUrl = /^blob:/i.test(trimmedUrl);
    if (!isAllowedSharedImageDataUrl(trimmedUrl) && !isBlobUrl) {
      return false;
    }
    try {
      if (typeof window !== 'undefined' && window.CapyAndroid?.shareImage) {
        window.CapyAndroid.shareImage(title, trimmedUrl);
        return true;
      }
      const res = await fetch(trimmedUrl);
      const blob = await res.blob();
      if (
        isBlobUrl &&
        typeof blob.type === 'string' &&
        blob.type.trim().length > 0 &&
        !isAllowedSharedImageMime(blob.type)
      ) {
        return false;
      }
      if (await isSvgOrXmlSharedBlob(blob)) {
        return false;
      }
      const { mimeType, ext } = resolveSharedImageMimeAndExt(trimmedUrl, blob.type);
      const safeBase = title.trim().replace(/\s+/g, '_').toLowerCase() || 'capy_image';
      const fileName = `${safeBase}.${ext}`;
      if (typeof navigator !== 'undefined' && navigator.share) {
        const file = new File([blob], fileName, {
          type: mimeType,
        });
        await navigator.share({
          title,
          files: [file],
        });
        return true;
      }
      // Fallback on desktop web without Web Share API: trigger download
      await this.exportOrShareFile({
        title,
        fileName,
        mimeType,
        data: blob,
      });
      return true;
    } catch {
      // Ignore user cancellation
      return false;
    }
  }

  /**
   * Exports or shares a binary/text file reliably across Android WebView and desktop/mobile browsers.
   */
  async exportOrShareFile(options: {
    title: string;
    fileName: string;
    mimeType: string;
    data: Uint8Array | Blob | string;
  }): Promise<void> {
    const { title, fileName, mimeType, data } = options;

    let blob: Blob;
    if (data instanceof Blob) {
      blob = data;
    } else if (data instanceof Uint8Array) {
      blob = new Blob([new Uint8Array(data)], { type: mimeType });
    } else {
      blob = new Blob([data], { type: mimeType });
    }

    if (typeof window !== 'undefined' && window.CapyAndroid?.shareFile) {
      const bytes = new Uint8Array(await blob.arrayBuffer());
      window.CapyAndroid.shareFile(title, fileName, mimeType, uint8ToBase64(bytes));
      return;
    }

    if (
      typeof window !== 'undefined' &&
      window.CapyAndroid?.shareImage &&
      (mimeType === 'image/png' || mimeType === 'image/jpeg' || mimeType === 'image/webp')
    ) {
      const bytes = new Uint8Array(await blob.arrayBuffer());
      window.CapyAndroid.shareImage(title, `data:${mimeType};base64,${uint8ToBase64(bytes)}`);
      return;
    }

    if (typeof document !== 'undefined') {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1500);
    }
  }

  onDeepLink(handler: (url: string) => void): () => void {
    this.deepLinkHandler = handler;
    if (this.pendingDeepLinks.length > 0) {
      const queued = this.pendingDeepLinks.splice(0, this.pendingDeepLinks.length);
      for (const url of queued) {
        if (isValidAndroidDeepLink(url)) {
          handler(url);
        }
      }
    }
    try {
      if (typeof window !== 'undefined' && window.CapyAndroid?.consumePendingDeepLink) {
        const pendingUrl = window.CapyAndroid.consumePendingDeepLink();
        if (pendingUrl && isValidAndroidDeepLink(pendingUrl)) {
          handler(pendingUrl);
        }
      }
    } catch {
      // Ignore
    }
    return () => {
      if (this.deepLinkHandler === handler) {
        this.deepLinkHandler = null;
      }
    };
  }

  onPlayGamesProfile(
    handler: (profile: { playerId: string; displayName: string }) => void | boolean,
    options?: BridgeListenOptions
  ): () => void {
    const once = Boolean(options?.once);
    let settled = false;
    let unsubscribed = false;
    let onceConsumed = false;
    const listener = (profile: { playerId: string; displayName: string }): boolean => {
      if (unsubscribed || settled) return false;
      if (once) {
        settled = true;
        this.playGamesProfileHandlers.delete(listener);
      }
      let returnedFalse = false;
      let threw = false;
      try {
        const res = handler(profile);
        if (res === false) {
          returnedFalse = true;
          return false;
        }
        return true;
      } catch (err) {
        threw = true;
        throw err;
      } finally {
        if (once) {
          if (!threw && returnedFalse && !unsubscribed) {
            settled = false;
            this.playGamesProfileHandlers.add(listener);
          } else {
            onceConsumed = true;
          }
        }
      }
    };
    let i = 0;
    while (i < this.pendingPlayGamesProfiles.length) {
      if (unsubscribed) break;
      const profile = this.pendingPlayGamesProfiles.splice(i, 1)[0];
      if (once) {
        settled = true;
      }
      let consumed = true;
      let threw = false;
      try {
        const res = handler(profile);
        if (res === false) {
          consumed = false;
        }
      } catch {
        threw = true;
        consumed = true;
      }
      if (!threw && !consumed) {
        if (once && !unsubscribed) {
          settled = false;
        }
        this.pendingPlayGamesProfiles.splice(
          Math.min(i, this.pendingPlayGamesProfiles.length),
          0,
          profile
        );
        i++;
      } else if (once) {
        onceConsumed = true;
        break;
      }
    }
    if (!unsubscribed && !(once && onceConsumed)) {
      this.playGamesProfileHandlers.add(listener);
    }
    return () => {
      unsubscribed = true;
      this.playGamesProfileHandlers.delete(listener);
    };
  }

  onPlayGamesError(
    handler: (reason: string) => void | boolean,
    options?: BridgeListenOptions
  ): () => void {
    const once = Boolean(options?.once);
    let settled = false;
    let unsubscribed = false;
    let onceConsumed = false;
    const listener = (reason: string): boolean => {
      if (unsubscribed || settled) return false;
      if (once) {
        settled = true;
        this.playGamesErrorHandlers.delete(listener);
      }
      let returnedFalse = false;
      let threw = false;
      try {
        const res = handler(reason);
        if (res === false) {
          returnedFalse = true;
          return false;
        }
        return true;
      } catch (err) {
        threw = true;
        throw err;
      } finally {
        if (once) {
          if (!threw && returnedFalse && !unsubscribed) {
            settled = false;
            this.playGamesErrorHandlers.add(listener);
          } else {
            onceConsumed = true;
          }
        }
      }
    };
    let i = 0;
    while (i < this.pendingPlayGamesErrors.length) {
      if (unsubscribed) break;
      const reason = this.pendingPlayGamesErrors.splice(i, 1)[0];
      if (once) {
        settled = true;
      }
      let consumed = true;
      let threw = false;
      try {
        const res = handler(reason);
        if (res === false) {
          consumed = false;
        }
      } catch {
        threw = true;
        consumed = true;
      }
      if (!threw && !consumed) {
        if (once && !unsubscribed) {
          settled = false;
        }
        this.pendingPlayGamesErrors.splice(
          Math.min(i, this.pendingPlayGamesErrors.length),
          0,
          reason
        );
        i++;
      } else if (once) {
        onceConsumed = true;
        break;
      }
    }
    if (!unsubscribed && !(once && onceConsumed)) {
      this.playGamesErrorHandlers.add(listener);
    }
    return () => {
      unsubscribed = true;
      this.playGamesErrorHandlers.delete(listener);
    };
  }

  isPlayGamesConfigured(): boolean {
    if (!this.isAndroid) return false;
    try {
      if (typeof window !== 'undefined' && typeof window.CapyAndroid?.isPlayGamesConfigured === 'function') {
        return Boolean(window.CapyAndroid.isPlayGamesConfigured());
      }
    } catch {
      return false;
    }
    return true;
  }

  onCloudSnapshot(
    handler: (slotKey: string, payloadJson: string) => void | boolean,
    options?: CloudSnapshotListenOptions
  ): () => void {
    const slotKeyFilter = options?.slotKey;
    const slotFnFilter = options?.slotFilter;
    const once = Boolean(options?.once);
    const matchesSlot = (slot: string): boolean => {
      if (slotKeyFilter !== undefined && slot !== slotKeyFilter) return false;
      if (slotFnFilter && !slotFnFilter(slot)) return false;
      return true;
    };
    let settled = false;
    let unsubscribed = false;
    let onceConsumed = false;
    const listener = (slot: string, payloadJson: string): boolean => {
      if (unsubscribed || settled) return false;
      if (!matchesSlot(slot)) return false;
      if (once) {
        settled = true;
        this.cloudSnapshotHandlers.delete(listener);
      }
      let returnedFalse = false;
      let threw = false;
      try {
        const res = handler(slot, payloadJson);
        if (res === false) {
          returnedFalse = true;
          return false;
        }
        return true;
      } catch (err) {
        threw = true;
        throw err;
      } finally {
        if (once) {
          if (!threw && returnedFalse && !unsubscribed) {
            settled = false;
            this.cloudSnapshotHandlers.add(listener);
          } else {
            onceConsumed = true;
          }
        }
      }
    };
    let i = 0;
    while (i < this.pendingCloudSnapshots.length) {
      if (unsubscribed) break;
      const item = this.pendingCloudSnapshots[i];
      if (!matchesSlot(item.slotKey)) {
        i++;
        continue;
      }
      this.pendingCloudSnapshots.splice(i, 1);
      if (once) {
        settled = true;
      }
      let consumed = true;
      let threw = false;
      try {
        const res = handler(item.slotKey, item.payloadJson);
        if (res === false) {
          consumed = false;
        }
      } catch {
        threw = true;
        consumed = true;
      }
      if (!threw && !consumed) {
        if (once && !unsubscribed) {
          settled = false;
        }
        this.pendingCloudSnapshots.splice(
          Math.min(i, this.pendingCloudSnapshots.length),
          0,
          item
        );
        i++;
      } else if (once) {
        onceConsumed = true;
        break;
      }
    }
    if (!unsubscribed && !(once && onceConsumed)) {
      this.cloudSnapshotHandlers.add(listener);
    }
    return () => {
      unsubscribed = true;
      this.cloudSnapshotHandlers.delete(listener);
    };
  }

  onCloudSnapshotError(
    handler: (slotKey: string, reason: string) => void | boolean,
    options?: CloudSnapshotListenOptions
  ): () => void {
    const slotKeyFilter = options?.slotKey;
    const slotFnFilter = options?.slotFilter;
    const once = Boolean(options?.once);
    const matchesSlot = (slot: string): boolean => {
      if (slotKeyFilter !== undefined && slot !== slotKeyFilter) return false;
      if (slotFnFilter && !slotFnFilter(slot)) return false;
      return true;
    };
    let settled = false;
    let unsubscribed = false;
    let onceConsumed = false;
    const listener = (slot: string, reason: string): boolean => {
      if (unsubscribed || settled) return false;
      if (!matchesSlot(slot)) return false;
      if (once) {
        settled = true;
        this.cloudSnapshotErrorHandlers.delete(listener);
      }
      let returnedFalse = false;
      let threw = false;
      try {
        const res = handler(slot, reason);
        if (res === false) {
          returnedFalse = true;
          return false;
        }
        return true;
      } catch (err) {
        threw = true;
        throw err;
      } finally {
        if (once) {
          if (!threw && returnedFalse && !unsubscribed) {
            settled = false;
            this.cloudSnapshotErrorHandlers.add(listener);
          } else {
            onceConsumed = true;
          }
        }
      }
    };
    let i = 0;
    while (i < this.pendingCloudSnapshotErrors.length) {
      if (unsubscribed) break;
      const item = this.pendingCloudSnapshotErrors[i];
      if (!matchesSlot(item.slotKey)) {
        i++;
        continue;
      }
      this.pendingCloudSnapshotErrors.splice(i, 1);
      if (once) {
        settled = true;
      }
      let consumed = true;
      let threw = false;
      try {
        const res = handler(item.slotKey, item.reason);
        if (res === false) {
          consumed = false;
        }
      } catch {
        threw = true;
        consumed = true;
      }
      if (!threw && !consumed) {
        if (once && !unsubscribed) {
          settled = false;
        }
        this.pendingCloudSnapshotErrors.splice(
          Math.min(i, this.pendingCloudSnapshotErrors.length),
          0,
          item
        );
        i++;
      } else if (once) {
        onceConsumed = true;
        break;
      }
    }
    if (!unsubscribed && !(once && onceConsumed)) {
      this.cloudSnapshotErrorHandlers.add(listener);
    }
    return () => {
      unsubscribed = true;
      this.cloudSnapshotErrorHandlers.delete(listener);
    };
  }

  signInPlayGames(): { playerId: string; displayName: string } | null {
    if (typeof window === 'undefined') return null;
    try {
      if (window.CapyAndroid?.signInPlayGames) {
        const raw = window.CapyAndroid.signInPlayGames();
        if (raw) {
          const parsed = JSON.parse(raw) as { playerId?: string; displayName?: string };
          if (parsed.playerId && parsed.displayName) {
            return { playerId: parsed.playerId, displayName: parsed.displayName };
          }
        }
      }
    } catch {
      // Safe fallback when Play Games v2 SDK is unconfigured or offline
    }
    return null;
  }

  saveCloudSnapshot(slotKey: string, payloadJson: string): boolean {
    if (typeof window === 'undefined' || !slotKey || typeof payloadJson !== 'string') return false;
    try {
      if (window.CapyAndroid?.saveCloudSnapshot) {
        return window.CapyAndroid.saveCloudSnapshot(slotKey, payloadJson);
      }
    } catch {
      // Fallback handled by CrdtCloudSaveAdapter
    }
    return false;
  }

  loadCloudSnapshot(slotKey: string): string | null {
    if (typeof window === 'undefined' || !slotKey) return null;
    try {
      if (window.CapyAndroid?.loadCloudSnapshot) {
        const res = window.CapyAndroid.loadCloudSnapshot(slotKey);
        return res && res.length > 0 ? res : null;
      }
    } catch {
      // Fallback handled by CrdtCloudSaveAdapter
    }
    return null;
  }

  saveCloudBinaryChunk(
    blobKey: string,
    chunkIndex: number,
    totalChunks: number,
    base64Chunk: string
  ): boolean {
    if (
      typeof window === 'undefined' ||
      !blobKey ||
      !base64Chunk ||
      chunkIndex < 0 ||
      totalChunks < 1 ||
      chunkIndex >= totalChunks
    ) {
      return false;
    }
    try {
      if (window.CapyAndroid?.saveCloudBinaryChunk) {
        return window.CapyAndroid.saveCloudBinaryChunk(
          blobKey,
          chunkIndex,
          totalChunks,
          base64Chunk
        );
      }
      if (window.CapyAndroid?.saveCloudSnapshot) {
        const safeKey = blobKey.replace(/[^a-zA-Z0-9._-]/g, '_') || 'default_key';
        return window.CapyAndroid.saveCloudSnapshot(`${safeKey}_part_${chunkIndex}`, base64Chunk);
      }
    } catch {
      // Safe fallback when native bridge is unavailable
    }
    return false;
  }

  loadCloudBinaryChunk(blobKey: string, chunkIndex: number): string | null {
    if (typeof window === 'undefined' || !blobKey || chunkIndex < 0) return null;
    try {
      if (window.CapyAndroid?.loadCloudBinaryChunk) {
        const res = window.CapyAndroid.loadCloudBinaryChunk(blobKey, chunkIndex);
        return res && res.length > 0 ? res : null;
      }
      if (window.CapyAndroid?.loadCloudSnapshot) {
        const safeKey = blobKey.replace(/[^a-zA-Z0-9._-]/g, '_') || 'default_key';
        const res = window.CapyAndroid.loadCloudSnapshot(`${safeKey}_part_${chunkIndex}`);
        return res && res.length > 0 ? res : null;
      }
    } catch {
      // Safe fallback when native bridge is unavailable
    }
    return null;
  }

  requestCloudSnapshotPull(slotKey: string): boolean {
    if (typeof window === 'undefined' || !slotKey) return false;
    this.abortedInFlightCloudSlots.delete(slotKey);
    try {
      if (window.CapyAndroid?.requestCloudSnapshotPull) {
        return window.CapyAndroid.requestCloudSnapshotPull(slotKey);
      }
    } catch {
      // Safe fallback when Play Games SDK pull hook is unavailable
    }
    return false;
  }

  openExternalOAuth(authUrl: string): boolean {
    if (typeof window === 'undefined' || typeof authUrl !== 'string') return false;
    const trimmed = authUrl.trim();
    if (!trimmed || /[\u0000-\u001F\u007F\s]/.test(trimmed)) return false;
    try {
      const parsed = new URL(trimmed);
      if (parsed.protocol.toLowerCase() !== 'https:') return false;
      if (parsed.port !== '' || parsed.username !== '' || parsed.password !== '') {
        return false;
      }
      const host = parsed.hostname.toLowerCase();
      if (host !== 'accounts.google.com' && host !== 'login.microsoftonline.com') {
        return false;
      }
      if (window.CapyAndroid?.openExternalOAuth) {
        return Boolean(window.CapyAndroid.openExternalOAuth(parsed.toString()));
      }
    } catch {
      return false;
    }
    return false;
  }

  async shareTextLink(title: string, url: string): Promise<'shared' | 'copied'> {
    if (typeof url !== 'string') return 'copied';
    let safeUrl = '';
    try {
      const parsed = new URL(url.trim());
      if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {
        safeUrl = parsed.toString();
      }
    } catch {
      return 'copied';
    }
    if (!safeUrl) return 'copied';

    try {
      if (typeof window !== 'undefined' && window.CapyAndroid?.shareTextLink) {
        window.CapyAndroid.shareTextLink(title, safeUrl);
        return 'shared';
      }
      if (typeof navigator !== 'undefined' && navigator.share) {
        await navigator.share({ title, url: safeUrl });
        return 'shared';
      }
    } catch {
      // Fall through to clipboard copy if user dismissed or Web Share unavailable
    }
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(safeUrl);
    }
    return 'copied';
  }
}

export const NativeBridge = new NativeBridgeService();
