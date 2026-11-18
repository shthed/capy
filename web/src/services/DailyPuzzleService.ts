import { GeneratorConfig, MAX_GENERATOR_CONFIG, SAMPLE_GALLERY, SampleArtwork } from '../types';

export interface DailyPresetVariation {
  id: string;
  label: string;
  description: string;
  config: GeneratorConfig;
}

export interface DailyFeaturedPuzzle {
  utcDate: string;
  epochDay: number;
  snapshotId: string;
  sample: SampleArtwork;
  presetId: string;
  presetLabel: string;
  presetDescription: string;
  config: GeneratorConfig;
}

/**
 * Curated preset variations (length 5, coprime with SAMPLE_GALLERY length 4 for a 20-day
 * full-cycle rotation where consecutive UTC days always vary both artwork and preset).
 */
export const DAILY_PRESET_VARIATIONS: readonly DailyPresetVariation[] = [
  {
    id: 'balanced-classic',
    label: 'Max Detail (Auto)',
    description: 'Max Detail (64 colours • 2000 pieces)',
    config: {
      ...MAX_GENERATOR_CONFIG,
      algorithm: 'AUTO',
    },
  },
  {
    id: 'cozy-relax',
    label: 'Max Detail (Auto)',
    description: 'Max Detail (64 colours • 2000 pieces)',
    config: {
      ...MAX_GENERATOR_CONFIG,
      algorithm: 'AUTO',
    },
  },
  {
    id: 'crisp-posterized',
    label: 'Crisp Posterized (Max Detail)',
    description: 'Posterized • Max Detail (64 colours • 2000 pieces)',
    config: {
      ...MAX_GENERATOR_CONFIG,
      algorithm: 'POSTERIZED',
    },
  },
  {
    id: 'stained-mosaic',
    label: 'Stained Mosaic (Max Detail)',
    description: 'Mosaic Cells • Max Detail (64 colours • 2000 pieces)',
    config: {
      ...MAX_GENERATOR_CONFIG,
      algorithm: 'MOSAIC_CEL',
    },
  },
  {
    id: 'detailed-challenge',
    label: 'Max Detail (Auto)',
    description: 'Max Detail (64 colours • 2000 pieces)',
    config: {
      ...MAX_GENERATOR_CONFIG,
      algorithm: 'AUTO',
    },
  },
];

function parseUtcDateToEpochDay(utcDateStr?: string): { utcDate: string; epochDay: number } {
  const trimmed = typeof utcDateStr === 'string' ? utcDateStr.trim() : '';
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  if (match) {
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const utcMs = Date.UTC(year, month - 1, day);
    if (Number.isFinite(utcMs)) {
      const normalized = new Date(utcMs).toISOString().slice(0, 10);
      return {
        utcDate: normalized,
        epochDay: Math.floor(utcMs / 86_400_000),
      };
    }
  }

  const fallbackIso = new Date().toISOString().slice(0, 10);
  const [y, m, d] = fallbackIso.split('-').map(Number);
  const utcMs = Date.UTC(y, m - 1, d);
  return {
    utcDate: fallbackIso,
    epochDay: Math.floor(utcMs / 86_400_000),
  };
}

function positiveMod(value: number, modulus: number): number {
  return ((value % modulus) + modulus) % modulus;
}

export function getDailyPrebakedSnapshotId(sampleId: string, presetId: string): string {
  return `daily-${sampleId}-${presetId}`;
}

/**
 * Pure, 100% offline deterministic selector mapping a YYYY-MM-DD UTC date
 * to an identical curated SAMPLE_GALLERY artwork and preset variation across all devices.
 */
export function getDailyFeaturedPuzzle(utcDateStr?: string): DailyFeaturedPuzzle {
  const { utcDate, epochDay } = parseUtcDateToEpochDay(utcDateStr);
  const sampleIdx = positiveMod(epochDay, SAMPLE_GALLERY.length);
  const presetIdx = positiveMod(epochDay, DAILY_PRESET_VARIATIONS.length);

  const sample = SAMPLE_GALLERY[sampleIdx];
  const preset = DAILY_PRESET_VARIATIONS[presetIdx];
  const isFreeColor = Boolean(sample.isFreeColor);

  const config: GeneratorConfig = {
    ...MAX_GENERATOR_CONFIG,
    algorithm: preset.config.algorithm || MAX_GENERATOR_CONFIG.algorithm,
    lineHandling: preset.config.lineHandling || MAX_GENERATOR_CONFIG.lineHandling,
    ...(isFreeColor
      ? {
          algorithm: 'LINE_ART',
          imageType: 'DRAWING',
          isFreeColor: true,
        }
      : {}),
  };

  return {
    utcDate,
    epochDay,
    snapshotId: getDailyPrebakedSnapshotId(sample.id, preset.id),
    sample,
    presetId: preset.id,
    presetLabel: isFreeColor ? 'Free Colour Line Art • Max Detail' : preset.label,
    presetDescription: isFreeColor
      ? 'Free Colour • Max Detail (20 colours • up to 2000 pieces)'
      : preset.description,
    config,
  };
}
