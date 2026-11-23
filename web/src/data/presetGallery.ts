import { GeneratorConfig } from '../types';

export const GALLERY_FILTER_TAGS = [
  'All',
  'Animals',
  'Coloring',
  'Nature',
  'Line Art',
  'Detailed',
  'Music',
] as const;

export interface PresetGalleryEntry {
  id: string;
  category: 'ALGORITHM' | 'BORDER' | 'DETAIL';
  title: string;
  badge: string;
  image: string;
  howItWorks: string;
  bestFor: string;
  stats: string;
  isMatch: (cfg: GeneratorConfig) => boolean;
  apply: (prev: GeneratorConfig) => GeneratorConfig;
}

export const PRESET_GALLERY_ITEMS: PresetGalleryEntry[] = [
  {
    id: 'algo-auto',
    category: 'ALGORITHM',
    title: 'Auto Detect',
    badge: 'Default',
    image: './assets/presets/algo-auto.png',
    howItWorks:
      'Scans ink strokes and gradients, then picks Line Art, Painterly, or Posterized automatically.',
    bestFor: 'Any photo or drawing when you want instant balanced results',
    stats: 'Adaptive strategy',
    isMatch: (c) => (c.algorithm || 'AUTO') === 'AUTO',
    apply: (prev) => ({ ...prev, algorithm: 'AUTO', imageType: 'AUTO' }),
  },
  {
    id: 'algo-line-art',
    category: 'ALGORITHM',
    title: 'Line Art Tracer',
    badge: 'Ink & Outlines',
    image: './assets/presets/algo-line-art.png',
    howItWorks:
      'Detects dark drawn outlines and snaps region boundaries tightly along ink strokes.',
    bestFor: 'Cartoons, comics, manga, and coloring pages',
    stats: 'Crisp ink edges',
    isMatch: (c) => c.algorithm === 'LINE_ART',
    apply: (prev) => ({ ...prev, algorithm: 'LINE_ART', imageType: 'DRAWING' }),
  },
  {
    id: 'algo-painterly',
    category: 'ALGORITHM',
    title: 'Painterly (Photo)',
    badge: 'Photos',
    image: './assets/presets/algo-painterly.png',
    howItWorks:
      'Smooths photographic textures with a Kuwahara cel filter into organic paintable shapes.',
    bestFor: 'Photos, portraits, pets, and natural scenery',
    stats: 'Smooth cel-shading',
    isMatch: (c) => c.algorithm === 'PAINTERLY',
    apply: (prev) => ({ ...prev, algorithm: 'PAINTERLY', imageType: 'PHOTO' }),
  },
  {
    id: 'algo-posterized',
    category: 'ALGORITHM',
    title: 'Posterized',
    badge: 'Flat Graphic',
    image: './assets/presets/algo-posterized.png',
    howItWorks:
      'Applies median sharpening without smoothing for crisp, angular color boundaries.',
    bestFor: 'Logos, posters, and flat vector illustrations',
    stats: 'Sharp geometric edges',
    isMatch: (c) => c.algorithm === 'POSTERIZED',
    apply: (prev) => ({ ...prev, algorithm: 'POSTERIZED', imageType: 'AUTO' }),
  },
  {
    id: 'algo-mosaic',
    category: 'ALGORITHM',
    title: 'Mosaic Cells',
    badge: 'Stained Glass',
    image: './assets/presets/algo-mosaic.png',
    howItWorks: 'Tessellates the canvas into evenly sized spatial-color superpixel tiles.',
    bestFor: 'Turning any image into a stained-glass mosaic puzzle',
    stats: 'Even convex tiles',
    isMatch: (c) => c.algorithm === 'MOSAIC_CEL',
    apply: (prev) => ({ ...prev, algorithm: 'MOSAIC_CEL', imageType: 'AUTO' }),
  },
  {
    id: 'border-absorb',
    category: 'BORDER',
    title: 'Boundaries Follow Artwork Lines',
    badge: 'Default Border',
    image: './assets/presets/border-absorb.png',
    howItWorks:
      'Expands neighboring color regions symmetrically into ink lines so seams meet at stroke centers.',
    bestFor: 'Clean color-by-number shapes without painting black outlines',
    stats: 'Stroke-center seams',
    isMatch: (c) => (c.lineHandling || 'ABSORB_LINES') === 'ABSORB_LINES',
    apply: (prev) => ({ ...prev, lineHandling: 'ABSORB_LINES' }),
  },
  {
    id: 'border-unified',
    category: 'BORDER',
    title: 'Continuous Black Line Region',
    badge: 'Playable Ink',
    image: './assets/presets/border-unified.png',
    howItWorks:
      'Groups all dark ink outlines into a single dedicated playable region with its own swatch.',
    bestFor: 'Comic/ink styles where you want to color the outlines too',
    stats: 'Unified outline swatch',
    isMatch: (c) => c.lineHandling === 'UNIFIED_BLACK_REGION',
    apply: (prev) => ({
      ...prev,
      algorithm:
        prev.algorithm === 'PAINTERLY' ||
        prev.algorithm === 'POSTERIZED' ||
        prev.algorithm === 'MOSAIC_CEL'
          ? 'LINE_ART'
          : prev.algorithm,
      lineHandling: 'UNIFIED_BLACK_REGION',
    }),
  },
  {
    id: 'detail-low',
    category: 'DETAIL',
    title: 'Low Detail / Simple',
    badge: 'Quick & Relaxing',
    image: './assets/presets/detail-low.png',
    howItWorks: 'Caps palette to ~8-12 colors with larger, simpler shapes and fewer small pieces.',
    bestFor: 'Fast 5-minute sessions and larger easy-to-tap shapes',
    stats: '~10 colors • ~100 pieces',
    isMatch: (c) => c.paletteDetail === 'LOW',
    apply: (prev) => ({
      ...prev,
      paletteDetail: 'LOW',
      colorCount: 10,
      maxRegions: 100,
      minRegionArea: 96,
    }),
  },
  {
    id: 'detail-medium',
    category: 'DETAIL',
    title: 'Medium Detail / Standard',
    badge: 'Balanced',
    image: './assets/presets/detail-medium.png',
    howItWorks:
      'Balances ~14-24 colors and ~250 pieces for clear artwork detail without tiny speckles.',
    bestFor: 'Everyday puzzles with a comfortable pace',
    stats: '~18 colors • ~250 pieces',
    isMatch: (c) => c.paletteDetail === 'MEDIUM',
    apply: (prev) => ({
      ...prev,
      paletteDetail: 'MEDIUM',
      colorCount: 18,
      maxRegions: 250,
      minRegionArea: 48,
    }),
  },
  {
    id: 'detail-high',
    category: 'DETAIL',
    title: 'High Detail / Detailed',
    badge: 'Intricate',
    image: './assets/presets/detail-high.png',
    howItWorks:
      'Expands palette to ~30-50 colors and allows finer 24 px² regions up to ~500 pieces.',
    bestFor: 'Rich shading, zoom-in detail, and longer relaxing sessions',
    stats: '~38 colors • ~500 pieces',
    isMatch: (c) => c.paletteDetail === 'HIGH',
    apply: (prev) => ({
      ...prev,
      paletteDetail: 'HIGH',
      colorCount: 38,
      maxRegions: 500,
      minRegionArea: 24,
    }),
  },
];

export const STANDARD_RESOLUTIONS = [
  { label: '512p (Fast)', val: 512 },
  { label: '720p (HD)', val: 720 },
  { label: '1024p (Std)', val: 1024 },
  { label: '1280p (Sharp)', val: 1280 },
  { label: '1440p (2K)', val: 1440 },
  { label: '2048p (Ultra)', val: 2048 },
] as const;
