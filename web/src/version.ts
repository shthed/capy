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
