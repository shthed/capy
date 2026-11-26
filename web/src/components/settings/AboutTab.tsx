import React, { useEffect, useMemo, useState } from 'react';
import {
  AppWindow,
  BookOpen,
  Check,
  ExternalLink,
  MessageSquare,
  Play,
  ShieldCheck,
  Smartphone,
  Sparkles,
} from 'lucide-react';
import { NativeBridge } from '../../services/NativeBridge';
import {
  formatFastestCompletion,
  PlayerLifetimeStats,
  PlayerStatsService,
} from '../../services/PlayerStatsService';
import { PwaService } from '../../services/PwaService';
import { resolveStorageNamespace } from '../../services/StorageNamespace';
import { APP_VERSION, resolveReleaseChannel } from '../../version';
import { FeedbackSection } from './FeedbackSection';

export interface AboutTabProps {
  lifetimeStats?: PlayerLifetimeStats;
  showCloudCoopUi?: boolean;
  onStartTutorial?: () => void;
  onClose: () => void;
}

const ReleaseChannelCard: React.FC = () => {
  const channelInfo = resolveReleaseChannel();
  if (NativeBridge.isAndroid || !channelInfo.showChannelSwitcher) return null;

  const ns = resolveStorageNamespace();
  const isBeta = channelInfo.channel === 'beta';
  const isAlpha = channelInfo.channel === 'alpha';
  const sharesOriginWithBeta =
    typeof window !== 'undefined' && channelInfo.betaWebUrl.startsWith(window.location.origin);

  let statusLabel = `Stable Release • v${APP_VERSION}`;
  if (isBeta) {
    statusLabel = `Beta Channel • v${APP_VERSION}`;
  } else if (isAlpha) {
    statusLabel = `Alpha Preview${channelInfo.prNumber ? ` #${channelInfo.prNumber}` : ''} • v${APP_VERSION}`;
  } else if (channelInfo.channel === 'dev') {
    statusLabel = `Local Dev • v${APP_VERSION}`;
  }

  const primaryTargetUrl = isBeta ? channelInfo.stableWebUrl : channelInfo.betaWebUrl;
  const primaryActionLabel = isBeta ? 'Return to Stable Release' : 'Switch to Beta Channel';

  return (
    <div
      data-testid="release-channel-card"
      data-channel={channelInfo.channel}
      className="p-3 rounded-xl bg-slate-950/70 border border-slate-800/90 space-y-2"
    >
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-1.5 text-xs font-bold text-slate-200">
          <Sparkles size={14} className="text-violet-400 flex-shrink-0" />
          <span>Release Channel</span>
        </div>
        <span
          data-testid="release-channel-status"
          className={`px-2 py-0.5 rounded-full text-[10px] font-extrabold border ${
            isBeta || isAlpha
              ? 'bg-violet-950/80 text-violet-200 border-violet-400/50'
              : 'bg-emerald-950/60 text-emerald-300 border-emerald-500/40'
          }`}
        >
          {statusLabel}
        </span>
      </div>
      <p className="text-[11px] leading-relaxed text-slate-400">
        {ns.isSandboxed
          ? 'Preview upcoming Sprint features early in an isolated channel sandbox so your Production saves and settings stay untouched.'
          : sharesOriginWithBeta
            ? 'Preview upcoming Sprint features early on the Beta channel before they ship to Production. Beta runs in an isolated browser sandbox so your Production saves and settings stay untouched.'
            : 'Preview upcoming Sprint features early on the Beta channel before they ship to Production.'}
      </p>
      <div className={`grid grid-cols-1 ${NativeBridge.isAndroid ? '' : 'sm:grid-cols-2'} gap-2 pt-0.5`}>
        <a
          href={primaryTargetUrl}
          data-testid="toggle-beta-channel-btn"
          className={`capy-link-btn flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold border transition-all cursor-pointer ${
            isBeta
              ? 'bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-200 border-emerald-400/50'
              : 'bg-violet-500/20 hover:bg-violet-500/30 text-violet-200 border-violet-400/50'
          }`}
        >
          <ExternalLink size={13} className="flex-shrink-0" />
          <span>{primaryActionLabel}</span>
        </a>
        {!NativeBridge.isAndroid && (
          <a
            href={channelInfo.betaApkUrl}
            download="capy-beta.apk"
            data-testid="beta-apk-download-link"
            className="capy-link-btn flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold bg-slate-900/90 hover:bg-slate-800 text-slate-200 border border-slate-700/80 hover:border-violet-400/50 transition-all cursor-pointer"
          >
            <Smartphone size={13} className="text-violet-300 flex-shrink-0" />
            <span>Beta Android APK</span>
          </a>
        )}
      </div>
    </div>
  );
};

