import React, { useEffect, useRef, useState } from 'react';
import {
  Check,
  Download,
  Edit2,
  HardDrive,
  LayoutGrid,
  List,
  Pin,
  Play,
  Printer,
  RefreshCw,
  RotateCcw,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { SafeLocalStore } from '../../services/storage/SafeLocalStore';
import { SAVES_VIEW_MODE_KEY } from '../../services/storage/StorageKeys';
import { SavedSnapshot, SaveSortOrder, UserSettings } from '../../types';
import { CloudAccountSection } from './CloudAccountSection';
import { SnapshotCard } from './SnapshotCard';
import { SettingsCloudCoopProps, SettingsSavesProps } from './types';

export interface SavesTabProps {
  settings: UserSettings;
  onUpdateSettings: (newSettings: UserSettings) => void;
  saves: SettingsSavesProps;
  cloudCoop?: SettingsCloudCoopProps;
  onOpenStorageAnalyzer: () => void;
  cancelRenameRef: React.MutableRefObject<(() => boolean) | null>;
  onClose: () => void;
}

function sortSnapshots(
  snapshots: SavedSnapshot[],
  activeSnapshotId: string | null,
  saveSortOrder: SaveSortOrder
): SavedSnapshot[] {
  return [...snapshots].sort((a, b) => {
    const aPinned = Boolean(a.isPinned);
    const bPinned = Boolean(b.isPinned);
    if (aPinned !== bPinned) return aPinned ? -1 : 1;

    if (a.id === activeSnapshotId) return -1;
    if (b.id === activeSnapshotId) return 1;

    switch (saveSortOrder) {
      case 'LAST_ACTIVE':
        return b.lastOpened - a.lastOpened;
      case 'DATE':
        return b.timestamp - a.timestamp;
      case 'PERCENT_COMPLETE': {
        const pctA = a.totalCount > 0 ? a.filledCount / a.totalCount : 0;
        const pctB = b.totalCount > 0 ? b.filledCount / b.totalCount : 0;
        return pctB - pctA;
      }
      default:
        return 0;
    }
  });
}

interface SelectedSaveToolbarProps {
  selectedSave: SavedSnapshot;
  activeSnapshotId: string | null;
  renamingId: string | null;
  renameText: string;
  confirmDeleteId: string | null;
  setRenamingId: React.Dispatch<React.SetStateAction<string | null>>;
  setRenameText: React.Dispatch<React.SetStateAction<string>>;
  setConfirmDeleteId: React.Dispatch<React.SetStateAction<string | null>>;
  saves: SettingsSavesProps;
  onClose: () => void;
}

const SelectedSaveToolbar: React.FC<SelectedSaveToolbarProps> = ({
  selectedSave,
  activeSnapshotId,
  renamingId,
  renameText,
  confirmDeleteId,
  setRenamingId,
  setRenameText,
  setConfirmDeleteId,
  saves,
  onClose,
}) => {
  const {
    onLoadSnapshot,
    onReplaySnapshot,
    onRenameSnapshot,
    onTogglePinSnapshot,
    onDeleteSnapshot,
    onExportSnapshot,
    onExportSnapshotSvg,
  } = saves;

  if (renamingId === selectedSave.id) {
    return (
      <div className="pt-2 border-t border-slate-800/80">
        <div className="flex items-center gap-1.5 w-full">
          <input
            type="text"
            aria-label="Rename save title"
            value={renameText}
            onChange={(e) => setRenameText(e.target.value)}
            className="px-2.5 py-1.5 text-xs bg-slate-800 border border-amber-400 rounded-lg text-white focus:outline-none flex-1 min-w-0"
            autoFocus
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                if (renameText.trim()) onRenameSnapshot(selectedSave.id, renameText.trim());
                setRenamingId(null);
              } else if (e.key === 'Escape') {
                e.stopPropagation();
                setRenamingId(null);
              }
            }}
          />
          <button
            type="button"
            data-testid="confirm-rename-btn"
            onClick={() => {
              if (renameText.trim()) onRenameSnapshot(selectedSave.id, renameText.trim());
              setRenamingId(null);
            }}
            className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-bold bg-amber-400 text-slate-950 rounded-lg hover:bg-amber-300 transition-colors shadow active:scale-95 cursor-pointer"
            title="Save Name"
          >
            <Check size={13} />
            <span>Save</span>
          </button>
          <button
            type="button"
            onClick={() => setRenamingId(null)}
            className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold bg-slate-800 text-slate-300 hover:text-white rounded-lg transition-colors cursor-pointer"
            title="Cancel Rename"
          >
            <X size={13} />
            <span>Cancel</span>
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="pt-2 border-t border-slate-800/80">
      <div className="flex flex-wrap items-center gap-1.5">
        {onTogglePinSnapshot && (
          <button
            type="button"
            data-testid="save-action-pin"
            onClick={() => onTogglePinSnapshot(selectedSave.id)}
            title={selectedSave.isPinned ? 'Unpin Save from Top' : 'Pin Save to Top'}
            className={`inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold rounded-lg border transition-colors shadow active:scale-95 cursor-pointer ${
              selectedSave.isPinned
                ? 'bg-amber-400/20 text-amber-300 border-amber-400/60'
                : 'bg-slate-800 hover:bg-slate-700 text-slate-300 border-slate-700'
            }`}
          >
            <Pin size={12} className={selectedSave.isPinned ? 'fill-current rotate-45' : ''} />
            <span>{selectedSave.isPinned ? 'Unpin' : 'Pin'}</span>
          </button>
        )}

        <button
          type="button"
          data-testid="save-action-load"
          onClick={() => {
            onLoadSnapshot(selectedSave);
            onClose();
          }}
          title={
            selectedSave.id === activeSnapshotId ? 'Resume Current Game' : 'Load Selected Save'
          }
          className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-bold bg-amber-400 text-slate-950 rounded-lg hover:bg-amber-300 transition-colors shadow active:scale-95 cursor-pointer"
        >
          <Play size={12} fill="currentColor" />
          <span>{selectedSave.id === activeSnapshotId ? 'Resume' : 'Load'}</span>
        </button>

        {onReplaySnapshot && (
          <button
            type="button"
            data-testid="save-action-replay"
            disabled={selectedSave.filledCount === 0}
            onClick={() => {
              if (selectedSave.filledCount > 0) {
                onReplaySnapshot(selectedSave);
                onClose();
              }
            }}
            title={
              selectedSave.filledCount === 0
                ? 'No regions filled to replay'
                : 'Watch Animated Replay'
            }
            className={`inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-bold rounded-lg border transition-colors shadow active:scale-95 ${
              selectedSave.filledCount === 0
                ? 'bg-slate-900 text-slate-600 border-slate-800 cursor-not-allowed opacity-50'
                : 'bg-slate-800 hover:bg-slate-700 text-amber-300 border-amber-400/40 cursor-pointer'
            }`}
          >
            <Play size={12} />
            <span>Replay</span>
          </button>
        )}

        <button
          type="button"
          data-testid="save-action-rename"
          onClick={() => {
            setRenamingId(selectedSave.id);
            setRenameText(selectedSave.title);
          }}
          title="Rename Save"
          className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded-lg transition-colors shadow active:scale-95 cursor-pointer"
        >
          <Edit2 size={12} />
          <span>Rename</span>
        </button>

        {onExportSnapshot && (
          <button
            type="button"
            data-testid="save-action-export"
            onClick={() => onExportSnapshot(selectedSave.id, selectedSave.title)}
            title="Export Save File (.capy)"
            className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded-lg transition-colors shadow active:scale-95 cursor-pointer"
          >
            <Download size={12} />
            <span>Export</span>
          </button>
        )}

        {onExportSnapshotSvg && (
          <button
            type="button"
            data-testid="save-action-export-svg"
            onClick={() => void onExportSnapshotSvg(selectedSave.id, selectedSave.title)}
            title="Export Printable Vector Coloring Sheet (.svg)"
            className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded-lg transition-colors shadow active:scale-95 cursor-pointer"
          >
            <Printer size={12} className="text-amber-400" />
            <span>SVG Sheet</span>
          </button>
        )}

        {confirmDeleteId === selectedSave.id ? (
          <div className="flex items-center gap-1">
            <button
              type="button"
              data-testid="save-action-confirm-delete"
              onClick={() => {
                onDeleteSnapshot(selectedSave.id);
                setConfirmDeleteId(null);
              }}
              className="px-2.5 py-1.5 text-[11px] font-bold bg-red-600 text-white rounded-lg hover:bg-red-500 cursor-pointer"
            >
              Confirm
            </button>
            <button
              type="button"
              onClick={() => setConfirmDeleteId(null)}
              className="px-2.5 py-1.5 text-[11px] bg-slate-800 text-slate-300 rounded-lg hover:bg-slate-700 cursor-pointer"
            >
              Cancel
            </button>
          </div>
        ) : (
          <button
            type="button"
            data-testid="save-action-delete"
            onClick={() => setConfirmDeleteId(selectedSave.id)}
            title="Delete Save"
            className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold bg-slate-800 hover:bg-red-950/40 text-slate-300 hover:text-red-400 border border-slate-700 hover:border-red-500/40 rounded-lg transition-colors shadow active:scale-95 cursor-pointer"
          >
            <Trash2 size={12} />
            <span>Delete</span>
          </button>
        )}
      </div>
    </div>
  );
};

