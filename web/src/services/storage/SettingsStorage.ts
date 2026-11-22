import { DEFAULT_GENERATOR_CONFIG, GeneratorConfig, UserSettings } from '../../types';
import { reportSwallowed } from '../telemetry';
import {
  BackupCandidateValidator,
  getMaxPersistedObjectTimestamp,
  loadRawWithBackupFallbackWithMeta,
  writeLocalAndScheduleBackup,
} from './BackupEngine';
import { SafeLocalStore } from './SafeLocalStore';
import {
  resolveScopedBackupKey,
  resolveScopedStorageKey,
  SETTINGS_KEY,
  UNDO_DEFAULT_MIGRATED_KEY,
} from './StorageKeys';

export const DEFAULT_SETTINGS: UserSettings = {
  autoAdvance: true,
  difficulty: 'EASY',
  fatFingerAssist: true,
  touchReachRadiusPx: 22,
  isPaintMode: false,
  isFreeColorMode: false,
  raisePaletteDock: true,
  regionColorMode: 'DETAIL',
  canvasBgColor: 'CHARCOAL',
  canvasBgArgb: 0xff18181b,
  saveSortOrder: 'LAST_ACTIVE',
  highlightStyle: 'FULL_REGION',
  hintFillStyle: 'CHECKER',
  hintColorArgb: 0xfff59e0b,
  showRegionLabels: true,
  showPreviewLabels: false,
  showPreviewBorders: false,
  highlightMatching: true,
  animateHint: true,
  showNextRegionHint: true,
  hintIntensity: 0.65,
  labelScale: 1.0,
  minLabelSize: 6,
  maxLabelSize: 18,
  showZoomButtons: false,
  showResetViewButton: false,
  paletteSort: 'HUE',
  prioritizeOnScreen: false,
  hapticsEnabled: true,
  panMomentum: true,
  enableCustomColorForAllPuzzles: false,
  enableUndo: true,
  replaySpeed: 1,
  autoReplayOnLoad: false,
  replayLoop: false,
  replayFollow: false,
  reverseDoubleTapZoom: false,
  zoomSensitivity: 1.0,
  snapZoomLevels: false,
  soundEnabled: true,
  soundVolume: 0.7,
  reducedMotion: false,
  largeText: false,
  textScale: 1.0,
  uiScale: 1.0,
  detailedLoadingProgress: false,
  generatorConfig: { ...DEFAULT_GENERATOR_CONFIG },
};

const DEFAULT_SETTINGS_KEYS = new Set<string>(Object.keys(DEFAULT_SETTINGS));

const SETTINGS_BOOLEAN_KEYS = [
  'autoAdvance',
  'fatFingerAssist',
  'isPaintMode',
  'isFreeColorMode',
  'raisePaletteDock',
  'showRegionLabels',
  'showPreviewLabels',
  'showPreviewBorders',
  'highlightMatching',
  'animateHint',
  'showNextRegionHint',
  'showZoomButtons',
  'showResetViewButton',
  'prioritizeOnScreen',
  'hapticsEnabled',
  'panMomentum',
  'enableCustomColorForAllPuzzles',
  'enableUndo',
  'autoReplayOnLoad',
  'replayLoop',
  'replayFollow',
  'reverseDoubleTapZoom',
  'snapZoomLevels',
  'soundEnabled',
  'reducedMotion',
  'largeText',
  'detailedLoadingProgress',
] as const;

const SETTINGS_NUMBER_KEYS = [
  'touchReachRadiusPx',
  'canvasBgArgb',
  'hintColorArgb',
  'hintIntensity',
  'labelScale',
  'minLabelSize',
  'maxLabelSize',
  'replaySpeed',
  'zoomSensitivity',
  'soundVolume',
  'textScale',
  'uiScale',
] as const;

