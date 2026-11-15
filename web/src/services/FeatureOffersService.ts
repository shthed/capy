import { NativeBridge } from './NativeBridge';
import { resolveScopedBackupKey, resolveScopedStorageKey } from './StorageNamespace';

export const FEATURE_OFFERS_KEY = 'capy_feature_offers_v1';

export type FeatureOfferId =
  | 'paint_mode'
  | 'undo_replay'
  | 'replay_scrubber'
  | 'free_color'
  | 'create_gallery'
  | 'photo_upload'
  | 'infinite_zoom'
  | 'saves_export'
  | 'cloud_coop';

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
      'Open this bar to change speed or keep coloring from any point in your replay.',
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
      'Open Create in the menu for today’s Daily Puzzle, extra pictures, and new ideas.',
    tutorialStepIndex: 8,
  },
  photo_upload: {
    id: 'photo_upload',
    title: 'Photo Styles',
    message:
      'Adjust puzzle style and detail level anytime under Create in the menu.',
    tutorialStepIndex: 9,
  },
  infinite_zoom: {
    id: 'infinite_zoom',
    title: 'Detail View Created',
    message:
      'Tap the Parent button in the top-left corner anytime to go back to your full picture.',
    tutorialStepIndex: 10,
  },
  saves_export: {
    id: 'saves_export',
    title: 'Saved Pictures',
    message:
      'Pin favorites, rename pictures, save backups, or print coloring pages here.',
    tutorialStepIndex: 11,
  },
  cloud_coop: {
    id: 'cloud_coop',
    title: 'Color Together',
    message:
      'Back up online, share a progress link, or join a live Co-op room with friends.',
    tutorialStepIndex: 12,
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
      const rawLocal = localStorage.getItem(storageKey);
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
        try {
          localStorage.setItem(storageKey, JSON.stringify(Array.from(seen)));
        } catch {
          // Ignored
        }
      }
    } catch {
      // Ignored
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
    try {
      localStorage.setItem(resolveScopedStorageKey(FEATURE_OFFERS_KEY), serialized);
    } catch {
      // Ignored
    }
    NativeBridge.saveBackup(resolveScopedBackupKey(FEATURE_OFFERS_KEY), serialized);
    return list;
  }

  static resetSeenOffers(): void {
    try {
      localStorage.removeItem(resolveScopedStorageKey(FEATURE_OFFERS_KEY));
    } catch {
      // Ignored
    }
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
