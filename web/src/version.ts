import pkg from '../package.json';

export interface SemVerParts {
  major: number;
  minor: number;
  patch: number;
}

/**
 * Parses a strict MAJOR.MINOR.PATCH semantic version string.
 */
export function parseSemVer(version: string): SemVerParts {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version.trim());
  if (!match) {
    throw new Error(`Invalid semantic version "${version}". Expected MAJOR.MINOR.PATCH.`);
  }
  const major = Number(match[1]);
  const minor = Number(match[2]);
  const patch = Number(match[3]);
  if (minor > 99 || patch > 99) {
    throw new Error(
      `Semantic version "${version}" exceeds Android versionCode slot capacity (minor/patch must be 0..99).`
    );
  }
  return { major, minor, patch };
}

/**
 * Deterministic Android versionCode mapping: (MAJOR * 10000) + (MINOR * 100) + PATCH.
 * Example: "2.5.0" -> 20500.
 */
export function computeAndroidVersionCode(version: string): number {
  const { major, minor, patch } = parseSemVer(version);
  return major * 10000 + minor * 100 + patch;
}

export const APP_VERSION: string = pkg.version;
export const APP_VERSION_CODE: number = computeAndroidVersionCode(pkg.version);

export type ReleaseChannel = 'stable' | 'beta' | 'alpha' | 'dev';

export interface ReleaseChannelInfo {
  channel: ReleaseChannel;
  badgeLabel: string | null;
  prNumber: number | null;
  stableWebUrl: string;
  betaWebUrl: string;
  betaApkUrl: string;
  showChannelSwitcher: boolean;
}

const CANONICAL_PAGES_BASE = 'https://shthed.github.io/capy';

/**
 * Resolves the active deployment channel from URL pathname, origin, and optional query override.
 * - '/capy/pull/<num>/' -> channel: 'alpha', badgeLabel: 'ALPHA #<num>'
 * - '/capy/beta/'       -> channel: 'beta',  badgeLabel: 'BETA'
 * - '/capy/'            -> channel: 'stable', badgeLabel: null
 * - 'capypaint.com'     -> channel: 'stable', badgeLabel: null, showChannelSwitcher: false
 * - 'localhost' / '127.0.0.1' -> channel: 'dev', badgeLabel: null (unless overridden via ?capy_channel=)
 */
export function resolveReleaseChannel(
  pathname: string = typeof window !== 'undefined' ? window.location.pathname : '/',
  origin: string = typeof window !== 'undefined' ? window.location.origin : 'https://shthed.github.io',
  search: string = typeof window !== 'undefined' ? window.location.search : ''
): ReleaseChannelInfo {
  const cleanOrigin = origin.replace(/\/+$/, '');
  let originHostname = '';
  try {
    originHostname = new URL(cleanOrigin).hostname.toLowerCase();
  } catch {
    originHostname = '';
  }

  const isCustomDomain =
    originHostname === 'capypaint.com' ||
    originHostname === 'www.capypaint.com' ||
    originHostname.endsWith('.capypaint.com') ||
    originHostname === 'appassets.androidplatform.net';

  const pagesBase = cleanOrigin.endsWith('.github.io')
    ? `${cleanOrigin}/capy`
    : CANONICAL_PAGES_BASE;
  const stableWebUrl = isCustomDomain ? 'https://capypaint.com/' : `${pagesBase}/`;
  const betaWebUrl = `${pagesBase}/beta/`;
  const betaApkUrl = `${pagesBase}/beta/capy.apk`;

  if (search) {
    const params = new URLSearchParams(search.startsWith('?') ? search : `?${search}`);
    const forced = (params.get('capy_channel') || '').trim().toLowerCase();
    const forcedPrRaw = params.get('pr');
    const forcedPr =
      forcedPrRaw && /^\d+$/.test(forcedPrRaw.trim()) ? Number(forcedPrRaw.trim()) : null;
    if (forced === 'beta') {
      return {
        channel: 'beta',
        badgeLabel: 'BETA',
        prNumber: null,
        stableWebUrl,
        betaWebUrl,
        betaApkUrl,
        showChannelSwitcher: true,
      };
    }
    if (forced === 'alpha') {
      return {
        channel: 'alpha',
        badgeLabel: forcedPr ? `ALPHA #${forcedPr}` : 'ALPHA',
        prNumber: forcedPr,
        stableWebUrl,
        betaWebUrl,
        betaApkUrl,
        showChannelSwitcher: true,
      };
    }
    if (forced === 'stable') {
      return {
        channel: 'stable',
        badgeLabel: null,
        prNumber: null,
        stableWebUrl,
        betaWebUrl,
        betaApkUrl,
        showChannelSwitcher: true,
      };
    }
    if (forced === 'dev') {
      return {
        channel: 'dev',
        badgeLabel: null,
        prNumber: null,
        stableWebUrl,
        betaWebUrl,
        betaApkUrl,
        showChannelSwitcher: true,
      };
    }
  }

  if (isCustomDomain) {
    return {
      channel: 'stable',
      badgeLabel: null,
      prNumber: null,
      stableWebUrl: 'https://capypaint.com/',
      betaWebUrl,
      betaApkUrl,
      showChannelSwitcher: false,
    };
  }

  const pullNumMatch = /\/pull\/(\d+)(?:\/|$)/.exec(pathname);
  if (pullNumMatch) {
    const prNumber = Number(pullNumMatch[1]);
    return {
      channel: 'alpha',
      badgeLabel: `ALPHA #${prNumber}`,
      prNumber,
      stableWebUrl,
      betaWebUrl,
      betaApkUrl,
      showChannelSwitcher: true,
    };
  }

  if (/\/pull\/[A-Za-z0-9._-]+(?:\/|$)/.test(pathname)) {
    return {
      channel: 'alpha',
      badgeLabel: 'ALPHA',
      prNumber: null,
      stableWebUrl,
      betaWebUrl,
      betaApkUrl,
      showChannelSwitcher: true,
    };
  }

  if (/\/beta(?:\/|$)/.test(pathname)) {
    return {
      channel: 'beta',
      badgeLabel: 'BETA',
      prNumber: null,
      stableWebUrl,
      betaWebUrl,
      betaApkUrl,
      showChannelSwitcher: true,
    };
  }

  const isLocalDev = /^https?:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?$/i.test(cleanOrigin);
  return {
    channel: isLocalDev ? 'dev' : 'stable',
    badgeLabel: null,
    prNumber: null,
    stableWebUrl,
    betaWebUrl,
    betaApkUrl,
    showChannelSwitcher: true,
  };
}
