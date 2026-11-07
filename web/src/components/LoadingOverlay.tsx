import React from 'react';

interface LoadingOverlayProps {
  isLoading: boolean;
  status: string;
  progress: number;
}

export const LoadingOverlay: React.FC<LoadingOverlayProps> = ({
  isLoading,
  status,
  progress,
}) => {
  if (!isLoading) return null;

  return (
    <div className="fixed inset-0 z-40 pointer-events-none flex items-center justify-center p-4">
      <div className="pointer-events-auto bg-slate-900/95 border border-slate-700/80 rounded-2xl shadow-2xl p-5 max-w-sm w-full backdrop-blur-lg flex flex-col items-center gap-3 animate-in fade-in zoom-in-95 duration-200">
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 rounded-full border-2 border-amber-400 border-t-transparent animate-spin" />
          <h3 className="text-sm font-semibold text-slate-100">{status}</h3>
        </div>

        {/* Progress bar */}
        <div className="w-full h-2 bg-slate-800 rounded-full overflow-hidden">
          <div
            className="h-full bg-amber-400 rounded-full transition-all duration-150 ease-out"
            style={{ width: `${Math.min(100, Math.max(0, Math.round(progress * 100)))}%` }}
          />
        </div>

        <span className="text-xs text-slate-400">
          {Math.min(100, Math.max(0, Math.round(progress * 100)))}%
        </span>
      </div>
    </div>
  );
};
