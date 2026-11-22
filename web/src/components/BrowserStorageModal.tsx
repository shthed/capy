import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  Database,
  HardDrive,
  Layers,
  RefreshCw,
  ShieldCheck,
  Trash2,
  X,
} from 'lucide-react';
import { NativeBridge } from '../services/NativeBridge';
import {
  analyzeBrowserStorage,
  cleanOrphanedSaveData,
  clearAllCapyStorage,
  clearPreviewChannelData,
  clearStaleAndOfflineCaches,
  formatStorageBytes,
  StorageAnalysisReport,
  StorageCleanupResult,
} from '../services/storage/StorageAnalyzer';

export interface BrowserStorageModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAfterStorageClear?: (opts: { clearedActiveChannel: boolean }) => Promise<void> | void;
}

type CleanupActionId = 'caches' | 'orphans' | 'previews' | 'all';

interface CleanupActionRowProps {
  actionId: CleanupActionId;
  title: string;
  badgeText: string;
  badgeTone: 'safe' | 'warn' | 'danger';
  description: string;
  confirmPrompt: string;
  confirmButtonLabel: string;
  buttonTestId: string;
  confirmTestId: string;
  disabled: boolean;
  isConfirming: boolean;
  isBusy: boolean;
  onRequestConfirm: (id: CleanupActionId) => void;
  onCancelConfirm: () => void;
  onConfirm: (id: CleanupActionId) => void;
}

const BADGE_CLASSES: Record<'safe' | 'warn' | 'danger', string> = {
  safe: 'bg-emerald-950/70 text-emerald-300 border-emerald-500/40',
  warn: 'bg-amber-950/70 text-amber-300 border-amber-500/40',
  danger: 'bg-red-950/70 text-red-300 border-red-500/40',
};