const SETTINGS_ENUM_VALUES: Record<string, readonly string[]> = {
  difficulty: ['EASY', 'NORMAL'],
  regionColorMode: ['DETAIL', 'SOLID'],
  canvasBgColor: ['BLACK', 'DARK_SLATE', 'CHARCOAL', 'LIGHT_GRAY', 'PURE_WHITE', 'CUSTOM'],
  saveSortOrder: ['LAST_ACTIVE', 'DATE', 'PERCENT_COMPLETE'],
  highlightStyle: ['CENTROID_GLOW', 'NUMBER_ONLY', 'FULL_REGION', 'BOUNDARY_ONLY'],
  hintFillStyle: ['CHECKER', 'STRIPES', 'SOLID'],
  paletteSort: ['NUMBER', 'REMAINING', 'HUE', 'LIGHTNESS'],
};

const GEN_CONFIG_ENUM_VALUES: Record<string, readonly string[]> = {
  algorithm: ['AUTO', 'LINE_ART', 'PAINTERLY', 'POSTERIZED', 'MOSAIC_CEL'],
  lineHandling: ['ABSORB_LINES', 'UNIFIED_BLACK_REGION'],
  preset: ['LOW', 'MEDIUM', 'HIGH', 'CUSTOM'],
  paletteDetail: ['AUTO', 'LOW', 'MEDIUM', 'HIGH', 'CUSTOM'],
  imageType: ['AUTO', 'DRAWING', 'PHOTO'],
};

const GEN_CONFIG_NUMBER_KEYS = [
  'colorCount',
  'minRegionArea',
  'maxRegions',
  'resolution',
  'smoothingPasses',
] as const;

function detectSystemReducedMotion(): boolean {
  try {
    return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
      : false;
  } catch {
    return false;
  }
}

function hasRecognizedGeneratorConfigField(cfg: Record<string, unknown>): boolean {
  const hasOwn = (key: string) => Object.prototype.hasOwnProperty.call(cfg, key);
  for (const [key, allowed] of Object.entries(GEN_CONFIG_ENUM_VALUES)) {
    if (!hasOwn(key)) continue;
    const val = cfg[key];
    if (typeof val === 'string' && allowed.includes(val)) return true;
  }
  for (const key of GEN_CONFIG_NUMBER_KEYS) {
    if (hasOwn(key) && typeof cfg[key] === 'number' && Number.isFinite(cfg[key])) return true;
  }
  return hasOwn('isFreeColor') && typeof cfg.isFreeColor === 'boolean';
}

export function hasRecognizedSettingsField(rec: Record<string, unknown>): boolean {
  const hasOwn = (obj: Record<string, unknown>, key: string) =>
    Object.prototype.hasOwnProperty.call(obj, key);
  for (const key of SETTINGS_BOOLEAN_KEYS) {
    if (hasOwn(rec, key) && typeof rec[key] === 'boolean') return true;
  }
  for (const key of SETTINGS_NUMBER_KEYS) {
    if (hasOwn(rec, key) && typeof rec[key] === 'number' && Number.isFinite(rec[key])) return true;
  }
  for (const [key, allowed] of Object.entries(SETTINGS_ENUM_VALUES)) {
    if (!hasOwn(rec, key)) continue;
    const val = rec[key];
    if (typeof val === 'string' && allowed.includes(val)) return true;
  }
  if (
    hasOwn(rec, 'generatorConfig') &&
    rec.generatorConfig &&
    typeof rec.generatorConfig === 'object' &&
    !Array.isArray(rec.generatorConfig)
  ) {
    return hasRecognizedGeneratorConfigField(rec.generatorConfig as Record<string, unknown>);
  }
  return false;
}

const SETTINGS_VALIDATOR: BackupCandidateValidator = {
  hasRecognizedSettingsField,
  defaultSettingsKeys: DEFAULT_SETTINGS_KEYS,
};

