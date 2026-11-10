export type HapticType = 'tick' | 'success' | 'warning' | 'error';

interface CapyAndroidInterface {
  haptic?: (type: string) => void;
  setModalOpen?: (isOpen: boolean) => void;
  saveBackup?: (key: string, data: string) => boolean;
  loadBackup?: (key: string) => string | null;
  saveCloudSnapshot?: (slotKey: string, payloadJson: string) => boolean;
  loadCloudSnapshot?: (slotKey: string) => string | null;
  signInPlayGames?: () => string | null;
  showRewardedAd?: () => boolean;
  shareImage?: (title: string, dataUrl: string) => void;
  shareTextLink?: (title: string, url: string) => void;
  shareFile?: (title: string, fileName: string, mimeType: string, base64Data: string) => void;
  consumePendingSharedImage?: () => string | null;
  consumePendingDeepLink?: () => string | null;
  getAppVersion?: () => string;
  getSafeAreaInsets?: () => string;
}

declare global {
  interface Window {
    CapyAndroid?: CapyAndroidInterface;
    __capyCloseModal?: () => boolean;
    __capyReceiveSharedImage?: (title: string, dataUrl: string) => void;
    __capyReceiveDeepLink?: (url: string) => void;
    webkit?: {
      messageHandlers?: {
        CapyIOS?: {
          postMessage: (msg: Record<string, unknown>) => void;
        };
      };
    };
  }
}

function uint8ToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.byteLength; i += chunkSize) {
    binary += String.fromCharCode(
      ...Array.from(bytes.subarray(i, Math.min(i + chunkSize, bytes.byteLength)))
    );
  }
  return btoa(binary);
}

class NativeBridgeService {
  private primaryModalCloseHandler: (() => void) | null = null;
  private overlayBackStack: Array<() => void> = [];
  private sharedImageHandler: ((title: string, dataUrl: string) => void) | null = null;
  private deepLinkHandler: ((url: string) => void) | null = null;

  constructor() {
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
        if (this.sharedImageHandler && dataUrl) {
          this.sharedImageHandler(title || 'Shared Photo', dataUrl);
        }
      };

      window.__capyReceiveDeepLink = (url: string) => {
        if (this.deepLinkHandler && url) {
          this.deepLinkHandler(url);
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
    try {
      if (window.CapyAndroid?.consumePendingSharedImage) {
        const raw = window.CapyAndroid.consumePendingSharedImage();
        if (raw) {
          const parsed = JSON.parse(raw) as { title?: string; dataUrl?: string };
          if (parsed.dataUrl) {
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

  async shareImage(title: string, dataUrl: string): Promise<void> {
    try {
      if (window.CapyAndroid?.shareImage) {
        window.CapyAndroid.shareImage(title, dataUrl);
        return;
      }
      if (typeof navigator !== 'undefined' && navigator.share) {
        const res = await fetch(dataUrl);
        const blob = await res.blob();
        const file = new File([blob], `${title.replace(/\s+/g, '_').toLowerCase()}.png`, {
          type: 'image/png',
        });
        await navigator.share({
          title,
          files: [file],
        });
        return;
      }
      // Fallback on desktop web without Web Share API: trigger download
      const res = await fetch(dataUrl);
      const blob = await res.blob();
      await this.exportOrShareFile({
        title,
        fileName: `${title.replace(/\s+/g, '_').toLowerCase()}.png`,
        mimeType: 'image/png',
        data: blob,
      });
    } catch {
      // Ignore user cancellation
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

    if (typeof window !== 'undefined' && window.CapyAndroid?.shareImage && mimeType === 'image/png') {
      const bytes = new Uint8Array(await blob.arrayBuffer());
      window.CapyAndroid.shareImage(title, `data:image/png;base64,${uint8ToBase64(bytes)}`);
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
    try {
      if (window.CapyAndroid?.consumePendingDeepLink) {
        const pendingUrl = window.CapyAndroid.consumePendingDeepLink();
        if (pendingUrl && pendingUrl.length > 0) {
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

  signInPlayGames(): { playerId: string; displayName: string } | null {
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

  showRewardedAd(): boolean {
    try {
      if (window.CapyAndroid?.showRewardedAd) {
        return window.CapyAndroid.showRewardedAd();
      }
    } catch {
      // Ad-free or unconfigured host
    }
    return false;
  }

  async shareTextLink(title: string, url: string): Promise<'shared' | 'copied'> {
    try {
      if (window.CapyAndroid?.shareTextLink) {
        window.CapyAndroid.shareTextLink(title, url);
        return 'shared';
      }
      if (typeof navigator !== 'undefined' && navigator.share) {
        await navigator.share({ title, url });
        return 'shared';
      }
    } catch {
      // Fall through to clipboard copy if user dismissed or Web Share unavailable
    }
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(url);
    }
    return 'copied';
  }
}

export const NativeBridge = new NativeBridgeService();