const CleanupActionRow: React.FC<CleanupActionRowProps> = ({
  actionId,
  title,
  badgeText,
  badgeTone,
  description,
  confirmPrompt,
  confirmButtonLabel,
  buttonTestId,
  confirmTestId,
  disabled,
  isConfirming,
  isBusy,
  onRequestConfirm,
  onCancelConfirm,
  onConfirm,
}) => {
  const isDanger = badgeTone === 'danger';
  return (
    <div
      className={`p-3 rounded-xl border space-y-2 ${
        isDanger
          ? 'bg-red-950/20 border-red-900/50'
          : 'bg-slate-950/70 border-slate-800'
      }`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span
              className={`text-xs font-bold ${
                isDanger ? 'text-red-300' : 'text-slate-100'
              }`}
            >
              {title}
            </span>
            <span
              className={`inline-flex items-center px-1.5 py-0.5 rounded-md border text-[10px] font-semibold ${BADGE_CLASSES[badgeTone]}`}
            >
              {badgeText}
            </span>
          </div>
          <p className="text-[11px] text-slate-400 mt-1 leading-relaxed break-words">
            {description}
          </p>
        </div>
      </div>

      {isConfirming ? (
        <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-800/80">
          <span
            className={`text-[11px] font-semibold break-words ${
              isDanger ? 'text-red-300' : 'text-amber-300'
            }`}
          >
            {confirmPrompt}
          </span>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              disabled={isBusy}
              data-testid={confirmTestId}
              onClick={() => onConfirm(actionId)}
              className={`px-2.5 py-1.5 rounded-lg text-xs font-bold text-white transition-colors cursor-pointer disabled:opacity-50 ${
                isDanger
                  ? 'bg-red-600 hover:bg-red-500'
                  : 'bg-amber-600 hover:bg-amber-500'
              }`}
            >
              {isBusy ? 'Working...' : confirmButtonLabel}
            </button>
            <button
              type="button"
              disabled={isBusy}
              onClick={onCancelConfirm}
              className="px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-200 transition-colors cursor-pointer disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="flex justify-end">
          <button
            type="button"
            disabled={disabled || isBusy}
            data-testid={buttonTestId}
            onClick={() => onRequestConfirm(actionId)}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors cursor-pointer disabled:opacity-45 disabled:cursor-not-allowed ${
              isDanger
                ? 'bg-red-950/60 hover:bg-red-900/70 text-red-200 border-red-700/60'
                : 'bg-slate-800 hover:bg-slate-700 text-slate-100 border-slate-700'
            }`}
          >
            <Trash2 size={12} />
            <span>{disabled ? 'Already Clean' : title}</span>
          </button>
        </div>
      )}
    </div>
  );
};

interface BreakdownMetricRowProps {
  label: string;
  value: string;
  detail?: string;
  tone?: 'default' | 'amber' | 'muted';
}

const BreakdownMetricRow: React.FC<BreakdownMetricRowProps> = ({
  label,
  value,
  detail,
  tone = 'default',
}) => {
  const valueClass =
    tone === 'amber'
      ? 'text-amber-300 font-bold'
      : tone === 'muted'
        ? 'text-slate-400 font-medium'
        : 'text-slate-100 font-semibold';
  return (
    <div className="flex items-start justify-between gap-2 text-xs py-1 border-b border-slate-800/60 last:border-b-0">
      <div className="min-w-0 flex-1">
        <div className="text-slate-300 break-words">{label}</div>
        {detail && <div className="text-[11px] text-slate-500 break-words">{detail}</div>}
      </div>
      <span className={`shrink-0 tabular-nums ${valueClass}`}>{value}</span>
    </div>
  );
};

function formatUsageDetailLabel(rawKey: string): string {
  const normalized = rawKey.toLowerCase();
  if (normalized === 'caches') return 'Caches';
  if (normalized === 'indexeddb') return 'IndexedDB';
  if (normalized === 'serviceworkerregistrations') return 'Service Workers';
  if (normalized === 'filesystem') return 'File System';
  return rawKey;
}

function summarizeCleanupResult(actionId: CleanupActionId, res: StorageCleanupResult): string {
  const parts: string[] = [];
  if (res.freedBytesEstimate > 0) {
    parts.push(`Freed ~${formatStorageBytes(res.freedBytesEstimate)}`);
  }
  if (res.deletedCaches > 0) {
    parts.push(`${res.deletedCaches} cache${res.deletedCaches === 1 ? '' : 's'}`);
  }
  if (res.deletedIdbRecords > 0) {
    parts.push(`${res.deletedIdbRecords} orphaned record${res.deletedIdbRecords === 1 ? '' : 's'}`);
  }
  if (res.deletedIdbDatabases > 0) {
    parts.push(
      `${res.deletedIdbDatabases} database${res.deletedIdbDatabases === 1 ? '' : 's'}`
    );
  }
  if (res.deletedLocalKeys > 0) {
    parts.push(`${res.deletedLocalKeys} stored key${res.deletedLocalKeys === 1 ? '' : 's'}`);
  }
  if (res.unregisteredWorkers > 0) {
    parts.push(
      `${res.unregisteredWorkers} stale service worker${res.unregisteredWorkers === 1 ? '' : 's'}`
    );
  }

  const warningSuffix = res.warnings.length > 0 ? ` Note: ${res.warnings[0]}` : '';
  if (parts.length === 0) {
    const label =
      actionId === 'caches'
        ? 'No Capy caches needed clearing.'
        : actionId === 'orphans'
          ? 'No orphaned save records found.'
          : actionId === 'previews'
            ? 'No Alpha or Beta preview data found.'
            : 'Capy storage is already clear.';
    return `${label}${warningSuffix}`;
  }
  return `Cleaned (${parts.join(', ')}).${warningSuffix}`;
}

function renderQuotaSummary(report: StorageAnalysisReport): React.ReactNode {
  const { browserEstimate } = report;
  const pct =
    browserEstimate.usageBytes !== null &&
    browserEstimate.quotaBytes !== null &&
    browserEstimate.quotaBytes > 0
      ? Math.min(100, (browserEstimate.usageBytes / browserEstimate.quotaBytes) * 100)
      : null;

  return (
    <section
      data-testid="storage-quota-summary"
      className="p-3 rounded-xl bg-slate-950/80 border border-slate-800 space-y-2.5"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-xs font-bold text-slate-100">
          <HardDrive size={14} className="text-amber-400 shrink-0" />
          <span>Browser Origin Quota</span>
        </div>
        <span className="text-xs font-bold text-amber-300 tabular-nums">
          {browserEstimate.supported && browserEstimate.usageBytes !== null
            ? browserEstimate.quotaBytes !== null
              ? `${formatStorageBytes(browserEstimate.usageBytes)} / ${formatStorageBytes(browserEstimate.quotaBytes)}`
              : formatStorageBytes(browserEstimate.usageBytes)
            : 'Unavailable'}
        </span>
      </div>

      {pct !== null && (
        <div className="w-full h-2 rounded-full bg-slate-800 overflow-hidden">
          <div
            className="h-full rounded-full bg-amber-400 transition-all"
            style={{ width: `${Math.max(pct > 0 ? 2 : 0, pct)}%` }}
          />
        </div>
      )}

      <div className="space-y-0.5">
        <BreakdownMetricRow
          label="Measured Capy Data"
          value={formatStorageBytes(report.totalCapyMeasuredBytes)}
          detail={`Active channel: ${report.activeChannel}`}
        />
        {report.totalReclaimableSafeBytes > 0 && (
          <BreakdownMetricRow
            label="Reclaimable Safely (Stale Caches + Orphans)"
            value={formatStorageBytes(report.totalReclaimableSafeBytes)}
            tone="amber"
          />
        )}
        {report.unattributedBrowserBytes > 0 && (
          <BreakdownMetricRow
            label="Browser Overhead / Other Site Apps"
            value={formatStorageBytes(report.unattributedBrowserBytes)}
            detail="Engine padding, WAL files, or other apps on this origin"
            tone="muted"
          />
        )}
      </div>

      {browserEstimate.usageDetails && (
        <div className="flex flex-wrap gap-1.5 pt-1">
          {Object.entries(browserEstimate.usageDetails).map(([key, bytes]) => (
            <span
              key={key}
              className="px-2 py-0.5 rounded-md bg-slate-900 border border-slate-800 text-[10px] text-slate-300 tabular-nums"
            >
              {formatUsageDetailLabel(key)}: {formatStorageBytes(bytes)}
            </span>
          ))}
        </div>
      )}
    </section>
  );
}

function renderCacheSection(report: StorageAnalysisReport): React.ReactNode {
  const { cacheStorage } = report;
  return (
    <section
      data-testid="storage-section-caches"
      className="p-3 rounded-xl bg-slate-950/70 border border-slate-800 space-y-2"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-xs font-bold text-slate-100">
          <Layers size={14} className="text-sky-400 shrink-0" />
          <span>Offline &amp; App Caches (CacheStorage)</span>
        </div>
        <span className="text-xs font-bold text-slate-200 tabular-nums">
          {cacheStorage.supported ? formatStorageBytes(cacheStorage.totalBytes) : 'Unavailable'}
        </span>
      </div>

      {cacheStorage.supported ? (
        <>
          <div className="space-y-0.5">
            <BreakdownMetricRow
              label="Current App Cache"
              value={formatStorageBytes(cacheStorage.currentAppBytes)}
              detail={report.activeScopePath}
            />
            <BreakdownMetricRow
              label={`Stale Alpha PR Previews (${cacheStorage.staleAlphaCount})`}
              value={formatStorageBytes(cacheStorage.staleAlphaBytes)}
              tone={cacheStorage.staleAlphaCount > 0 ? 'amber' : 'muted'}
            />
            {cacheStorage.staleVersionCount > 0 && (
              <BreakdownMetricRow
                label={`Older App Cache Versions (${cacheStorage.staleVersionCount})`}
                value={formatStorageBytes(cacheStorage.staleVersionBytes)}
                tone="amber"
              />
            )}
            <BreakdownMetricRow
              label="Sibling Beta / Production Caches"
              value={formatStorageBytes(cacheStorage.siblingBetaProdBytes)}
              tone={cacheStorage.siblingBetaProdBytes > 0 ? 'default' : 'muted'}
            />
            {cacheStorage.otherOriginCount > 0 && (
              <BreakdownMetricRow
                label={`Other Origin Caches (${cacheStorage.otherOriginCount})`}
                value={formatStorageBytes(cacheStorage.otherOriginBytes)}
                detail="Protected — never modified by Capy"
                tone="muted"
              />
            )}
          </div>

          {cacheStorage.caches.length > 0 && (
            <details className="pt-1">
              <summary className="text-[11px] font-semibold text-slate-400 hover:text-slate-200 cursor-pointer select-none">
                View {cacheStorage.caches.length} cache bucket
                {cacheStorage.caches.length === 1 ? '' : 's'}
              </summary>
              <div className="mt-2 space-y-1">
                {cacheStorage.caches.map((entry) => (
                  <div
                    key={entry.name}
                    className="flex items-center justify-between gap-2 text-[11px] px-2 py-1 rounded-lg bg-slate-900/90 border border-slate-800/80"
                  >
                    <span className="text-slate-300 truncate min-w-0 flex-1" title={entry.name}>
                      {entry.name}
                    </span>
                    <span className="text-slate-400 shrink-0 tabular-nums">
                      {entry.entryCount} files · {formatStorageBytes(entry.bytes)}
                    </span>
                  </div>
                ))}
              </div>
            </details>
          )}
        </>
      ) : (
        <p className="text-[11px] text-slate-500">CacheStorage is unavailable in this context.</p>
      )}
    </section>
  );
}

function renderIndexedDbSection(report: StorageAnalysisReport): React.ReactNode {
  const { indexedDb } = report;
  const activeDb = indexedDb.activeDb;
  return (
    <section
      data-testid="storage-section-idb"
      className="p-3 rounded-xl bg-slate-950/70 border border-slate-800 space-y-2"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-xs font-bold text-slate-100">
          <Database size={14} className="text-emerald-400 shrink-0" />
          <span>Saved Puzzles &amp; Images (IndexedDB)</span>
        </div>
        <span className="text-xs font-bold text-slate-200 tabular-nums">
          {indexedDb.supported ? formatStorageBytes(indexedDb.totalBytes) : 'Unavailable'}
        </span>
      </div>

      {indexedDb.supported ? (
        <div className="space-y-0.5">
          {activeDb ? (
            <>
              <BreakdownMetricRow
                label={`Puzzles (${activeDb.puzzlesCount})`}
                value={formatStorageBytes(activeDb.puzzlesBytes)}
                detail={activeDb.dbName}
              />
              <BreakdownMetricRow
                label={`Custom Images (${activeDb.imagesCount})`}
                value={formatStorageBytes(activeDb.imagesBytes)}
              />
              <BreakdownMetricRow
                label={`Thumbnails (${activeDb.previewsCount})`}
                value={formatStorageBytes(activeDb.previewsBytes)}
              />
              <BreakdownMetricRow
                label={`Orphaned Records (${activeDb.orphanedCount})`}
                value={formatStorageBytes(activeDb.orphanedBytes)}
                detail={
                  activeDb.orphanDetectionSkipped
                    ? 'Skipped while save metadata could not be verified'
                    : activeDb.orphanedCount > 0
                      ? 'Unreferenced records safe to reclaim'
                      : 'None found'
                }
                tone={activeDb.orphanedCount > 0 ? 'amber' : 'muted'}
              />
            </>
          ) : (
            <BreakdownMetricRow
              label="Active Channel Database"
              value="0 B"
              detail={report.activeDbName}
              tone="muted"
            />
          )}

          {indexedDb.siblingPreviewDbs.map((db) => (
            <BreakdownMetricRow
              key={db.dbName}
              label={`Preview Channel DB (${db.channel})`}
              value={formatStorageBytes(db.totalBytes)}
              detail={`${db.dbName} · ${db.puzzlesCount} puzzles, ${db.imagesCount} images`}
              tone="amber"
            />
          ))}

          {indexedDb.siblingProdDbs.map((db) => (
            <BreakdownMetricRow
              key={db.dbName}
              label={`Sibling Production DB (${db.channel})`}
              value={formatStorageBytes(db.totalBytes)}
              detail={db.dbName}
              tone="muted"
            />
          ))}

          {indexedDb.otherOriginDbNames.length > 0 && (
            <BreakdownMetricRow
              label={`Other Origin Databases (${indexedDb.otherOriginDbNames.length})`}
              value="Protected"
              detail="Never opened or modified by Capy"
              tone="muted"
            />
          )}
        </div>
      ) : (
        <p className="text-[11px] text-slate-500">IndexedDB is unavailable in this context.</p>
      )}
    </section>
  );
}

function renderLocalStoreSection(report: StorageAnalysisReport): React.ReactNode {
  const { localStore } = report;
  return (
    <section
      data-testid="storage-section-local"
      className="p-3 rounded-xl bg-slate-950/70 border border-slate-800 space-y-2"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-xs font-bold text-slate-100">
          <ShieldCheck size={14} className="text-violet-400 shrink-0" />
          <span>App Settings &amp; Metadata (Local Storage)</span>
        </div>
        <span className="text-xs font-bold text-slate-200 tabular-nums">
          {localStore.supported ? formatStorageBytes(localStore.totalBytes) : 'Unavailable'}
        </span>
      </div>

      {localStore.supported ? (
        <div className="space-y-0.5">
          <BreakdownMetricRow
            label={`Active Channel Keys (${localStore.currentChannelCount})`}
            value={formatStorageBytes(localStore.currentChannelBytes)}
          />
          {localStore.previewChannelsCount > 0 && (
            <BreakdownMetricRow
              label={`Preview Channel Keys (${localStore.previewChannelsCount})`}
              value={formatStorageBytes(localStore.previewChannelsBytes)}
              tone="amber"
            />
          )}
          {localStore.prodChannelCount > 0 && (
            <BreakdownMetricRow
              label={`Production Channel Keys (${localStore.prodChannelCount})`}
              value={formatStorageBytes(localStore.prodChannelBytes)}
              tone="muted"
            />
          )}
          {localStore.quarantineCount > 0 && (
            <BreakdownMetricRow
              label={`Quarantined Backup Keys (${localStore.quarantineCount})`}
              value={formatStorageBytes(localStore.quarantineBytes)}
              tone="amber"
            />
          )}
          {localStore.otherOriginCount > 0 && (
            <BreakdownMetricRow
              label={`Other Origin Keys (${localStore.otherOriginCount})`}
              value={formatStorageBytes(localStore.otherOriginBytes)}
              detail="Protected — never modified by Capy"
              tone="muted"
            />
          )}
        </div>
      ) : (
        <p className="text-[11px] text-slate-500">Local Storage is unavailable in this context.</p>
      )}
    </section>
  );
}

export const BrowserStorageModal: React.FC<BrowserStorageModalProps> = ({
  isOpen,
  onClose,
  onAfterStorageClear,
}) => {
  const [report, setReport] = useState<StorageAnalysisReport | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [confirmingAction, setConfirmingAction] = useState<CleanupActionId | null>(null);
  const [busyAction, setBusyAction] = useState<CleanupActionId | null>(null);
  const [actionNotice, setActionNotice] = useState<string | null>(null);

  const runScan = useCallback(async () => {
    setIsLoading(true);
    setErrorMsg(null);
    try {
      const next = await analyzeBrowserStorage();
      setReport(next);
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : 'Unable to analyze browser storage right now.'
      );
    } finally {
      setIsLoading(false);
    }
  }, []);

  const handleClose = useCallback(() => {
    setConfirmingAction(null);
    setActionNotice(null);
    onClose();
  }, [onClose]);

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    const load = async () => {
      setIsLoading(true);
      setErrorMsg(null);
      setConfirmingAction(null);
      setActionNotice(null);
      try {
        const next = await analyzeBrowserStorage();
        if (!cancelled) {
          setReport(next);
        }
      } catch (err) {
        if (!cancelled) {
          setErrorMsg(
            err instanceof Error ? err.message : 'Unable to analyze browser storage right now.'
          );
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    return NativeBridge.pushBackHandler(handleClose);
  }, [isOpen, handleClose]);

  const executeCleanup = useCallback(
    async (actionId: CleanupActionId) => {
      setBusyAction(actionId);
      setErrorMsg(null);
      try {
        let res: StorageCleanupResult;
        let clearedActiveChannel = false;
        if (actionId === 'caches') {
          res = await clearStaleAndOfflineCaches();
        } else if (actionId === 'orphans') {
          res = await cleanOrphanedSaveData();
        } else if (actionId === 'previews') {
          const previewRes = await clearPreviewChannelData();
          res = previewRes;
          clearedActiveChannel = previewRes.affectedActiveChannel;
        } else {
          const allRes = await clearAllCapyStorage();
          res = allRes;
          clearedActiveChannel = allRes.affectedActiveChannel;
        }

        setConfirmingAction(null);
        setActionNotice(summarizeCleanupResult(actionId, res));
        if (clearedActiveChannel && onAfterStorageClear) {
          await onAfterStorageClear({ clearedActiveChannel: true });
        }
        await runScan();
      } catch (err) {
        setErrorMsg(
          err instanceof Error ? err.message : 'Failed to complete storage cleanup.'
        );
      } finally {
        setBusyAction(null);
      }
    },
    [onAfterStorageClear, runScan]
  );

  if (!isOpen) return null;

  const hasCapyCaches = Boolean(
    report &&
      report.cacheStorage.caches.some((c) => c.category !== 'otherOrigin')
  );
  const hasOrphans = Boolean(
    report &&
      ((report.indexedDb.activeDb &&
        !report.indexedDb.activeDb.orphanDetectionSkipped &&
        report.indexedDb.activeDb.orphanedCount > 0) ||
        report.localStore.quarantineCount > 0)
  );
  const hasPreviewData = Boolean(
    report &&
      (report.cacheStorage.staleAlphaCount > 0 ||
        report.cacheStorage.caches.some((c) => c.category === 'siblingBeta') ||
        report.indexedDb.siblingPreviewDbs.length > 0 ||
        report.localStore.previewChannelsCount > 0 ||
        report.activeChannel === 'alpha' ||
        report.activeChannel === 'beta')
  );
  const hasAnyCapyData = Boolean(
    report &&
      (report.totalCapyMeasuredBytes > 0 ||
        hasCapyCaches ||
        hasPreviewData ||
        report.localStore.currentChannelCount > 0)
  );

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/80 backdrop-blur-sm sm:p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget && !busyAction) {
          handleClose();
        }
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Browser Storage"
        data-testid="browser-storage-modal"
        className="w-full h-full sm:h-auto sm:max-h-[85vh] sm:max-w-xl bg-slate-900 sm:border sm:border-slate-800 sm:rounded-2xl shadow-2xl flex flex-col overflow-hidden"
      >
        <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-slate-800 bg-slate-950/70 shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <HardDrive size={16} className="text-amber-400 shrink-0" />
            <h2 className="text-sm font-bold text-slate-100 truncate">Browser Storage</h2>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              disabled={isLoading || busyAction !== null}
              data-testid="storage-refresh-btn"
              onClick={() => void runScan()}
              title="Refresh storage breakdown"
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition-colors cursor-pointer disabled:opacity-50"
            >
              <RefreshCw size={13} className={isLoading ? 'animate-spin' : ''} />
              <span>Refresh</span>
            </button>
            <button
              type="button"
              disabled={busyAction !== null}
              data-testid="storage-close-btn"
              onClick={handleClose}
              aria-label="Close Browser Storage"
              className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer disabled:opacity-50"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-3.5 sm:p-4 space-y-3">
          {errorMsg && (
            <div
              role="alert"
              data-testid="storage-error"
              className="flex items-start gap-2 px-3 py-2 rounded-xl bg-red-950/60 border border-red-500/40 text-xs text-red-200"
            >
              <AlertTriangle size={14} className="text-red-400 shrink-0 mt-0.5" />
              <span className="break-words">{errorMsg}</span>
            </div>
          )}

          {actionNotice && (
            <div
              role="status"
              data-testid="storage-action-notice"
              className="px-3 py-2 rounded-xl bg-emerald-950/60 border border-emerald-500/40 text-xs font-semibold text-emerald-200 break-words"
            >
              {actionNotice}
            </div>
          )}

          {isLoading && !report ? (
            <div
              data-testid="storage-loading"
              className="py-10 flex flex-col items-center justify-center gap-2 text-xs text-slate-400"
            >
              <RefreshCw size={18} className="animate-spin text-amber-400" />
              <span>Analyzing browser storage...</span>
            </div>
          ) : report ? (
            <>
              {renderQuotaSummary(report)}
              {renderCacheSection(report)}
              {renderIndexedDbSection(report)}
              {renderLocalStoreSection(report)}

              <section data-testid="storage-cleanup-actions" className="space-y-2.5 pt-1">
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 px-0.5">
                  Safe Cleanup Actions
                </h3>

                <CleanupActionRow
                  actionId="caches"
                  title="Clear Stale & Offline Caches"
                  badgeText="Zero save loss"
                  badgeTone="safe"
                  description="Deletes stale PR preview caches and recreatable offline app caches. Your saved puzzles and settings stay intact."
                  confirmPrompt="Clear Capy offline and stale preview caches?"
                  confirmButtonLabel="Confirm Clear"
                  buttonTestId="storage-clean-caches-btn"
                  confirmTestId="storage-clean-caches-confirm"
                  disabled={!hasCapyCaches}
                  isConfirming={confirmingAction === 'caches'}
                  isBusy={busyAction === 'caches'}
                  onRequestConfirm={setConfirmingAction}
                  onCancelConfirm={() => setConfirmingAction(null)}
                  onConfirm={(id) => void executeCleanup(id)}
                />

                <CleanupActionRow
                  actionId="orphans"
                  title="Clean Orphaned Save Data"
                  badgeText="Zero save loss"
                  badgeTone="safe"
                  description="Removes unreferenced puzzle, custom image, and thumbnail entries not linked to any active save."
                  confirmPrompt="Remove unreferenced orphaned records?"
                  confirmButtonLabel="Confirm Clean"
                  buttonTestId="storage-clean-orphans-btn"
                  confirmTestId="storage-clean-orphans-confirm"
                  disabled={!hasOrphans}
                  isConfirming={confirmingAction === 'orphans'}
                  isBusy={busyAction === 'orphans'}
                  onRequestConfirm={setConfirmingAction}
                  onCancelConfirm={() => setConfirmingAction(null)}
                  onConfirm={(id) => void executeCleanup(id)}
                />

                <CleanupActionRow
                  actionId="previews"
                  title="Clear Preview Channel Data (Alpha/Beta)"
                  badgeText="Zero Production save loss"
                  badgeTone="warn"
                  description="Removes Alpha and Beta preview caches, sandboxed keys, and preview databases without touching Production saves."
                  confirmPrompt="Delete Alpha and Beta preview channel data?"
                  confirmButtonLabel="Confirm Clear"
                  buttonTestId="storage-clean-previews-btn"
                  confirmTestId="storage-clean-previews-confirm"
                  disabled={!hasPreviewData}
                  isConfirming={confirmingAction === 'previews'}
                  isBusy={busyAction === 'previews'}
                  onRequestConfirm={setConfirmingAction}
                  onCancelConfirm={() => setConfirmingAction(null)}
                  onConfirm={(id) => void executeCleanup(id)}
                />

                <CleanupActionRow
                  actionId="all"
                  title="Clear All Capy Storage"
                  badgeText="Erases all saves"
                  badgeTone="danger"
                  description="Erases all Capy saved puzzles, custom uploads, settings, and offline caches across channels. Other apps on this site are protected."
                  confirmPrompt="Erase all saved puzzles, settings, and offline caches?"
                  confirmButtonLabel="Yes, Clear Everything"
                  buttonTestId="storage-clean-all-btn"
                  confirmTestId="storage-clean-all-confirm"
                  disabled={!hasAnyCapyData}
                  isConfirming={confirmingAction === 'all'}
                  isBusy={busyAction === 'all'}
                  onRequestConfirm={setConfirmingAction}
                  onCancelConfirm={() => setConfirmingAction(null)}
                  onConfirm={(id) => void executeCleanup(id)}
                />
              </section>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
};