export const SavesTab: React.FC<SavesTabProps> = ({
  settings,
  onUpdateSettings,
  saves,
  cloudCoop,
  onOpenStorageAnalyzer,
  cancelRenameRef,
  onClose,
}) => {
  const {
    snapshots,
    activeSnapshotId,
    onLoadSnapshot,
    onClearAllSnapshots,
    onResetProgress,
    onExportAllSnapshots,
    onImportSnapshots,
    onRestoreStarterSample,
  } = saves;

  const fileInputRef = useRef<HTMLInputElement>(null);
  const lastTapRef = useRef<{ id: string; time: number }>({ id: '', time: 0 });
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameText, setRenameText] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [confirmClearAll, setConfirmClearAll] = useState(false);
  const [selectedSaveId, setSelectedSaveId] = useState<string | null>(null);
  const [importNotice, setImportNotice] = useState<{ ok: boolean; message: string } | null>(null);
  const [failedThumbSrcs, setFailedThumbSrcs] = useState<Record<string, boolean>>({});
  const [savesViewMode, setSavesViewMode] = useState<'DETAIL' | 'THUMBNAILS'>(() => {
    const stored = SafeLocalStore.getScopedItem(SAVES_VIEW_MODE_KEY);
    return stored === 'DETAIL' || stored === 'THUMBNAILS' ? stored : 'THUMBNAILS';
  });

  useEffect(() => {
    cancelRenameRef.current = () => {
      if (renamingId) {
        setRenamingId(null);
        return true;
      }
      return false;
    };
    return () => {
      cancelRenameRef.current = null;
    };
  }, [renamingId, cancelRenameRef]);

  const handleSetViewMode = (mode: 'DETAIL' | 'THUMBNAILS') => {
    setSavesViewMode(mode);
    SafeLocalStore.setScopedItem(SAVES_VIEW_MODE_KEY, mode);
  };

  const sortedSnapshots = sortSnapshots(snapshots, activeSnapshotId, settings.saveSortOrder);

  const currentSelectedId =
    selectedSaveId && sortedSnapshots.some((s) => s.id === selectedSaveId)
      ? selectedSaveId
      : activeSnapshotId && sortedSnapshots.some((s) => s.id === activeSnapshotId)
        ? activeSnapshotId
        : sortedSnapshots[0]?.id || null;
  const selectedSave = sortedSnapshots.find((s) => s.id === currentSelectedId);

  const handleSaveCardClick = (snap: SavedSnapshot) => {
    const now = Date.now();
    const prev = lastTapRef.current;
    if (prev.id === snap.id && now - prev.time < 350) {
      lastTapRef.current = { id: '', time: 0 };
      onLoadSnapshot(snap);
      onClose();
      return;
    }
    lastTapRef.current = { id: snap.id, time: now };
    setSelectedSaveId(snap.id);
  };

  const handleSaveCardDoubleClick = (snap: SavedSnapshot) => {
    onLoadSnapshot(snap);
    onClose();
  };

  const handleThumbError = (thumbSrc: string) => {
    setFailedThumbSrcs((prev) => ({ ...prev, [thumbSrc]: true }));
  };

  return (
    <div className="space-y-3.5">
      {/* Snapshots Content: List First (Thumbnails Default) or Empty Recovery */}
      {snapshots.length > 0 ? (
        <div data-testid="saves-list-section" data-view-mode={savesViewMode}>
          <div
            data-testid={savesViewMode === 'DETAIL' ? 'saves-list-detail' : 'saves-list-thumbnails'}
            className={
              savesViewMode === 'DETAIL' ? 'space-y-2' : 'grid grid-cols-2 gap-2.5 sm:grid-cols-3'
            }
          >
            {sortedSnapshots.map((snap) => (
              <SnapshotCard
                key={snap.id}
                snapshot={snap}
                variant={savesViewMode === 'DETAIL' ? 'detail' : 'grid'}
                isActive={snap.id === activeSnapshotId}
                isSelected={snap.id === currentSelectedId}
                failedThumbSrcs={failedThumbSrcs}
                onThumbError={handleThumbError}
                onClick={handleSaveCardClick}
                onDoubleClick={handleSaveCardDoubleClick}
              />
            ))}
          </div>
        </div>
      ) : (
        <div
          data-testid="saves-empty-recovery"
          className="text-center py-8 px-4 space-y-3 rounded-xl border border-dashed border-slate-800 bg-slate-950/40 text-slate-400 text-sm"
        >
          <p>
            No saved puzzles yet. Load an image, import a .capy save, or restore the starter
            artwork.
          </p>
          {onRestoreStarterSample && (
            <button
              type="button"
              data-testid="restore-starter-sample-btn"
              onClick={onRestoreStarterSample}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-400 text-slate-950 text-xs font-bold hover:bg-amber-300 transition-colors cursor-pointer"
            >
              <RefreshCw size={13} />
              <span>Restore Capy Forest Starter</span>
            </button>
          )}
        </div>
      )}

      {/* Static Selection, View Mode & Bulk Library Actions */}
      <div
        data-testid="selected-save-action-bar"
        className="p-2.5 sm:p-3 rounded-xl bg-slate-950/85 border border-slate-800 shadow-md space-y-2.5"
      >
        {/* Row 1: Options & View Mode Switcher */}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 sm:gap-2.5">
            <select
              aria-label="Sort saved puzzles"
              value={settings.saveSortOrder}
              onChange={(e) =>
                onUpdateSettings({
                  ...settings,
                  saveSortOrder: e.target.value as SaveSortOrder,
                })
              }
              className="bg-slate-800 text-slate-200 text-xs font-semibold rounded-lg px-2.5 py-1.5 border border-slate-700 cursor-pointer"
            >
              <option value="LAST_ACTIVE">Last Active</option>
              <option value="DATE">Date Created</option>
              <option value="PERCENT_COMPLETE">Completion</option>
            </select>
          </div>

          {/* Detail vs Thumbnails View Mode Toggle */}
          <div className="flex items-center bg-slate-900 p-0.5 rounded-lg border border-slate-800">
            <button
              type="button"
              data-testid="saves-view-detail-btn"
              aria-pressed={savesViewMode === 'DETAIL'}
              onClick={() => handleSetViewMode('DETAIL')}
              title="Detail List View"
              className={`flex items-center gap-1 px-2.5 py-1 text-xs font-semibold rounded-md transition-colors cursor-pointer ${
                savesViewMode === 'DETAIL'
                  ? 'bg-amber-400 text-slate-950 font-bold shadow-xs'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <List size={13} />
              <span>Detail</span>
            </button>
            <button
              type="button"
              data-testid="saves-view-thumbnails-btn"
              aria-pressed={savesViewMode === 'THUMBNAILS'}
              onClick={() => handleSetViewMode('THUMBNAILS')}
              title="Thumbnails Grid View"
              className={`flex items-center gap-1 px-2.5 py-1 text-xs font-semibold rounded-md transition-colors cursor-pointer ${
                savesViewMode === 'THUMBNAILS'
                  ? 'bg-amber-400 text-slate-950 font-bold shadow-xs'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <LayoutGrid size={13} />
              <span>Thumbnails</span>
            </button>
          </div>
        </div>

        {/* Row 2: Selected Save Action Toolbar */}
        {selectedSave && (
          <SelectedSaveToolbar
            selectedSave={selectedSave}
            activeSnapshotId={activeSnapshotId}
            renamingId={renamingId}
            renameText={renameText}
            confirmDeleteId={confirmDeleteId}
            setRenamingId={setRenamingId}
            setRenameText={setRenameText}
            setConfirmDeleteId={setConfirmDeleteId}
            saves={saves}
            onClose={onClose}
          />
        )}

        {/* Row 3: Global Library Actions */}
        <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-800/80">
          <div className="flex flex-wrap items-center gap-2">
            {onImportSnapshots && (
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                title="Import Save (.capy / .json)"
                data-testid="import-save-btn"
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition-colors shadow active:scale-95 cursor-pointer"
              >
                <Upload size={13} className="text-amber-400" />
                <span>Import</span>
              </button>
            )}

            {onExportAllSnapshots && snapshots.length > 0 && (
              <button
                type="button"
                onClick={onExportAllSnapshots}
                title="Export All Saves to Backup File"
                data-testid="export-all-saves-btn"
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition-colors shadow active:scale-95 cursor-pointer"
              >
                <Download size={13} className="text-amber-400" />
                <span>Export All</span>
              </button>
            )}

            {onResetProgress && (
              <button
                type="button"
                onClick={onResetProgress}
                title="Reset Current Puzzle Progress"
                data-testid="reset-progress-btn"
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-amber-300 border border-slate-700 transition-colors shadow active:scale-95 cursor-pointer"
              >
                <RotateCcw size={13} className="text-amber-400" />
                <span>Reset Progress</span>
              </button>
            )}

            <button
              type="button"
              onClick={onOpenStorageAnalyzer}
              aria-haspopup="dialog"
              title="Inspect and manage browser storage usage"
              data-testid="saves-storage-info-btn"
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition-colors shadow active:scale-95 cursor-pointer"
            >
              <HardDrive size={13} className="text-amber-400" />
              <span>Browser Storage</span>
            </button>
          </div>

          {snapshots.length > 0 && (
            <div>
              {confirmClearAll ? (
                <div className="flex items-center gap-2">
                  <span className="text-xs text-red-400 font-semibold">Delete all?</span>
                  <button
                    type="button"
                    onClick={() => {
                      onClearAllSnapshots();
                      setConfirmClearAll(false);
                    }}
                    className="px-2 py-1 text-xs font-bold bg-red-600 text-white rounded-lg hover:bg-red-500 cursor-pointer"
                  >
                    Yes, Delete All
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmClearAll(false)}
                    className="px-2 py-1 text-xs bg-slate-800 text-slate-300 rounded-lg hover:bg-slate-700 cursor-pointer"
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmClearAll(true)}
                  className="px-2 py-1 rounded-lg text-xs font-bold text-red-400 hover:text-red-300 hover:bg-red-950/30 transition-colors cursor-pointer"
                >
                  Delete All Saves
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Inline Accessible Import Status Banner */}
      {importNotice && (
        <div
          role={importNotice.ok ? 'status' : 'alert'}
          data-testid="saves-import-notice"
          className={`flex items-center justify-between gap-2 px-3 py-2 rounded-xl border text-xs font-semibold ${
            importNotice.ok
              ? 'bg-emerald-950/60 border-emerald-500/40 text-emerald-300'
              : 'bg-red-950/60 border-red-500/40 text-red-300'
          }`}
        >
          <span>{importNotice.message}</span>
          <button
            type="button"
            aria-label="Dismiss import message"
            onClick={() => setImportNotice(null)}
            className="capy-icon-btn p-0.5 rounded hover:bg-white/10 cursor-pointer"
          >
            <X size={13} />
          </button>
        </div>
      )}

      {/* Cloud Sync, Share Link, Printable SVG & Co-op Hub */}
      <CloudAccountSection cloudCoop={cloudCoop} />

      {/* Hidden file input for Import */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".capy,.json,application/json,application/octet-stream"
        className="hidden"
        onChange={async (e) => {
          const file = e.target.files?.[0];
          if (e.target) e.target.value = '';
          if (!file || !onImportSnapshots) return;
          try {
            const res = await onImportSnapshots(file);
            if (res && typeof res === 'object' && 'message' in res) {
              setImportNotice({ ok: Boolean(res.ok), message: res.message });
            }
          } catch (err) {
            setImportNotice({
              ok: false,
              message: err instanceof Error ? err.message : 'Failed to import Capy save file.',
            });
          }
        }}
      />
    </div>
  );
};
