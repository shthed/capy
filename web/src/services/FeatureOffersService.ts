import { NativeBridge } from './NativeBridge';
import { reportSwallowed } from './telemetry';
import { SafeLocalStore } from './storage/SafeLocalStore';
import {
  FEATURE_OFFERS_KEY,
  resolveScopedBackupKey,
  resolveScopedStorageKey,
} from './storage/StorageKeys';

export { FEATURE_OFFERS_KEY };

export type FeatureOfferId =
  | 'paint_mode'
  | 'undo_replay'
  | 'replay_scrubber'
  | 'free_color'
  | 'create_gallery'
  | 'photo_upload'
  | 'infinite_zoom'
  | 'saves_export'
  | 'settings_hints_tip';

export interface FeatureOfferDef {
  id: FeatureOfferId;
  title: string;
  message: string;
  tutorialStepIndex: number;
}

export const FEATURE_OFFERS: Record<FeatureOfferId, FeatureOfferDef> = {
  paint_mode: {
    id: 'paint_mode',
    title: 'Brush Mode On',
    message:
      'Drag your finger across shapes to fill them fast. Use two fingers to move the picture.',
    tutorialStepIndex: 1,
  },
  undo_replay: {
    id: 'undo_replay',
    title: 'Undo, Redo & Replay',
    message:
      'Use Undo or Redo on the right anytime, or hold Undo to watch a replay.',
    tutorialStepIndex: 4,
  },
  replay_scrubber: {
    id: 'replay_scrubber',
    title: 'Replay Controls',
    message:
      'Use this bar to scrub your progress, change speed, or toggle Follow and Loop.',
    tutorialStepIndex: 5,
  },
  free_color: {
    id: 'free_color',
    title: 'Paint Any Color',
    message:
      'Tap + Custom in the color bar to pick your own colors or try a preset theme.',
    tutorialStepIndex: 7,
  },
  create_gallery: {
    id: 'create_gallery',
    title: 'Daily Puzzle & Gallery',
    message:
      'Open Create in the menu for today’s Daily Puzzle, extra pictures, and photo puzzles.',
    tutorialStepIndex: 8,
  },
  photo_upload: {
    id: 'photo_upload',
    title: 'Photo Styles',
    message:
      'Adjust puzzle style and detail level anytime under Create in the menu.',
    tutorialStepIndex: 8,
  },
  infinite_zoom: {
    id: 'infinite_zoom',
    title: 'Infinite Zoom Ready',
    message:
      'Use the Outer / Inner buttons top-left to move between linked zoom views, or open the right-side Infinite Zoom button anytime to add detail or extend borders.',
    tutorialStepIndex: 8,
  },
  saves_export: {
    id: 'saves_export',
    title: 'Saved Pictures',
    message:
      'Pin favorites, rename pictures, save backups, or print coloring pages here.',
    tutorialStepIndex: 9,
  },
  settings_hints_tip: {
    id: 'settings_hints_tip',
    title: 'New Settings & Hints',
    message:
      'Settings are now grouped into clean sections, with a dedicated Hints tab to customize highlight style, color, and auto-pan.',
    tutorialStepIndex: 10,
  },
};

export const FEATURE_OFFER_IDS = Object.keys(FEATURE_OFFERS) as FeatureOfferId[];

function isFeatureOfferId(value: unknown): value is FeatureOfferId {
  return typeof value === 'string' && value in FEATURE_OFFERS;
}

export class FeatureOffersService {
  static loadSeenOffers(): Set<FeatureOfferId> {
    const seen = new Set<FeatureOfferId>();
    try {
      const storageKey = resolveScopedStorageKey(FEATURE_OFFERS_KEY);
      const backupKey = resolveScopedBackupKey(FEATURE_OFFERS_KEY);
      const rawLocal = SafeLocalStore.getItem(storageKey);
      const rawBackup = rawLocal ? null : NativeBridge.loadBackup(backupKey);
      const raw = rawLocal || rawBackup;
      if (!raw) return seen;

      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return seen;

      for (const item of parsed) {
        if (isFeatureOfferId(item)) {
          seen.add(item);
        }
      }

      if (!rawLocal && seen.size > 0) {
        SafeLocalStore.setItem(storageKey, JSON.stringify(Array.from(seen)));
      }
    } catch (err) {
      reportSwallowed('FeatureOffersService.loadSeenOffers', err);
    }
    return seen;
  }

  static hasSeenOffer(id: FeatureOfferId): boolean {
    return this.loadSeenOffers().has(id);
  }

  static markOfferSeen(id: FeatureOfferId): FeatureOfferId[] {
    const seen = this.loadSeenOffers();
    seen.add(id);
    const list = Array.from(seen);
    const serialized = JSON.stringify(list);
    SafeLocalStore.setItem(resolveScopedStorageKey(FEATURE_OFFERS_KEY), serialized);
    NativeBridge.saveBackup(resolveScopedBackupKey(FEATURE_OFFERS_KEY), serialized);
    return list;
  }

  static resetSeenOffers(): void {
    SafeLocalStore.removeItem(resolveScopedStorageKey(FEATURE_OFFERS_KEY));
    NativeBridge.saveBackup(resolveScopedBackupKey(FEATURE_OFFERS_KEY), '[]');
  }
}

if (typeof window !== 'undefined') {
  (
    window as unknown as {
      capyFeatureOffers?: typeof FeatureOffersService;
    }
  ).capyFeatureOffers = FeatureOffersService;
}