function sanitizeGeneratorConfig(rawCfg: unknown): GeneratorConfig {
  const defaults = DEFAULT_SETTINGS.generatorConfig;
  if (!rawCfg || typeof rawCfg !== 'object' || Array.isArray(rawCfg)) {
    return { ...defaults };
  }
  const cfg = rawCfg as Record<string, unknown>;
  const pickEnum = <T extends string>(key: string, fallback: T): T => {
    const val = cfg[key];
    const allowed = GEN_CONFIG_ENUM_VALUES[key];
    return typeof val === 'string' && allowed?.includes(val) ? (val as T) : fallback;
  };
  const pickFinite = (key: (typeof GEN_CONFIG_NUMBER_KEYS)[number], fallback: number): number => {
    const val = cfg[key];
    return typeof val === 'number' && Number.isFinite(val) ? val : fallback;
  };
  return {
    algorithm: pickEnum('algorithm', defaults.algorithm ?? 'AUTO'),
    lineHandling: pickEnum('lineHandling', defaults.lineHandling ?? 'ABSORB_LINES'),
    preset: pickEnum('preset', defaults.preset ?? 'MEDIUM'),
    paletteDetail: pickEnum('paletteDetail', defaults.paletteDetail),
    imageType: pickEnum('imageType', defaults.imageType),
    colorCount: pickFinite('colorCount', defaults.colorCount),
    minRegionArea: pickFinite('minRegionArea', defaults.minRegionArea),
    maxRegions: pickFinite('maxRegions', defaults.maxRegions),
    resolution: pickFinite('resolution', defaults.resolution),
    smoothingPasses: pickFinite('smoothingPasses', defaults.smoothingPasses),
    ...(typeof cfg.isFreeColor === 'boolean' ? { isFreeColor: cfg.isFreeColor } : {}),
  };
}

function tryParseSettingsObject(
  raw: string | null
): { status: 'empty' | 'ok' | 'corrupt'; parsed: Record<string, unknown> | null } {
  if (!raw) return { status: 'empty', parsed: null };
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { status: 'corrupt', parsed: null };
    }
    const record = parsed as Record<string, unknown>;
    if (!hasRecognizedSettingsField(record)) {
      return { status: 'corrupt', parsed: null };
    }
    return { status: 'ok', parsed: record };
  } catch {
    return { status: 'corrupt', parsed: null };
  }
}

function pickSettingsEnum<K extends keyof UserSettings>(
  parsed: Record<string, unknown>,
  key: K
): UserSettings[K] {
  const val = parsed[key];
  const allowed = SETTINGS_ENUM_VALUES[key as string];
  if (typeof val === 'string' && allowed?.includes(val)) {
    return val as UserSettings[K];
  }
  return DEFAULT_SETTINGS[key];
}

