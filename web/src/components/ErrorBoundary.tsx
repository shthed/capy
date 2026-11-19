import React from 'react';
import { Download, RefreshCw, RotateCcw, ShieldAlert } from 'lucide-react';
import { NativeBridge } from '../services/NativeBridge';
import { StorageService } from '../services/StorageService';
import { reportSwallowed } from '../services/telemetry';

export interface ErrorBoundaryProps {
  children: React.ReactNode;
  fallbackTitle?: string;
  onReset?: () => void;
  onExportBackup?: () => Promise<'binary' | 'json'>;
}

export interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  exportStatus: 'idle' | 'exporting' | 'exported' | 'error';
  exportMessage: string;
}

export async function exportEmergencySavesBackup(): Promise<'binary' | 'json'> {
  try {
    const bytes = await StorageService.exportAllSnapshotsBinary();
    await NativeBridge.exportOrShareFile({
      title: 'Capy Emergency Backup',
      fileName: 'capy_emergency_backup.capy',
      mimeType: 'application/octet-stream',
      data: bytes,
    });
    return 'binary';
  } catch (binaryErr) {
    reportSwallowed('ErrorBoundary.exportBackupBinary', binaryErr);
    const jsonPayload = await StorageService.exportAllSnapshots();
    const jsonBytes = new TextEncoder().encode(jsonPayload);
    await NativeBridge.exportOrShareFile({
      title: 'Capy Emergency Backup (JSON)',
      fileName: 'capy_emergency_backup.json',
      mimeType: 'application/json',
      data: jsonBytes,
    });
    return 'json';
  }
}

export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      exportStatus: 'idle',
      exportMessage: '',
    };
  }

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return {
      hasError: true,
      error: error instanceof Error ? error : new Error(String(error ?? 'Unknown error')),
    };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    reportSwallowed('ErrorBoundary', error, {
      componentStack: info?.componentStack ? info.componentStack.slice(0, 160) : '',
    });
  }

  private handleReset = (): void => {
    try {
      this.props.onReset?.();
    } catch (err) {
      reportSwallowed('ErrorBoundary.onReset', err);
    }
    this.setState({
      hasError: false,
      error: null,
      exportStatus: 'idle',
      exportMessage: '',
    });
  };

  private handleReload = (): void => {
    if (typeof window !== 'undefined' && window.location) {
      window.location.reload();
    }
  };

  private handleExportBackup = async (): Promise<void> => {
    if (this.state.exportStatus === 'exporting') return;
    this.setState({ exportStatus: 'exporting', exportMessage: 'Preparing backup...' });
    try {
      const format = await (this.props.onExportBackup ?? exportEmergencySavesBackup)();
      this.setState({
        exportStatus: 'exported',
        exportMessage:
          format === 'binary'
            ? 'Backup downloaded (.capy). Your saves remain safe in local storage.'
            : 'JSON backup downloaded (.json). Your saves remain safe in local storage.',
      });
    } catch (err) {
      reportSwallowed('ErrorBoundary.exportBackup', err);
      this.setState({
        exportStatus: 'error',
        exportMessage: 'Could not export automatically, but local saves were not cleared.',
      });
    }
  };

  render(): React.ReactNode {
    if (!this.state.hasError) {
      return this.props.children;
    }

    const rawMsg = this.state.error?.message?.trim() || 'Unexpected rendering failure';
    const safeMsg = rawMsg.length > 180 ? `${rawMsg.slice(0, 177)}...` : rawMsg;

    return (
      <div
        data-testid="app-error-boundary"
        role="alert"
        className="min-h-[100dvh] w-full bg-slate-950 text-slate-100 flex items-center justify-center p-4"
      >
        <div className="w-full max-w-md rounded-2xl border border-slate-800 bg-slate-900/95 p-5 shadow-2xl space-y-4">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-500/15 border border-amber-400/40 flex items-center justify-center flex-shrink-0">
              <ShieldAlert size={20} className="text-amber-400" />
            </div>
            <div className="min-w-0 flex-1 space-y-1">
              <h1 className="text-base font-bold text-slate-100">
                {this.props.fallbackTitle ?? 'Something went wrong'}
              </h1>
              <p className="text-xs leading-relaxed text-slate-400">
                Capy ran into an unexpected display error. Your puzzles and coloring progress have
                not been erased.
              </p>
            </div>
          </div>

          <div
            data-testid="error-boundary-message"
            className="rounded-xl border border-slate-800 bg-slate-950/80 px-3 py-2 text-[11px] font-mono text-slate-300 break-words"
          >
            {safeMsg}
          </div>

          {this.state.exportMessage && (
            <p
              data-testid="error-boundary-export-status"
              className={`text-xs rounded-xl px-3 py-2 border ${
                this.state.exportStatus === 'error'
                  ? 'bg-rose-950/60 border-rose-500/40 text-rose-200'
                  : 'bg-emerald-950/60 border-emerald-500/40 text-emerald-200'
              }`}
            >
              {this.state.exportMessage}
            </p>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <button
              type="button"
              data-testid="error-boundary-retry-btn"
              onClick={this.handleReset}
              className="flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-bold transition-colors cursor-pointer"
            >
              <RotateCcw size={14} />
              <span>Try Again</span>
            </button>
            <button
              type="button"
              data-testid="error-boundary-reload-btn"
              onClick={this.handleReload}
              className="flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-100 border border-slate-700 text-xs font-semibold transition-colors cursor-pointer"
            >
              <RefreshCw size={14} />
              <span>Reload App</span>
            </button>
          </div>

          <button
            type="button"
            data-testid="error-boundary-export-btn"
            disabled={this.state.exportStatus === 'exporting'}
            onClick={() => void this.handleExportBackup()}
            className="w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl bg-slate-950/80 hover:bg-slate-800/80 text-slate-200 border border-slate-700/80 text-xs font-semibold transition-colors cursor-pointer disabled:opacity-60"
          >
            <Download size={14} className="text-amber-400" />
            <span>
              {this.state.exportStatus === 'exporting'
                ? 'Exporting Backup...'
                : 'Export Saves Backup (.capy)'}
            </span>
          </button>
        </div>
      </div>
    );
  }
}
