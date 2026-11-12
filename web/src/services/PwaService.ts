// PwaService - Progressive Web App Lifecycle, Service Worker Registration & Install Prompt Management
import { APP_VERSION } from '../version';
import { NativeBridge } from './NativeBridge';

export function normalizePwaScopePath(rawPathname: string): string {
  if (!rawPathname) return '/';
  const withLeading = rawPathname.startsWith('/') ? rawPathname : `/${rawPathname}`;
  return withLeading.endsWith('/') ? withLeading : `${withLeading}/`;
}

export function resolvePwaCacheName(scopeUrl?: string | null, version?: string): string {
  const effectiveVersion =
    version ?? ((import.meta as unknown as { env?: { DEV?: boolean } }).env?.DEV ? 'dev' : APP_VERSION);
  let pathname = '/';
  try {
    if (scopeUrl) {
      pathname = scopeUrl.startsWith('/') ? scopeUrl : new URL(scopeUrl).pathname;
    } else if (typeof navigator !== 'undefined' && navigator.serviceWorker?.controller?.scriptURL) {
      pathname = new URL('./', navigator.serviceWorker.controller.scriptURL).pathname;
    } else if (typeof window !== 'undefined') {
      const baseUrl =
        (import.meta as unknown as { env?: { BASE_URL?: string } }).env?.BASE_URL || './';
      pathname = new URL(baseUrl, window.location.href).pathname;
    }
  } catch {
    pathname = '/';
  }
  return `capy-cache-v${effectiveVersion}:${normalizePwaScopePath(pathname)}`;
}

interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[];
  readonly userChoice: Promise<{
    outcome: 'accepted' | 'dismissed';
    platform: string;
  }>;
  prompt(): Promise<void>;
}

type PwaListener = () => void;

class PwaServiceClass {
  private deferredPrompt: BeforeInstallPromptEvent | null = null;
  private listeners: Set<PwaListener> = new Set();
  private registration: ServiceWorkerRegistration | null = null;
  private hasUpdate = false;

  constructor() {
    if (typeof window !== 'undefined') {
      this.init();
    }
  }

  private init() {
    // 1. Listen for the browser install prompt event
    window.addEventListener('beforeinstallprompt', (e: Event) => {
      // Prevent automatic mini-infobar on mobile Chrome
      e.preventDefault();
      this.deferredPrompt = e as BeforeInstallPromptEvent;
      this.notifyListeners();
    });

    // 2. Listen for successful installation
    window.addEventListener('appinstalled', () => {
      this.deferredPrompt = null;
      this.notifyListeners();
    });

    // 3. Register Service Worker (web environment only, bypassing native Android wrapper)
    if ('serviceWorker' in navigator && !NativeBridge.isAndroid) {
      if (document.readyState === 'complete') {
        this.registerServiceWorker();
      } else {
        window.addEventListener('load', () => {
          this.registerServiceWorker();
        });
      }
    }
  }

  private async registerServiceWorker() {
    try {
      // Relative registration maintains invariance across GitHub Pages root, PR previews, and local dev
      const reg = await navigator.serviceWorker.register('./sw.js', { scope: './' });
      this.registration = reg;

      // Cache currently active DOM scripts and stylesheets for immediate offline readiness
      if ('caches' in window) {
        try {
          const cache = await caches.open(resolvePwaCacheName(reg.scope));
          const urls: string[] = [];
          document.querySelectorAll('script[src], link[rel="stylesheet"]').forEach((el) => {
            const src = 'src' in el ? (el as HTMLScriptElement).src : (el as HTMLLinkElement).href;
            if (src && src.startsWith(window.location.origin)) {
              urls.push(src);
            }
          });
          await Promise.allSettled(urls.map((u) => cache.add(u)));
        } catch {
          // Ignored
        }
      }

      // Handle updates found
      reg.addEventListener('updatefound', () => {
        const newWorker = reg.installing;
        if (!newWorker) return;

        newWorker.addEventListener('statechange', () => {
          if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
            this.hasUpdate = true;
            this.notifyListeners();
          }
        });
      });
    } catch (err) {
      console.warn('[PWA] Service worker registration error:', err);
    }
  }

  public get isInstallable(): boolean {
    return this.deferredPrompt !== null;
  }

  public get isStandalone(): boolean {
    if (typeof window === 'undefined') return false;
    return (
      window.matchMedia('(display-mode: standalone)').matches ||
      (navigator as any).standalone === true ||
      document.referrer.includes('android-app://')
    );
  }

  public get isUpdateAvailable(): boolean {
    return this.hasUpdate;
  }

  public async promptInstall(): Promise<boolean> {
    if (!this.deferredPrompt) {
      return false;
    }

    try {
      await this.deferredPrompt.prompt();
      const choice = await this.deferredPrompt.userChoice;
      this.deferredPrompt = null;
      this.notifyListeners();
      return choice.outcome === 'accepted';
    } catch (err) {
      console.warn('[PWA] Install prompt failed:', err);
      this.deferredPrompt = null;
      this.notifyListeners();
      return false;
    }
  }

  public applyUpdate() {
    if (this.registration && this.registration.waiting) {
      let reloaded = false;
      const doReload = () => {
        if (reloaded) return;
        reloaded = true;
        window.location.reload();
      };
      navigator.serviceWorker.addEventListener('controllerchange', doReload, { once: true });
      this.registration.waiting.postMessage({ type: 'SKIP_WAITING' });
      setTimeout(doReload, 1500);
    }
  }

  public subscribe(listener: PwaListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notifyListeners() {
    this.listeners.forEach((listener) => {
      try {
        listener();
      } catch (err) {
        console.error('[PWA] Listener notification failed:', err);
      }
    });
  }
}

export const PwaService = new PwaServiceClass();
