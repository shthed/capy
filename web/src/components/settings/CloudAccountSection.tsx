import React, { useEffect, useState } from 'react';
import { Copy, Printer, Share2, Users } from 'lucide-react';
import { ProviderRegistry } from '../../services/providers/ProviderRegistry';
import { PlayerIdentity } from '../../services/providers/types';
import { CloudAccountCard } from '../CloudAccountCard';
import { SettingsCloudCoopProps } from './types';

export interface CloudAccountSectionProps {
  cloudCoop?: SettingsCloudCoopProps;
}

export const CloudAccountSection: React.FC<CloudAccountSectionProps> = ({ cloudCoop }) => {
  const {
    showCloudCoopUi = false,
    coopRoomCode,
    coopParticipants = [],
    canShareActiveLink = false,
    cloudSyncStatus,
    lastCloudSyncError,
    onHostCoopRoom,
    onJoinCoopRoom,
    onLeaveCoopRoom,
    onShareProgressLink,
    onCopyCoopInviteLink,
    onExportPrintableSvg,
    onSyncCloudProgress,
  } = cloudCoop ?? {};

  const [playerIdentity, setPlayerIdentity] = useState<PlayerIdentity>(() =>
    ProviderRegistry.auth.getCurrentIdentity()
  );
  const [joinCodeInput, setJoinCodeInput] = useState('');
  const [hubNotice, setHubNotice] = useState<string | null>(null);
  const [isSyncingCloud, setIsSyncingCloud] = useState(false);

  const cloudProviders = ProviderRegistry.auth.getAvailableCloudProviders();

  useEffect(() => {
    return ProviderRegistry.auth.subscribe((id) => {
      setPlayerIdentity(id);
    });
  }, []);

  const shareAndPrintButtons = (
    <div className="flex flex-wrap items-center gap-1.5">
      {onShareProgressLink && (
        <button
          type="button"
          data-testid="share-progress-link-btn"
          disabled={!canShareActiveLink}
          onClick={async () => {
            const url = await onShareProgressLink();
            if (url) {
              setHubNotice('Shareable progress link copied (<2 KB URL token)!');
            }
          }}
          title={
            canShareActiveLink
              ? 'Copy or share a compact URL link with your current puzzle progress'
              : 'Shareable URL links work with Gallery/Sample puzzles (use Export .capy for private custom photos)'
          }
          className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-bold border transition-colors ${
            canShareActiveLink
              ? 'bg-amber-400/15 hover:bg-amber-400/25 text-amber-300 border-amber-400/40 cursor-pointer'
              : 'bg-slate-900 text-slate-500 border-slate-800 cursor-not-allowed'
          }`}
        >
          <Share2 size={13} />
          <span>Share Progress Link</span>
        </button>
      )}

      {onExportPrintableSvg && (
        <button
          type="button"
          data-testid="export-printable-svg-btn"
          onClick={async () => {
            const ok = await onExportPrintableSvg();
            if (ok) {
              setHubNotice('Printable vector coloring sheet (.svg) exported!');
            }
          }}
          title="Export active puzzle as a print-ready monochrome vector SVG coloring sheet"
          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-bold bg-slate-800 hover:bg-slate-700 text-slate-100 border border-slate-700 transition-colors cursor-pointer"
        >
          <Printer size={13} className="text-amber-400" />
          <span>Printable SVG</span>
        </button>
      )}
    </div>
  );

  if (!showCloudCoopUi) {
    return (
      <div
        data-testid="saves-share-print-bar"
        className="p-3 rounded-xl bg-slate-950/75 border border-slate-800 space-y-2"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          {shareAndPrintButtons}
          <span className="text-[11px] text-slate-400">Saves stored locally on this device</span>
        </div>

        {hubNotice && (
          <div
            data-testid="cloud-coop-notice"
            className="px-2.5 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-[11px] font-semibold text-amber-300"
          >
            {hubNotice}
          </div>
        )}
      </div>
    );
  }

  return (
    <div
      data-testid="cloud-coop-hub"
      className="p-3 rounded-xl bg-slate-950/75 border border-slate-800 space-y-3"
    >
      <CloudAccountCard
        playerIdentity={playerIdentity}
        cloudProviders={cloudProviders}
        isSyncingCloud={isSyncingCloud}
        cloudSyncStatus={cloudSyncStatus}
        lastCloudSyncError={lastCloudSyncError}
        onSyncingChange={setIsSyncingCloud}
        onHubNotice={setHubNotice}
        onSyncCloudProgress={onSyncCloudProgress}
      />

      {/* Shareable Game Link & Simultaneous Co-op Room */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
        {shareAndPrintButtons}

        {coopRoomCode ? (
          <div className="flex flex-wrap items-center gap-1.5">
            <span
              data-testid="active-coop-room-code"
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-emerald-950/90 border border-emerald-500/50 text-emerald-300 text-xs font-extrabold"
            >
              <Users size={12} />
              <span>Room {coopRoomCode}</span>
              <span className="text-[10px] text-emerald-400/90">
                ({coopParticipants.length} online)
              </span>
            </span>

            {onCopyCoopInviteLink && (
              <button
                type="button"
                data-testid="copy-coop-invite-btn"
                onClick={async () => {
                  const url = await onCopyCoopInviteLink();
                  if (url) {
                    setHubNotice(`Co-op room ${coopRoomCode} invite link copied!`);
                  }
                }}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold border border-slate-700 cursor-pointer"
              >
                <Copy size={12} />
                <span>Copy Invite</span>
              </button>
            )}

            {onLeaveCoopRoom && (
              <button
                type="button"
                data-testid="leave-coop-room-btn"
                onClick={() => {
                  onLeaveCoopRoom();
                  setHubNotice('Left Co-op room.');
                }}
                className="px-2.5 py-1 rounded-lg bg-red-950/50 hover:bg-red-900/60 text-red-300 text-xs font-semibold border border-red-500/40 cursor-pointer"
              >
                Leave
              </button>
            )}
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-1.5">
            {onHostCoopRoom && (
              <button
                type="button"
                data-testid="host-coop-room-btn"
                onClick={async () => {
                  const code = await onHostCoopRoom();
                  if (code) {
                    setHubNotice(
                      `Live Co-op Room ${code} active! Open another tab or share invite to paint together.`
                    );
                  }
                }}
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-300 text-xs font-bold border border-emerald-500/40 cursor-pointer"
              >
                <Users size={13} />
                <span>Host Co-op Room</span>
              </button>
            )}

            {onJoinCoopRoom && (
              <div className="flex items-center gap-1">
                <input
                  type="text"
                  aria-label="Co-op room code"
                  data-testid="join-coop-room-input"
                  value={joinCodeInput}
                  onChange={(e) => setJoinCodeInput(e.target.value.toUpperCase())}
                  placeholder="ROOM6"
                  maxLength={8}
                  className="w-20 px-2 py-1 rounded-lg bg-slate-900 border border-slate-700 text-xs font-mono uppercase text-slate-100 focus:outline-none focus:border-emerald-400"
                />
                <button
                  type="button"
                  data-testid="join-coop-room-btn"
                  onClick={async () => {
                    const rawCode = joinCodeInput.trim();
                    if (!rawCode) return;
                    try {
                      const ok = await onJoinCoopRoom(rawCode);
                      if (ok) {
                        setHubNotice(`Joined Co-op Room ${rawCode.toUpperCase()}!`);
                        setJoinCodeInput('');
                      } else {
                        setHubNotice('Enter a valid 4-8 character Co-op room code.');
                      }
                    } catch {
                      setHubNotice('Unable to join Co-op room. Check code and try again.');
                    }
                  }}
                  className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold border border-slate-700 cursor-pointer"
                >
                  Join
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {coopRoomCode && coopParticipants.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 pt-1">
          {coopParticipants.map((peer) => (
            <span
              key={peer.playerId}
              className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-slate-900 border border-slate-800 text-[10px] font-bold text-slate-300"
            >
              <span
                className="w-2 h-2 rounded-full"
                style={{ backgroundColor: peer.avatarColorHex }}
              />
              <span>{peer.displayName}</span>
            </span>
          ))}
        </div>
      )}

      {hubNotice && (
        <div
          data-testid="cloud-coop-notice"
          className="px-2.5 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-[11px] font-semibold text-amber-300"
        >
          {hubNotice}
        </div>
      )}
    </div>
  );
};
