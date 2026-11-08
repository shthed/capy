import React from 'react';
import { Download, Sparkles, X, Trophy, RefreshCw } from 'lucide-react';

interface VictoryModalProps {
  isOpen: boolean;
  title: string;
  regionCount: number;
  previewDataUrl?: string;
  onClose: () => void;
  onExportImage: () => void;
  onOpenCreate: () => void;
}

export const VictoryModal: React.FC<VictoryModalProps> = ({
  isOpen,
  title,
  regionCount,
  previewDataUrl,
  onClose,
  onExportImage,
  onOpenCreate,
}) => {
  if (!isOpen) return null;

  return (
    <div
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-in fade-in duration-200 select-none cursor-pointer"
      style={{
        paddingTop: 'max(1rem, calc(var(--sat, 0px) + 0.75rem))',
        paddingBottom: 'max(1rem, calc(var(--sab, 0px) + 0.75rem))',
        paddingLeft: 'max(1rem, calc(var(--sal, 0px) + 0.75rem))',
        paddingRight: 'max(1rem, calc(var(--sar, 0px) + 0.75rem))',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative w-full max-w-md bg-slate-900 border border-amber-400/50 rounded-3xl shadow-2xl overflow-hidden text-slate-100 flex flex-col items-center p-6 text-center animate-in zoom-in-95 duration-300 ring-2 ring-amber-400/20 cursor-auto"
      >
        {/* Close Button */}
        <button
          type="button"
          onClick={onClose}
          className="absolute top-4 right-4 p-2 rounded-full text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          title="Close celebration"
        >
          <X size={20} />
        </button>

        {/* Celebration Trophy Icon */}
        <div className="w-16 h-16 rounded-2xl bg-amber-400/20 border border-amber-400/40 flex items-center justify-center mb-3 text-amber-400 shadow-inner">
          <Trophy size={32} className="animate-bounce" />
        </div>

        {/* Title & Badge */}
        <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-400/10 border border-amber-400/30 text-amber-400 text-xs font-bold uppercase tracking-wider mb-2">
          <Sparkles size={13} />
          <span>Completed 100%</span>
        </div>

        <h2 className="text-2xl font-black tracking-tight text-white mb-1">
          {title || 'Masterpiece'}
        </h2>
        <p className="text-sm text-slate-400 mb-4">
          All {regionCount} regions beautifully colored!
        </p>

        {/* Artwork Thumbnail Preview */}
        {previewDataUrl && (
          <div className="relative w-48 h-48 rounded-2xl overflow-hidden border-2 border-slate-700/80 shadow-2xl mb-5 group bg-slate-950 flex items-center justify-center">
            <img
              src={previewDataUrl}
              alt={title}
              className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
            />
          </div>
        )}

        {/* Action Buttons */}
        <div className="w-full flex flex-col gap-2.5">
          <button
            type="button"
            onClick={onExportImage}
            className="w-full py-3 px-4 rounded-xl font-bold text-sm bg-gradient-to-r from-amber-400 to-amber-500 hover:from-amber-300 hover:to-amber-400 text-slate-950 shadow-lg shadow-amber-400/20 flex items-center justify-center gap-2 transition-all active:scale-95"
          >
            <Download size={18} />
            <span>Save & Download Artwork (PNG)</span>
          </button>

          <button
            type="button"
            onClick={onOpenCreate}
            className="w-full py-2.5 px-4 rounded-xl font-semibold text-sm bg-slate-800/90 hover:bg-slate-700 text-slate-200 border border-slate-700/80 flex items-center justify-center gap-2 transition-all active:scale-95"
          >
            <RefreshCw size={17} />
            <span>Pick Next Artwork</span>
          </button>

          <button
            type="button"
            onClick={onClose}
            className="w-full py-2 text-xs font-medium text-slate-400 hover:text-slate-200 transition-colors"
          >
            Return to Canvas
          </button>
        </div>
      </div>
    </div>
  );
};