function resolveUserSettings(
  parsed: Record<string, unknown>,
  systemReducedMotion: boolean,
  hasUndoMigration: boolean
): UserSettings {
  const pickBool = (key: keyof UserSettings, fallback: boolean): boolean =>
    typeof parsed[key] === 'boolean' ? (parsed[key] as boolean) : fallback;
  const pickFinite = (key: keyof UserSettings, fallback: number): number => {
    const val = parsed[key];
    return typeof val === 'number' && Number.isFinite(val) ? val : fallback;
  };
  const rawReplaySpeed = parsed.replaySpeed;
  const replaySpeed =
    typeof rawReplaySpeed === 'number' &&
    Number.isFinite(rawReplaySpeed) &&
    rawReplaySpeed > 0 &&
    rawReplaySpeed <= 20
      ? rawReplaySpeed
      : DEFAULT_SETTINGS.replaySpeed;

  const rawLargeText = pickBool('largeText', DEFAULT_SETTINGS.largeText);
  const hasExplicitTextScale =
    typeof parsed.textScale === 'number' && Number.isFinite(parsed.textScale);
  const hasExplicitUiScale =
    typeof parsed.uiScale === 'number' && Number.isFinite(parsed.uiScale);
  const legacyDefaultedScales =
    rawLargeText &&
    (!hasExplicitTextScale || parsed.textScale === 1.0) &&
    (!hasExplicitUiScale || parsed.uiScale === 1.0);
  const rawTextScale = legacyDefaultedScales
    ? 1.25
    : hasExplicitTextScale
      ? (parsed.textScale as number)
      : DEFAULT_SETTINGS.textScale;
  const rawUiScale = legacyDefaultedScales
    ? 1.25
    : hasExplicitUiScale
      ? (parsed.uiScale as number)
      : DEFAULT_SETTINGS.uiScale;
  const textScale = Math.round(Math.min(1.5, Math.max(0.85, rawTextScale)) * 100) / 100;
  const uiScale = Math.round(Math.min(1.4, Math.max(0.85, rawUiScale)) * 100) / 100;
  const largeText = textScale > 1.0 || uiScale > 1.0;

  return {
    autoAdvance: pickBool('autoAdvance', DEFAULT_SETTINGS.autoAdvance),
    difficulty: pickSettingsEnum(parsed, 'difficulty'),
    fatFingerAssist: pickBool('fatFingerAssist', DEFAULT_SETTINGS.fatFingerAssist),
    touchReachRadiusPx: Math.round(
      Math.min(40, Math.max(8, pickFinite('touchReachRadiusPx', DEFAULT_SETTINGS.touchReachRadiusPx)))
    ),
    isPaintMode: pickBool('isPaintMode', DEFAULT_SETTINGS.isPaintMode),
    isFreeColorMode: pickBool('isFreeColorMode', DEFAULT_SETTINGS.isFreeColorMode),
    raisePaletteDock: pickBool('raisePaletteDock', DEFAULT_SETTINGS.raisePaletteDock),
    regionColorMode: pickSettingsEnum(parsed, 'regionColorMode'),
    canvasBgColor: pickSettingsEnum(parsed, 'canvasBgColor'),
    canvasBgArgb: pickFinite('canvasBgArgb', DEFAULT_SETTINGS.canvasBgArgb),
    saveSortOrder: pickSettingsEnum(parsed, 'saveSortOrder'),
    highlightStyle: pickSettingsEnum(parsed, 'highlightStyle'),
    hintFillStyle: pickSettingsEnum(parsed, 'hintFillStyle'),
    hintColorArgb: pickFinite('hintColorArgb', DEFAULT_SETTINGS.hintColorArgb),
    showRegionLabels: pickBool('showRegionLabels', DEFAULT_SETTINGS.showRegionLabels),
    showPreviewLabels: pickBool('showPreviewLabels', DEFAULT_SETTINGS.showPreviewLabels),
    showPreviewBorders: pickBool('showPreviewBorders', DEFAULT_SETTINGS.showPreviewBorders),
    highlightMatching: pickBool('highlightMatching', DEFAULT_SETTINGS.highlightMatching),
    animateHint: pickBool('animateHint', DEFAULT_SETTINGS.animateHint),
    showNextRegionHint: pickBool('showNextRegionHint', DEFAULT_SETTINGS.showNextRegionHint),
    hintIntensity: pickFinite('hintIntensity', DEFAULT_SETTINGS.hintIntensity),
    labelScale: pickFinite('labelScale', DEFAULT_SETTINGS.labelScale),
    minLabelSize: pickFinite('minLabelSize', DEFAULT_SETTINGS.minLabelSize),
    maxLabelSize: pickFinite('maxLabelSize', DEFAULT_SETTINGS.maxLabelSize),
    showZoomButtons: pickBool('showZoomButtons', DEFAULT_SETTINGS.showZoomButtons),
    showResetViewButton: pickBool('showResetViewButton', DEFAULT_SETTINGS.showResetViewButton),
    paletteSort: pickSettingsEnum(parsed, 'paletteSort'),
    prioritizeOnScreen: pickBool('prioritizeOnScreen', DEFAULT_SETTINGS.prioritizeOnScreen),
    hapticsEnabled: pickBool('hapticsEnabled', DEFAULT_SETTINGS.hapticsEnabled),
    panMomentum: pickBool('panMomentum', DEFAULT_SETTINGS.panMomentum),
    enableCustomColorForAllPuzzles: pickBool(
      'enableCustomColorForAllPuzzles',
      DEFAULT_SETTINGS.enableCustomColorForAllPuzzles
    ),
    enableUndo: hasUndoMigration ? pickBool('enableUndo', DEFAULT_SETTINGS.enableUndo) : true,
    replaySpeed,
    autoReplayOnLoad: pickBool('autoReplayOnLoad', DEFAULT_SETTINGS.autoReplayOnLoad),
    replayLoop: pickBool('replayLoop', DEFAULT_SETTINGS.replayLoop),
    replayFollow: pickBool('replayFollow', DEFAULT_SETTINGS.replayFollow),
    reverseDoubleTapZoom: pickBool('reverseDoubleTapZoom', DEFAULT_SETTINGS.reverseDoubleTapZoom),
    zoomSensitivity: Math.min(
      2.0,
      Math.max(0.5, pickFinite('zoomSensitivity', DEFAULT_SETTINGS.zoomSensitivity))
    ),
    snapZoomLevels: pickBool('snapZoomLevels', DEFAULT_SETTINGS.snapZoomLevels),
    soundEnabled: pickBool('soundEnabled', DEFAULT_SETTINGS.soundEnabled),
    soundVolume: Math.min(1.0, Math.max(0.0, pickFinite('soundVolume', DEFAULT_SETTINGS.soundVolume))),
    reducedMotion: pickBool('reducedMotion', systemReducedMotion),
    largeText,
    textScale,
    uiScale,
    detailedLoadingProgress: pickBool(
      'detailedLoadingProgress',
      DEFAULT_SETTINGS.detailedLoadingProgress
    ),
    generatorConfig: sanitizeGeneratorConfig(parsed.generatorConfig),
  };
}

