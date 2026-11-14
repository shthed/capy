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
    title: 'Paint Mode Drag-Fill',
    message:
      'Paint Mode is active — drag continuously across matching shapes. Two fingers or outer margins still pan.',
    tutorialStepIndex: 1,
  },
  undo_replay: {
    id: 'undo_replay',
    title: 'Undo, Redo & Long-Press Replay',
    message:
      'Made a slip? Redo appears above Undo if you change your mind, or long-press Undo anytime to scrub your replay.',
    tutorialStepIndex: 4,
  },
  replay_scrubber: {
    id: 'replay_scrubber',
    title: 'Timeline Replay Controls',
    message:
      'Expand Replay to switch speed (0.5x–20x), Follow Painting, Auto-Loop, or tap Resume Here from any step.',
    tutorialStepIndex: 5,
  },
  free_color: {
    id: 'free_color',
    title: 'Free Colour & Custom Palettes',
    message:
      'Paint any region any shade! Tap + Custom in the palette dock for HSL/Hex editing and 5 curated themes.',
    tutorialStepIndex: 7,
  },
  create_gallery: {
    id: 'create_gallery',
    title: 'Daily Puzzle & Artwork Gallery',
    message:
      'Try today’s UTC Puzzle of the Day, filter gallery categories, or vote on Community Puzzle Ideas in Menu > Create.',
    tutorialStepIndex: 8,
  },
  photo_upload: {
    id: 'photo_upload',
    title: 'Custom Photo Generator',
    message:
      'Tune Auto, Line Art, Painterly, Posterized, or Mosaic styles and outline handling anytime in Menu > Create.',
    tutorialStepIndex: 9,
  },
  infinite_zoom: {
    id: 'infinite_zoom',
    title: 'Infinite Zoom 2x Detail Tile',
    message:
      'Sub-puzzle created! Tap the Parent Puzzle pill in the top bar anytime to return to your saved view.',
    tutorialStepIndex: 10,
  },
  saves_export: {
    id: 'saves_export',
    title: 'Saves, .capy Backups & SVG',
    message:
      'Pin favorites, switch Thumbnails or Detail view, back up .capy files, or export Printable .svg sheets in Saves.',
    tutorialStepIndex: 11,
  },
  cloud_coop: {
    id: 'cloud_coop',
    title: 'Cloud Sync, Share Links & Live Co-op',
    message:
      'Sync across devices with Google or Play Games, share <2 KB progress links, or Host / Join a 6-char Co-op room.',
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
