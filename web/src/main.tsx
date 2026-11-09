import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import { StorageService } from './services/StorageService';
import './index.css';

if (typeof window !== 'undefined') {
  (window as any).capyStorage = StorageService;
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
