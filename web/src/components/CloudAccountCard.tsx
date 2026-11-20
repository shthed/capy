import React, { useState } from 'react';
import { Cloud, Edit2, RefreshCw } from 'lucide-react';
import {
  CloudProviderDescriptor,
  CloudProviderId,
  PlayerIdentity,
} from '../services/providers/types';
import {
  COLLABORATOR_AVATAR_COLORS,
  ProviderRegistry,
} from '../services/providers/ProviderRegistry';
import { NativeBridge } from '../services/NativeBridge';

export type CloudSyncLiveStatus = 'idle' | 'syncing' | 'synced' | 'offline' | 'error';

export interface CloudSyncSummaryPayload {
  addedFromCloud: number;
  syncedAt: number;
  uploadedCount?: number;
  downloadedCount?: number;
  backend?: string;
}

export interface CloudAccountCardProps {
  playerIdentity: PlayerIdentity;
  cloudProviders: CloudProviderDescriptor[];
  isSyncingCloud: boolean;
  cloudSyncStatus?: CloudSyncLiveStatus;
  lastCloudSyncError?: string | null;
  onSyncingChange: (syncing: boolean) => void;
  onHubNotice: (notice: string) => void;
  onSyncCloudProgress?: () => Promise<CloudSyncSummaryPayload | null>;
}

const PROVIDER_LABELS: Record<CloudProviderId, string> = {
  google: 'Google Drive',
  play_games_v2: 'Play Games',
  microsoft: 'Microsoft',
  apple: 'Apple iCloud',
  steam: 'Steam',
};

function formatLastSyncedLabel(timestamp?: number): string {
  if (!timestamp || !Number.isFinite(timestamp) || timestamp <= 0) {
    return 'Not synced yet';
  }
  const diffSec = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (diffSec < 15) return 'Just now';
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  return new Date(timestamp).toLocaleDateString();
}

