import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import { StorageService } from './services/StorageService';
import { PwaService } from './services/PwaService';
import { resolveScopedStorageKey } from './services/StorageNamespace';
import './index.css';

if (typeof window !== 'undefined') {
  (window as any).capyStorage = StorageService;
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
    <App />
  </React.StrictMode>
);
