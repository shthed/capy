import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import { StorageService } from './services/StorageService';
import { PwaService } from './services/PwaService';
import './index.css';

if (typeof window !== 'undefined') {
  (window as any).capyStorage = StorageService;
  (window as any).capyPwa = PwaService;
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