export const CloudAccountCard: React.FC<CloudAccountCardProps> = ({
  playerIdentity,
  cloudProviders,
  isSyncingCloud,
  cloudSyncStatus = 'idle',
  lastCloudSyncError = null,
  onSyncingChange,
  onHubNotice,
  onSyncCloudProgress,
}) => {
  const [editingProfileName, setEditingProfileName] = useState(false);
  const [profileNameDraft, setProfileNameDraft] = useState(playerIdentity.displayName);

  const visibleProviders = cloudProviders.filter(
    (p) => p.id !== 'play_games_v2' || NativeBridge.isAndroid
  );

  // Only render clickable sign-in buttons for supported AND configured providers
  // (auto-hides unconfigured providers to preserve Play Store compliance & zero dead buttons).
  const configuredSignInProviders = visibleProviders.filter(
    (p) => p.isSupported && p.isConfigured && !p.comingSoon
  );

  const isOffline =
    cloudSyncStatus === 'offline' ||
    (cloudSyncStatus !== 'synced' &&
      typeof navigator !== 'undefined' &&
      navigator.onLine === false);

  const effectiveStatus: CloudSyncLiveStatus = isSyncingCloud
    ? 'syncing'
    : isOffline
      ? 'offline'
      : cloudSyncStatus === 'error'
        ? 'error'
        : playerIdentity.isAuthenticated && playerIdentity.lastSyncedAt
          ? 'synced'
          : cloudSyncStatus;

  const statusBadgeText =
    effectiveStatus === 'syncing'
      ? 'Syncing...'
      : effectiveStatus === 'offline'
        ? 'Offline'
        : effectiveStatus === 'error'
          ? 'Error'
          : effectiveStatus === 'synced'
            ? 'Synced'
            : 'Ready';

  const statusBadgeClass =
    effectiveStatus === 'syncing'
      ? 'bg-sky-500/20 text-sky-300 border-sky-400/40'
      : effectiveStatus === 'offline'
        ? 'bg-amber-500/20 text-amber-300 border-amber-400/40'
        : effectiveStatus === 'error'
          ? 'bg-red-500/20 text-red-300 border-red-400/40'
          : effectiveStatus === 'synced'
            ? 'bg-emerald-500/20 text-emerald-300 border-emerald-400/40'
            : 'bg-slate-800 text-slate-300 border-slate-700';

  const handleProviderSignIn = async (providerId: CloudProviderId) => {
    try {
      onSyncingChange(true);
      const signedIn =
        providerId === 'play_games_v2'
          ? await ProviderRegistry.auth.signInWithPlayGames()
          : await ProviderRegistry.auth.signInWithProvider(providerId);
      const syncRes = onSyncCloudProgress ? await onSyncCloudProgress() : null;
      const syncDetail =
        syncRes &&
        ((syncRes.downloadedCount || 0) > 0 ||
          (syncRes.uploadedCount || 0) > 0 ||
          syncRes.addedFromCloud > 0)
          ? ` (${syncRes.downloadedCount || 0} pulled, ${syncRes.uploadedCount || 0} pushed)`
          : '';
      const label = PROVIDER_LABELS[providerId] || providerId;
      onHubNotice(
        `Signed in with ${label} as ${signedIn.displayName}${
          signedIn.email ? ` (${signedIn.email})` : ''
        }! Cloud saves synced${syncDetail}.`
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (
        msg === 'GOOGLE_CLIENT_ID_REQUIRED' ||
        msg === 'PLAY_GAMES_UNCONFIGURED' ||
        msg === 'MICROSOFT_CLIENT_ID_REQUIRED' ||
        msg === 'APPLE_CLOUD_CONFIG_REQUIRED'
      ) {
        onHubNotice(
          `${PROVIDER_LABELS[providerId]} Sign-In requires build variables configured in repository settings — see CLOUD.md.`
        );
      } else if (
        msg === 'PLAY_GAMES_UNAVAILABLE' ||
        msg === 'PLAY_GAMES_PROFILE_UNAVAILABLE'
      ) {
        onHubNotice(
          'Google Play Games Services is currently unavailable or offline on this device. Local saves remain safe.'
        );
      } else {
        onHubNotice(`${PROVIDER_LABELS[providerId]} Sign-In failed: ${msg}`);
      }
    } finally {
      onSyncingChange(false);
    }
  };

  const activeProviderLabel =
    playerIdentity.provider !== 'guest' && playerIdentity.provider !== 'oidc'
      ? PROVIDER_LABELS[playerIdentity.provider] || playerIdentity.provider
      : 'Local Profile';

  const switchableProviders = playerIdentity.isAuthenticated
    ? configuredSignInProviders.filter((p) => p.id !== playerIdentity.provider)
    : [];

  return (
    <div data-testid="cloud-account-card" className="space-y-2.5 min-w-0">
      {/* Row A: Player Identity, Live Sync Status & Actions */}
      <div className="flex flex-wrap items-center justify-between gap-2 pb-2.5 border-b border-slate-800/80 min-w-0">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          {playerIdentity.avatarUrl ? (
            <img
              src={playerIdentity.avatarUrl}
              alt={playerIdentity.displayName}
              className="w-7 h-7 rounded-full ring-2 ring-emerald-500/60 flex-shrink-0 object-cover"
              referrerPolicy="no-referrer"
            />
          ) : (
            <button
              type="button"
              title="Cycle Avatar Color"
              onClick={() => {
                const idx = COLLABORATOR_AVATAR_COLORS.indexOf(playerIdentity.avatarColorHex);
                const nextColor =
                  COLLABORATOR_AVATAR_COLORS[(idx + 1) % COLLABORATOR_AVATAR_COLORS.length];
                ProviderRegistry.auth.updateGuestProfile(playerIdentity.displayName, nextColor);
              }}
              className="w-6 h-6 rounded-full ring-2 ring-slate-700 flex-shrink-0 cursor-pointer"
              style={{ backgroundColor: playerIdentity.avatarColorHex }}
            />
          )}

          {editingProfileName ? (
            <div className="flex items-center gap-1 min-w-0">
              <input
                type="text"
                value={profileNameDraft}
                onChange={(e) => setProfileNameDraft(e.target.value)}
                maxLength={24}
                className="px-2 py-0.5 rounded bg-slate-900 border border-amber-400 text-xs text-white w-28 sm:w-32 focus:outline-none min-w-0"
              />
              <button
                type="button"
                onClick={() => {
                  ProviderRegistry.auth.updateGuestProfile(profileNameDraft);
                  setEditingProfileName(false);
                }}
                className="px-2 py-0.5 rounded bg-amber-400 text-slate-950 text-[11px] font-bold cursor-pointer flex-shrink-0"
              >
                Save
              </button>
            </div>
          ) : (
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-1.5 min-w-0">
                <span className="text-xs font-extrabold text-slate-100 truncate">
                  {playerIdentity.displayName}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setProfileNameDraft(playerIdentity.displayName);
                    setEditingProfileName(true);
                  }}
                  title="Edit Display Name"
                  className="text-slate-400 hover:text-amber-300 cursor-pointer flex-shrink-0"
                >
                  <Edit2 size={11} />
                </button>
                <span
                  data-testid="cloud-sync-status-badge"
                  title={lastCloudSyncError || undefined}
                  className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-[9px] font-bold flex-shrink-0 ${statusBadgeClass}`}
                >
                  {effectiveStatus === 'syncing' && (
                    <RefreshCw size={9} className="animate-spin" />
                  )}
                  <span>{statusBadgeText}</span>
                </span>
              </div>
              <div className="text-[10px] text-slate-400 truncate">
                {playerIdentity.isAuthenticated
                  ? `${activeProviderLabel} • ${playerIdentity.email || playerIdentity.displayName}`
                  : configuredSignInProviders.length > 0
                    ? 'Local Profile • Sign in to sync saves across devices'
                    : 'Local Profile • Saves stored locally on this device'}
              </div>
              {playerIdentity.isAuthenticated && (
                <div
                  data-testid="cloud-last-synced"
                  className="text-[9px] text-slate-500 truncate"
                >
                  Last synced: {formatLastSyncedLabel(playerIdentity.lastSyncedAt)}
                  {lastCloudSyncError && effectiveStatus === 'error'
                    ? ` • ${lastCloudSyncError}`
                    : ''}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {playerIdentity.isAuthenticated ? (
            <button
              type="button"
              data-testid="play-games-signout-btn"
              onClick={async () => {
                await ProviderRegistry.auth.signOut();
                onHubNotice('Signed out of cloud profile.');
              }}
              className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-[11px] font-semibold border border-slate-700 cursor-pointer"
            >
              Sign Out
            </button>
          ) : (
            configuredSignInProviders.map((prov) => {
              const isPrimaryBtn =
                (NativeBridge.isAndroid && prov.id === 'play_games_v2') ||
                (!NativeBridge.isAndroid && prov.id === 'google');
              const btnLabel =
                prov.id === 'play_games_v2'
                  ? 'Play Games Login'
                  : prov.id === 'google'
                    ? 'Google Login'
                    : prov.id === 'microsoft'
                      ? 'Microsoft Login'
                      : prov.id === 'apple'
                        ? 'Apple Login'
                        : `${prov.displayName} Login`;
              return (
                <button
                  key={prov.id}
                  type="button"
                  data-testid={isPrimaryBtn ? 'play-games-signin-btn' : `cloud-signin-${prov.id}`}
                  data-provider-id={prov.id}
                  disabled={isSyncingCloud}
                  onClick={() => void handleProviderSignIn(prov.id)}
                  className="px-2.5 py-1 rounded-lg bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-300 text-[11px] font-bold border border-emerald-500/40 cursor-pointer disabled:opacity-50"
                >
                  {btnLabel}
                </button>
              );
            })
          )}

          {onSyncCloudProgress && (
            <button
              type="button"
              data-testid="cloud-sync-btn"
              disabled={isSyncingCloud}
              onClick={async () => {
                onSyncingChange(true);
                try {
                  const res = await onSyncCloudProgress();
                  if (res) {
                    const parts: string[] = [];
                    if (res.addedFromCloud > 0) {
                      parts.push(`+${res.addedFromCloud} regions merged`);
                    }
                    if ((res.downloadedCount || 0) > 0) {
                      parts.push(`${res.downloadedCount} saves pulled`);
                    }
                    if ((res.uploadedCount || 0) > 0) {
                      parts.push(`${res.uploadedCount} saves pushed`);
                    }
                    onHubNotice(
                      parts.length > 0
                        ? `Cloud Sync complete (${parts.join(', ')})!`
                        : `Cloud Sync up to date (${ProviderRegistry.cloudSave.providerName})!`
                    );
                  }
                } catch (err) {
                  onHubNotice(
                    `Cloud Sync failed: ${err instanceof Error ? err.message : 'Unable to reach cloud storage.'}`
                  );
                } finally {
                  onSyncingChange(false);
                }
              }}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-sky-500/15 hover:bg-sky-500/25 text-sky-300 text-[11px] font-bold border border-sky-400/40 cursor-pointer disabled:opacity-50"
            >
              <Cloud size={12} />
              <span>{isSyncingCloud ? 'Syncing...' : 'Cloud Sync'}</span>
            </button>
          )}
        </div>
      </div>

      {/* Optional Account Switcher when signed in and another BYOC provider is also configured */}
      {switchableProviders.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 text-[10px] text-slate-400">
          <span className="font-semibold text-slate-400">Switch cloud:</span>
          {switchableProviders.map((prov) => (
            <button
              key={prov.id}
              type="button"
              data-testid={`cloud-switch-${prov.id}`}
              disabled={isSyncingCloud}
              onClick={() => void handleProviderSignIn(prov.id)}
              className="px-2 py-0.5 rounded bg-slate-900 hover:bg-slate-800 text-slate-200 border border-slate-700 font-semibold cursor-pointer disabled:opacity-50"
            >
              {PROVIDER_LABELS[prov.id] || prov.displayName}
            </button>
          ))}
        </div>
      )}

      {/* Modular Multi-Platform Cloud Provider Status Row */}
      <div
        data-testid="cloud-providers-bar"
        className="flex flex-wrap items-center justify-between gap-1.5 text-[10px] text-slate-400 pb-2 border-b border-slate-800/60"
      >
        <span className="font-semibold text-slate-300 truncate">
          Cloud Backend: {ProviderRegistry.cloudSave.providerName}
        </span>
        <div className="flex flex-wrap items-center gap-1">
          {visibleProviders.map((prov) => {
            const isCurrent =
              playerIdentity.isAuthenticated && playerIdentity.provider === prov.id;
            return (
              <span
                key={prov.id}
                data-testid={`cloud-provider-badge-${prov.id}`}
                title={prov.storageName}
                className={`px-1.5 py-0.5 rounded border text-[9px] font-bold ${
                  isCurrent
                    ? 'bg-emerald-500/20 border-emerald-500/50 text-emerald-300'
                    : prov.isSupported && prov.isConfigured
                      ? 'bg-slate-900 border-slate-700 text-slate-200'
                      : 'bg-slate-900/50 border-slate-800/80 text-slate-500'
                }`}
              >
                {prov.displayName}
                {isCurrent ? ' • Connected' : prov.comingSoon ? ' • Soon' : ''}
              </span>
            );
          })}
        </div>
      </div>
    </div>
  );
};