export function loadSettings(): UserSettings {
  const systemReducedMotion = detectSystemReducedMotion();
  try {
    const storageKey = resolveScopedStorageKey(SETTINGS_KEY);
    const backupKey = resolveScopedBackupKey(SETTINGS_KEY);
    const { raw, recoveredFromBackup } = loadRawWithBackupFallbackWithMeta(
      storageKey,
      backupKey,
      'settings',
      SETTINGS_VALIDATOR
    );
    if (!raw) {
      return {
        ...DEFAULT_SETTINGS,
        reducedMotion: systemReducedMotion,
      };
    }
    const parsedRes = tryParseSettingsObject(raw);
    if (parsedRes.status !== 'ok' || !parsedRes.parsed) {
      return {
        ...DEFAULT_SETTINGS,
        reducedMotion: systemReducedMotion,
      };
    }
    const parsed = parsedRes.parsed;
    const hasUndoMigration =
      Boolean(parsed.undoDefaultMigrated) ||
      SafeLocalStore.getScopedItem(UNDO_DEFAULT_MIGRATED_KEY) === '1';
    const resolved = resolveUserSettings(parsed, systemReducedMotion, hasUndoMigration);
    if (!hasUndoMigration && !recoveredFromBackup) {
      saveSettings(resolved);
    }
    return resolved;
  } catch (err) {
    reportSwallowed('SettingsStorage.loadSettings', err);
    return {
      ...DEFAULT_SETTINGS,
      reducedMotion: systemReducedMotion,
    };
  }
}

export function saveSettings(settings: UserSettings): void {
  try {
    const storageKey = resolveScopedStorageKey(SETTINGS_KEY);
    const backupKey = resolveScopedBackupKey(SETTINGS_KEY);
    const now = Date.now();
    const prevSavedAt = getMaxPersistedObjectTimestamp(storageKey, backupKey);
    const savedAt = prevSavedAt >= now ? prevSavedAt + 1 : now;
    const payload = { ...settings, undoDefaultMigrated: true, savedAt };
    const serialized = JSON.stringify(payload);
    writeLocalAndScheduleBackup(storageKey, backupKey, serialized);
    SafeLocalStore.setScopedItem(UNDO_DEFAULT_MIGRATED_KEY, '1', { notifyQuota: true });
  } catch (err) {
    reportSwallowed('SettingsStorage.saveSettings', err);
  }
}