export const AboutTab: React.FC<AboutTabProps> = ({
  lifetimeStats,
  showCloudCoopUi = false,
  onStartTutorial,
  onClose,
}) => {
  const [isFeedbackOpen, setIsFeedbackOpen] = useState(false);
  const [isInstallable, setIsInstallable] = useState(PwaService.isInstallable);
  const [isStandalone, setIsStandalone] = useState(PwaService.isStandalone);

  const effectiveStats = useMemo(
    () => lifetimeStats ?? PlayerStatsService.loadStats(),
    [lifetimeStats]
  );

  useEffect(() => {
    return PwaService.subscribe(() => {
      setIsInstallable(PwaService.isInstallable);
      setIsStandalone(PwaService.isStandalone);
    });
  }, []);

  return (
    <div className="space-y-4 sm:space-y-5">
      {/* About Capy Paint Hero Card */}
      <div
        data-testid="about-screen-card"
        className="p-3.5 sm:p-4 rounded-xl bg-slate-950/70 border border-slate-800/90 space-y-3"
      >
        <div className="flex items-start justify-between gap-2">
          <div>
            <h2 className="text-sm sm:text-base font-extrabold text-amber-300">Capy Paint</h2>
            <p className="text-[11px] sm:text-xs text-slate-300 leading-relaxed mt-0.5">
              {showCloudCoopUi
                ? 'Offline-first color-by-number & free-coloring studio. Turn any photo or built-in artwork into a relaxing, zero-latency puzzle with instant saves, chronological replays, and live local Co-op.'
                : 'Offline-first color-by-number & free-coloring studio. Turn any photo or built-in artwork into a relaxing, zero-latency puzzle with instant saves and chronological replays.'}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 pt-0.5">
          {onStartTutorial && (
            <button
              type="button"
              data-testid="about-replay-tutorial-btn"
              onClick={() => {
                onClose();
                onStartTutorial();
              }}
              className="inline-flex items-center gap-1.5 min-h-[38px] px-3 py-1.5 rounded-lg bg-amber-400 hover:bg-amber-300 text-slate-950 text-xs font-extrabold shadow transition-colors cursor-pointer"
            >
              <Play size={13} className="fill-slate-950" />
              <span>Replay Interactive Tutorial</span>
            </button>
          )}
          <button
            type="button"
            data-testid="about-open-feedback-btn"
            aria-expanded={isFeedbackOpen}
            onClick={() => setIsFeedbackOpen((prev) => !prev)}
            className={`inline-flex items-center gap-1.5 min-h-[38px] px-3 py-1.5 rounded-lg text-xs font-extrabold border transition-colors cursor-pointer ${
              isFeedbackOpen
                ? 'bg-sky-500/25 text-sky-100 border-sky-400/80'
                : 'bg-sky-500/15 hover:bg-sky-500/25 text-sky-200 border-sky-400/60'
            }`}
          >
            <MessageSquare size={13} className="text-sky-300" />
            <span>{isFeedbackOpen ? 'Hide Feedback Form' : 'Send Feedback'}</span>
          </button>
          <a
            href={
              NativeBridge.isAndroid
                ? 'https://capypaint.com/privacy-policy.html'
                : 'privacy-policy.html'
            }
            target="_blank"
            rel="noopener noreferrer"
            data-testid="about-privacy-policy-link"
            className="capy-link-btn inline-flex items-center gap-1.5 min-h-[38px] px-3 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-200 text-xs font-bold border border-slate-700/80 transition-colors cursor-pointer"
          >
            <ShieldCheck size={13} className="text-emerald-400" />
            <span>Privacy Policy</span>
          </a>
        </div>
      </div>

      {/* Collapsible Anonymous In-Game Feedback Form */}
      {isFeedbackOpen && <FeedbackSection />}

      {/* How to Play & Core Features */}
      <div className="space-y-2">
        <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
          How to Play &amp; Core Features
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
          <div className="p-2.5 rounded-xl bg-slate-950/50 border border-slate-800/80">
            <div className="font-bold text-slate-200">Tap or Paint</div>
            <div className="text-[11px] text-slate-400 mt-0.5">
              Pick a numbered swatch below and tap matching regions, or toggle Paint Mode to
              drag-fill smoothly.
            </div>
          </div>
          <div className="p-2.5 rounded-xl bg-slate-950/50 border border-slate-800/80">
            <div className="font-bold text-slate-200">Zoom &amp; Pan</div>
            <div className="text-[11px] text-slate-400 mt-0.5">
              {NativeBridge.isAndroid
                ? 'Pinch or double-tap & drag to inspect fine details.'
                : 'Pinch, scroll, or double-tap & drag to inspect fine details.'}
            </div>
          </div>
          <div className="p-2.5 rounded-xl bg-slate-950/50 border border-slate-800/80">
            <div className="font-bold text-slate-200">Smart Hints &amp; Replay</div>
            <div className="text-[11px] text-slate-400 mt-0.5">
              Double-tap a swatch to locate remaining spots. Long-press Undo to scrub or replay your
              progress.
            </div>
          </div>
          <div className="p-2.5 rounded-xl bg-slate-950/50 border border-slate-800/80">
            <div className="font-bold text-slate-200">
              {showCloudCoopUi ? 'Create, Saves & Co-op' : 'Create, Saves & Printable Art'}
            </div>
            <div className="text-[11px] text-slate-400 mt-0.5">
              {showCloudCoopUi
                ? 'Upload any photo in Create, export .capy backups or printable SVGs, and color together in Co-op.'
                : 'Upload any photo in Create, save progress locally, and export .capy backups or printable SVGs.'}
            </div>
          </div>
        </div>
      </div>

      {/* Lifetime Player Statistics (compact 2-column mobile-first grid) */}
      <div
        data-testid="lifetime-stats-card"
        className="p-3 rounded-xl bg-slate-950/50 border border-slate-800/80 space-y-2.5"
      >
        <div className="flex items-center justify-between">
          <span className="text-xs sm:text-sm font-semibold text-slate-200">Lifetime Stats</span>
          <span className="text-[10px] font-bold uppercase tracking-wider text-amber-400/90">
            Local Progress
          </span>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div className="p-2 rounded-lg bg-slate-900/70 border border-slate-800/80">
            <div className="text-[10px] text-slate-400 font-medium truncate">Regions Colored</div>
            <div
              data-testid="stat-total-regions"
              className="text-sm sm:text-base font-extrabold font-mono text-amber-400 tabular-nums"
            >
              {effectiveStats.totalRegionsColored.toLocaleString()}
            </div>
          </div>
          <div className="p-2 rounded-lg bg-slate-900/70 border border-slate-800/80">
            <div className="text-[10px] text-slate-400 font-medium truncate">Puzzles Completed</div>
            <div
              data-testid="stat-puzzles-completed"
              className="text-sm sm:text-base font-extrabold font-mono text-slate-100 tabular-nums"
            >
              {effectiveStats.puzzlesCompleted.toLocaleString()}
            </div>
          </div>
          <div className="p-2 rounded-lg bg-slate-900/70 border border-slate-800/80">
            <div className="text-[10px] text-slate-400 font-medium truncate">Zero-Hint Clears</div>
            <div
              data-testid="stat-zero-hint-puzzles"
              className="text-sm sm:text-base font-extrabold font-mono text-emerald-400 tabular-nums"
            >
              {effectiveStats.zeroHintPuzzles.toLocaleString()}
            </div>
          </div>
          <div className="p-2 rounded-lg bg-slate-900/70 border border-slate-800/80">
            <div className="text-[10px] text-slate-400 font-medium truncate">Fastest Clear</div>
            <div
              data-testid="stat-fastest-completion"
              className="text-sm sm:text-base font-extrabold font-mono text-sky-300 tabular-nums"
            >
              {formatFastestCompletion(effectiveStats.fastestCompletionMs)}
            </div>
          </div>
          <div
            className={`p-2 rounded-lg bg-slate-900/70 border border-slate-800/80 ${
              !showCloudCoopUi ? 'col-span-2' : ''
            }`}
          >
            <div className="text-[10px] text-slate-400 font-medium truncate">Free Color Art</div>
            <div
              data-testid="stat-free-color-creations"
              className="text-sm sm:text-base font-extrabold font-mono text-slate-200 tabular-nums"
            >
              {effectiveStats.freeColorCreations.toLocaleString()}
            </div>
          </div>
          {showCloudCoopUi && (
            <div className="p-2 rounded-lg bg-slate-900/70 border border-slate-800/80">
              <div className="text-[10px] text-slate-400 font-medium truncate">Co-op Regions</div>
              <div
                data-testid="stat-coop-regions"
                className="text-sm sm:text-base font-extrabold font-mono text-slate-200 tabular-nums"
              >
                {effectiveStats.coopRegionsPainted.toLocaleString()}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Platform & External Application Links */}
      <div
        data-testid="about-platforms-section"
        className="pt-3 border-t border-slate-800/80 space-y-2"
      >
        <div className="flex items-center justify-between">
          <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
            Platforms &amp; Applications
          </div>
          <span
            data-testid="app-version-badge"
            className="px-2 py-0.5 rounded-md bg-slate-900 border border-slate-800 text-[10px] font-mono font-bold text-slate-400"
          >
            v{APP_VERSION}
          </span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {NativeBridge.isNative ? (
            <div className="flex items-center gap-2 p-2.5 rounded-xl bg-slate-950/60 border border-emerald-500/30 text-slate-200 text-xs font-semibold">
              <Check size={16} className="text-emerald-400 flex-shrink-0" />
              <div className="min-w-0">
                <div className="truncate font-bold text-emerald-400">Native Application</div>
                <div className="text-[10px] text-slate-400 truncate">
                  Running as installed {NativeBridge.platform === 'android' ? 'Android' : 'iOS'}{' '}
                  launcher
                </div>
              </div>
            </div>
          ) : isStandalone ? (
            <div className="flex items-center gap-2 p-2.5 rounded-xl bg-slate-950/60 border border-emerald-500/30 text-slate-200 text-xs font-semibold">
              <Check size={16} className="text-emerald-400 flex-shrink-0" />
              <div className="min-w-0">
                <div className="truncate font-bold text-emerald-400">Installed Web App</div>
                <div className="text-[10px] text-slate-400 truncate">
                  Running offline as standalone PWA
                </div>
              </div>
            </div>
          ) : isInstallable ? (
            <button
              type="button"
              onClick={() => PwaService.promptInstall()}
              data-testid="pwa-install-btn"
              className="flex items-center gap-2 p-2.5 rounded-xl bg-slate-950/60 border border-amber-400/50 hover:bg-slate-800/40 text-slate-200 transition-all text-xs font-semibold cursor-pointer text-left"
            >
              <AppWindow size={16} className="text-amber-400 flex-shrink-0" />
              <div className="min-w-0">
                <div className="truncate font-bold text-amber-300">Install Web App</div>
                <div className="text-[10px] text-slate-400 truncate">
                  Install on home screen or desktop
                </div>
              </div>
            </button>
          ) : (
            <div className="flex items-center gap-2 p-2.5 rounded-xl bg-slate-950/60 border border-slate-800 text-slate-200 text-xs font-semibold">
              <AppWindow size={16} className="text-slate-400 flex-shrink-0" />
              <div className="min-w-0">
                <div className="truncate font-bold text-slate-200">Progressive Web App</div>
                <div className="text-[10px] text-slate-400 truncate">
                  Install via browser menu for offline play
                </div>
              </div>
            </div>
          )}

          {!NativeBridge.isAndroid && (
            <a
              href="capy.apk"
              download="capy.apk"
              data-testid="android-apk-download-link"
              className="capy-link-btn flex items-center gap-2 p-2.5 rounded-xl bg-slate-950/60 border border-slate-800 hover:border-amber-400/50 hover:bg-slate-800/40 text-slate-200 transition-all text-xs font-semibold cursor-pointer"
            >
              <Smartphone size={16} className="text-amber-400 flex-shrink-0" />
              <div className="min-w-0">
                <div className="truncate font-bold text-slate-200">Android APK</div>
                <div className="text-[10px] text-slate-400 truncate">
                  Download standalone Android application
                </div>
              </div>
            </a>
          )}
        </div>

        <ReleaseChannelCard />

        {/* Open Source Licenses & Secondary Footer */}
        <div className="pt-2 border-t border-slate-800/80 space-y-2.5">
          <details
            data-testid="about-licenses-section"
            className="group rounded-xl bg-slate-950/60 border border-slate-800/80 overflow-hidden"
          >
            <summary className="list-none flex items-center justify-between gap-2 min-h-[40px] px-3 py-2 text-xs font-bold text-slate-300 hover:bg-slate-800/40 cursor-pointer select-none">
              <span className="inline-flex items-center gap-1.5">
                <BookOpen size={13} className="text-amber-400" />
                <span>Open Source Licenses</span>
              </span>
              <span className="text-[10px] font-semibold text-slate-400 group-open:hidden">
                View credits
              </span>
              <span className="text-[10px] font-semibold text-amber-300 hidden group-open:inline">
                Hide credits
              </span>
            </summary>
            <div className="px-3 pb-3 pt-1.5 border-t border-slate-800/70 text-[11px] text-slate-400 space-y-1.5">
              <p className="text-slate-300">Capy Paint is built with open-source libraries:</p>
              <ul className="space-y-1 pl-3 list-disc">
                <li>
                  <span className="text-slate-200 font-semibold">React</span> — MIT License
                </li>
                <li>
                  <span className="text-slate-200 font-semibold">Lucide React</span> — ISC License
                </li>
                <li>
                  <span className="text-slate-200 font-semibold">Tailwind CSS</span> — MIT License
                </li>
                <li>
                  <span className="text-slate-200 font-semibold">AndroidX &amp; WebKit</span> —
                  Apache License 2.0
                </li>
              </ul>
            </div>
          </details>

          <div className="flex flex-wrap items-center justify-between gap-2 px-0.5 text-[11px] text-slate-400">
            <span>CapyBoop Games • 100% Ad-Free</span>
            <a
              href="https://github.com/capyboop/paint/issues/new/choose"
              target="_blank"
              rel="noopener noreferrer"
              data-testid="about-report-issue-link"
              className="inline-flex items-center gap-1 text-slate-400 hover:text-sky-300 underline-offset-2 hover:underline transition-colors cursor-pointer"
            >
              <ExternalLink size={11} />
              <span>Report Bug / Ideas on GitHub</span>
            </a>
          </div>
        </div>
      </div>
    </div>
  );
};
