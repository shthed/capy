import React from 'react';
import { Image as ImageIcon, Pin } from 'lucide-react';
import { computeProgressPercentage, SavedSnapshot } from '../../types';
import { resolveSafeSnapshotThumbnail } from '../../utils/snapshotPaths';

export interface SnapshotCardProps {
  snapshot: SavedSnapshot;
  variant: 'detail' | 'grid';
  isActive: boolean;
  isSelected: boolean;
  failedThumbSrcs: Record<string, boolean>;
  onThumbError: (thumbSrc: string) => void;
  onClick: (snapshot: SavedSnapshot) => void;
  onDoubleClick: (snapshot: SavedSnapshot) => void;
}

export const SnapshotCard: React.FC<SnapshotCardProps> = ({
  snapshot,
  variant,
  isActive,
  isSelected,
  failedThumbSrcs,
  onThumbError,
  onClick,
  onDoubleClick,
}) => {
  const progressPct = computeProgressPercentage(snapshot.filledCount, snapshot.totalCount);
  const { thumbSrc } = resolveSafeSnapshotThumbnail(snapshot, failedThumbSrcs);
  const cardTitle = isActive
    ? 'Active save (double-tap to resume game)'
    : 'Double-tap to load save and close settings';

  if (variant === 'detail') {
    return (
      <div
        data-testid={`save-card-${snapshot.id}`}
        onClick={() => onClick(snapshot)}
        onDoubleClick={() => onDoubleClick(snapshot)}
        title={cardTitle}
        className={`relative flex items-center gap-3 p-2.5 rounded-xl border transition-all cursor-pointer select-none ${
          isSelected
            ? 'border-amber-400 bg-amber-500/15 shadow-md ring-2 ring-amber-400/60'
            : isActive
              ? 'border-amber-500/50 bg-slate-950/60 hover:bg-slate-850'
              : 'border-slate-800 bg-slate-950/40 hover:bg-slate-800/40 hover:border-slate-700'
        }`}
      >
        {/* Larger Thumbnail Preview */}
        <div className="w-16 h-16 sm:w-18 sm:h-18 rounded-xl bg-slate-900 border border-slate-700/80 overflow-hidden flex-shrink-0 flex items-center justify-center relative shadow-inner">
          {thumbSrc ? (
            <img
              src={thumbSrc}
              alt={snapshot.title}
              onError={() => onThumbError(thumbSrc)}
              className="w-full h-full object-cover"
            />
          ) : (
            <ImageIcon size={22} className="text-slate-500" />
          )}
        </div>

        {/* Info & Title */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <h4 className="text-xs sm:text-sm font-bold text-slate-200 truncate">
              {snapshot.title}
            </h4>
            {snapshot.isPinned && (
              <Pin size={11} className="text-amber-400 fill-amber-400 flex-shrink-0" />
            )}
          </div>

          <div className="flex items-center gap-1.5 mt-0.5 text-[11px] text-slate-400 font-medium">
            <span className="text-amber-400 font-bold">{progressPct}%</span>
            {snapshot.fileSizeBytes && snapshot.fileSizeBytes > 0 ? (
              <>
                <span>•</span>
                <span>{Math.max(1, Math.round(snapshot.fileSizeBytes / 1024))} KB</span>
              </>
            ) : null}
          </div>

          {/* Subtle Progress Bar */}
          <div className="w-full bg-slate-800/80 rounded-full h-1.5 mt-2 overflow-hidden">
            <div
              className="bg-amber-400 h-full rounded-full transition-all"
              style={{ width: `${progressPct}%` }}
            />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      data-testid={`save-card-${snapshot.id}`}
      onClick={() => onClick(snapshot)}
      onDoubleClick={() => onDoubleClick(snapshot)}
      title={cardTitle}
      className={`group relative flex flex-col rounded-xl border overflow-hidden transition-all cursor-pointer select-none ${
        isSelected
          ? 'border-amber-400 bg-amber-500/15 ring-2 ring-amber-400/60 shadow-lg'
          : isActive
            ? 'border-amber-500/50 bg-slate-900/60 hover:bg-slate-850'
            : 'border-slate-800 bg-slate-950/40 hover:bg-slate-800/40 hover:border-slate-700'
      }`}
    >
      {/* Rectangular Image Preview */}
      <div className="relative w-full aspect-[4/3] bg-slate-900 overflow-hidden flex items-center justify-center">
        {thumbSrc ? (
          <img
            src={thumbSrc}
            alt={snapshot.title}
            onError={() => onThumbError(thumbSrc)}
            className="w-full h-full object-cover transition-transform duration-200 group-hover:scale-105"
          />
        ) : (
          <ImageIcon size={28} className="text-slate-600" />
        )}

        {/* Pin Badge if Pinned */}
        {snapshot.isPinned && (
          <div className="absolute top-1.5 left-1.5 bg-slate-950/85 backdrop-blur-xs text-amber-400 p-1 rounded-md border border-slate-700/60 shadow-sm">
            <Pin size={10} className="fill-current" />
          </div>
        )}

        {/* Floating Percentage Badge */}
        <div className="absolute top-1.5 right-1.5 bg-slate-950/85 backdrop-blur-xs text-amber-400 text-[11px] font-black px-1.5 py-0.5 rounded-md border border-slate-700/60 shadow-sm">
          {progressPct}%
        </div>

        {/* Progress Bar Line */}
        <div className="absolute bottom-0 left-0 right-0 h-1 bg-slate-900/80">
          <div className="h-full bg-amber-400 transition-all" style={{ width: `${progressPct}%` }} />
        </div>
      </div>

      {/* Title Footer */}
      <div className="p-2 flex items-center justify-between gap-1">
        <span className="text-xs font-bold text-slate-200 truncate" title={snapshot.title}>
          {snapshot.title}
        </span>
      </div>
    </div>
  );
};
