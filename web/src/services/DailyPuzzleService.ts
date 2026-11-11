import { GeneratorConfig, SAMPLE_GALLERY, SampleArtwork } from '../types';

export interface DailyPresetVariation {
  id: string;
  label: string;
  description: string;
  config: GeneratorConfig;
}

export interface DailyFeaturedPuzzle {
  utcDate: string;
  epochDay: number;
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
    label: 'Balanced Classic',
    description: '16 colours • Medium pieces',
    config: {
      algorithm: 'AUTO',
      lineHandling: 'ABSORB_LINES',
      preset: 'MEDIUM',
      paletteDetail: 'AUTO',
      imageType: 'AUTO',
      colorCount: 16,
      minRegionArea: 48,
      maxRegions: 200,
      resolution: 1024,
      smoothingPasses: 2,
    },
  },
  {
    id: 'cozy-relax',
    label: 'Cozy Quick',
    description: '10 colours • Relaxed pieces',
    config: {
      algorithm: 'AUTO',
      lineHandling: 'ABSORB_LINES',
      preset: 'LOW',
      paletteDetail: 'LOW',
      imageType: 'AUTO',
      colorCount: 10,
      minRegionArea: 64,
      maxRegions: 120,
      resolution: 768,
      smoothingPasses: 2,
    },
  },
  {
    id: 'crisp-posterized',
    label: 'Crisp Posterized',
    description: '18 colours • Bold edges',
    config: {
      algorithm: 'POSTERIZED',
      lineHandling: 'ABSORB_LINES',
      preset: 'MEDIUM',
      paletteDetail: 'MEDIUM',
      imageType: 'AUTO',
      colorCount: 18,
      minRegionArea: 44,
      maxRegions: 220,
      resolution: 896,
      smoothingPasses: 2,
    },
  },
  {
    id: 'stained-mosaic',
    label: 'Stained Mosaic',
    description: '16 colours • Mosaic cells',
    config: {
      algorithm: 'MOSAIC_CEL',
      lineHandling: 'ABSORB_LINES',
      preset: 'MEDIUM',
      paletteDetail: 'MEDIUM',
      imageType: 'AUTO',
      colorCount: 16,
      minRegionArea: 48,
      maxRegions: 200,
      resolution: 896,
      smoothingPasses: 2,
    },
  },
  {
    id: 'detailed-challenge',
    label: 'Detailed Challenge',
    description: '24 colours • Fine detail',
    config: {
      algorithm: 'AUTO',
      lineHandling: 'ABSORB_LINES',
      preset: 'HIGH',
      paletteDetail: 'HIGH',
      imageType: 'AUTO',
      colorCount: 24,
      minRegionArea: 36,
      maxRegions: 280,
      resolution: 1024,
      smoothingPasses: 1,
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
    ...preset.config,
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
    sample,
    presetId: preset.id,
    presetLabel: isFreeColor ? `${preset.label} • Free Colour` : preset.label,
    presetDescription: preset.description,
    config,
  };
}
