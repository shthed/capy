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

export const PWA_UPDATE_FALLBACK_MS = 5000;
export const PWA_UPDATE_HARD_CAP_MS = 10000;
export const PWA_UPDATE_WAIT_POLL_MS = 250;

export type PwaTimerHandle = ReturnType<typeof setTimeout>;
export type PwaIntervalHandle = ReturnType<typeof setInterval>;

export interface PwaWaitingWorkerLike {
  postMessage(message: unknown): void;
  addEventListener?: (type: string, listener: EventListenerOrEventListenerObject) => void;
  removeEventListener?: (type: string, listener: EventListenerOrEventListenerObject) => void;
}

export interface PwaRegistrationLike {
  readonly waiting: PwaWaitingWorkerLike | null;
}

export interface PwaServiceWorkerContainerLike {
  addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions
  ): void;
  removeEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | EventListenerOptions
  ): void;
}

export interface ApplyServiceWorkerUpdateDeps {
  registration: PwaRegistrationLike | null | undefined;
  serviceWorkerContainer: PwaServiceWorkerContainerLike | null | undefined;
  reload: () => void;
  setTimeoutFn?: (handler: () => void, timeout: number) => PwaTimerHandle;
  clearTimeoutFn?: (handle: PwaTimerHandle) => void;
  setIntervalFn?: (handler: () => void, timeout: number) => PwaIntervalHandle;
  clearIntervalFn?: (handle: PwaIntervalHandle) => void;
  fallbackMs?: number;
  hardCapMs?: number;
  waitPollMs?: number;
  onAbort?: () => void;
}

export interface ApplyServiceWorkerUpdateHandle {
  started: boolean;
  cancel: () => void;
}

function normalizeNonNegativeMs(value: number | undefined, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(0, value);
}

function resolveUpdateTimings(deps: ApplyServiceWorkerUpdateDeps) {
  const fallbackMs = normalizeNonNegativeMs(deps.fallbackMs, PWA_UPDATE_FALLBACK_MS);
  const hardCapMs = Math.max(fallbackMs, normalizeNonNegativeMs(deps.hardCapMs, PWA_UPDATE_HARD_CAP_MS));
  const waitPollMs = Math.max(1, normalizeNonNegativeMs(deps.waitPollMs, PWA_UPDATE_WAIT_POLL_MS));
  return { fallbackMs, hardCapMs, waitPollMs };
}

function resolveTimerAdapters(deps: ApplyServiceWorkerUpdateDeps) {
  return {
    scheduleTimeout:
      deps.setTimeoutFn ?? ((handler: () => void, timeout: number) => globalThis.setTimeout(handler, timeout)),
    cancelTimeout: deps.clearTimeoutFn ?? ((handle: PwaTimerHandle) => globalThis.clearTimeout(handle)),
    scheduleInterval:
      deps.setIntervalFn ?? ((handler: () => void, timeout: number) => globalThis.setInterval(handler, timeout)),
    cancelInterval: deps.clearIntervalFn ?? ((handle: PwaIntervalHandle) => globalThis.clearInterval(handle)),
  };
}

export function applyServiceWorkerUpdate(
  deps: ApplyServiceWorkerUpdateDeps
): ApplyServiceWorkerUpdateHandle {
  const { registration, serviceWorkerContainer, reload, onAbort } = deps;
  if (!registration?.waiting || !serviceWorkerContainer) {
    return { started: false, cancel: () => {} };
  }

  const waitingWorker = registration.waiting;
  const { fallbackMs, hardCapMs, waitPollMs } = resolveUpdateTimings(deps);
  const { scheduleTimeout, cancelTimeout, scheduleInterval, cancelInterval } = resolveTimerAdapters(deps);

  let finished = false;
  let fallbackElapsed = false;
  let fallbackTimer: PwaTimerHandle | null = null;
  let hardCapTimer: PwaTimerHandle | null = null;
  let waitPollTimer: PwaIntervalHandle | null = null;

  const cleanup = () => {
    if (fallbackTimer !== null) {
      cancelTimeout(fallbackTimer);
      fallbackTimer = null;
    }
    if (hardCapTimer !== null) {
      cancelTimeout(hardCapTimer);
      hardCapTimer = null;
    }
    if (waitPollTimer !== null) {
      cancelInterval(waitPollTimer);
      waitPollTimer = null;
    }
    try {
      serviceWorkerContainer.removeEventListener('controllerchange', handleControllerChange);
    } catch {
      // Ignore listener teardown errors on detached serviceWorker containers
    }
    if (typeof waitingWorker.removeEventListener === 'function') {
      try {
        waitingWorker.removeEventListener('statechange', handleWaitingStateChange);
      } catch {
        // Ignore listener teardown errors on detached waiting workers
      }
    }
  };

  const triggerReload = () => {
    if (finished) return;
    finished = true;
    cleanup();
    reload();
  };

  const cancel = () => {
    if (finished) return;
    finished = true;
    cleanup();
    onAbort?.();
  };

  const handleControllerChange = () => {
    triggerReload();
  };

  const handleWaitingStateChange = () => {
    if (fallbackElapsed && !registration.waiting) {
      triggerReload();
    }
  };

  serviceWorkerContainer.addEventListener('controllerchange', handleControllerChange, { once: true });
  if (typeof waitingWorker.addEventListener === 'function') {
    waitingWorker.addEventListener('statechange', handleWaitingStateChange);
  }

  fallbackTimer = scheduleTimeout(() => {
    fallbackTimer = null;
    if (finished) return;
    fallbackElapsed = true;
    if (!registration.waiting) {
      triggerReload();
      return;
    }
    waitPollTimer = scheduleInterval(() => {
      if (!registration.waiting) {
        triggerReload();
      }
    }, waitPollMs);
  }, fallbackMs);

  hardCapTimer = scheduleTimeout(() => {
    hardCapTimer = null;
    triggerReload();
  }, hardCapMs);

  try {
    waitingWorker.postMessage({ type: 'SKIP_WAITING' });
  } catch (err) {
    console.warn('[PWA] Failed to post SKIP_WAITING to waiting service worker:', err);
    if (!finished) {
      cancel();
      return { started: false, cancel };
    }
  }

  return { started: true, cancel };
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

export class PwaServiceClass {
  private deferredPrompt: BeforeInstallPromptEvent | null = null;
  private listeners: Set<PwaListener> = new Set();
  private registration: ServiceWorkerRegistration | null = null;
  private hasUpdate = false;
  private applyingUpdate = false;

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

  public applyUpdate(): void {
    if (
      this.applyingUpdate ||
      !this.registration?.waiting ||
      typeof window === 'undefined' ||
      typeof navigator === 'undefined' ||
      !('serviceWorker' in navigator) ||
      !navigator.serviceWorker
    ) {
      return;
    }

    this.applyingUpdate = true;
    const handle = applyServiceWorkerUpdate({
      registration: this.registration,
      serviceWorkerContainer: navigator.serviceWorker,
      reload: () => window.location.reload(),
      onAbort: () => {
        this.applyingUpdate = false;
      },
    });
    if (!handle.started) {
      this.applyingUpdate = false;
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
