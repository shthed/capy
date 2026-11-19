import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import { ErrorBoundary } from './components/ErrorBoundary';
import { StorageService, isDebugStorageExposed } from './services/StorageService';
import { PwaService } from './services/PwaService';
import { resolveScopedStorageKey } from './services/StorageNamespace';
import './index.css';

function DebugCrashGate(): null {
  if (typeof window !== 'undefined' && isDebugStorageExposed()) {
    const params = new URLSearchParams(window.location.search);
    if (params.get('capy_test_crash') === '1') {
      throw new Error('Debug ErrorBoundary trigger');
    }
  }
  return null;
}

function clearDebugCrashQueryParam(): void {
  if (typeof window === 'undefined' || !window.history?.replaceState) return;
  const url = new URL(window.location.href);
  if (url.searchParams.has('capy_test_crash')) {
    url.searchParams.delete('capy_test_crash');
    window.history.replaceState({}, '', url.toString());
  }
}

if (typeof window !== 'undefined') {
  if (isDebugStorageExposed()) {
    (window as unknown as { capyStorage?: typeof StorageService }).capyStorage = StorageService;
  }
  (window as any).capyPwa = PwaService;

  const PRELOAD_RELOAD_GUARD_KEY = 'capy_preload_reload_v1';
  window.addEventListener('vite:preloadError', (event) => {
    event.preventDefault();
    try {
      const scopedKey = resolveScopedStorageKey(PRELOAD_RELOAD_GUARD_KEY);
      if (!sessionStorage.getItem(scopedKey)) {
        sessionStorage.setItem(scopedKey, '1');
        window.location.reload();
      }
    } catch {
      // Ignore sessionStorage restrictions without risking a reload loop
    }
  });
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary onReset={clearDebugCrashQueryParam}>
      <DebugCrashGate />
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);
