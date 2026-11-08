export interface PaletteColor {
  id: number;
  hex: string;
  isLight: boolean;
  argb: number;
  r: number;
  g: number;
  b: number;
}

export interface Region {
  id: number;
  colorId: number;
  centroidX: number;
  centroidY: number;
  area: number;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  maxRadius: number;
  pixels: Int32Array;
}

export interface PuzzleData {
  width: number;
  height: number;
  palette: PaletteColor[];
  regions: Region[];
  regionMap: Int32Array;
  borderMap: Uint8Array; // 1 if border pixel, 0 otherwise
  isFreeColor?: boolean;
}

export type ImageType = 'AUTO' | 'DRAWING' | 'PHOTO';
export type GeneratorAlgorithm = 'AUTO' | 'LINE_ART' | 'PAINTERLY' | 'POSTERIZED' | 'MOSAIC_CEL';
export type LineHandlingMode = 'ABSORB_LINES' | 'UNIFIED_BLACK_REGION';
export type PaletteDetail = 'AUTO' | 'LOW' | 'MEDIUM' | 'HIGH' | 'CUSTOM';
export type Difficulty = 'NORMAL' | 'EASY';
export type PaletteSortOrder = 'NUMBER' | 'REMAINING' | 'HUE' | 'LIGHTNESS';
export type CanvasBgColor = 'BLACK' | 'DARK_SLATE' | 'CHARCOAL' | 'LIGHT_GRAY' | 'PURE_WHITE';
export type RegionColorMode = 'DETAIL' | 'SOLID';
export type RegionHighlightStyle = 'CENTROID_GLOW' | 'NUMBER_ONLY' | 'FULL_REGION' | 'BOUNDARY_ONLY';
export type HintFillStyle = 'SOLID' | 'CHECKER' | 'STRIPES';
export type SaveSortOrder = 'LAST_ACTIVE' | 'DATE' | 'PERCENT_COMPLETE';

export interface GeneratorConfig {
  algorithm?: GeneratorAlgorithm;
  lineHandling?: LineHandlingMode;
  preset?: 'LOW' | 'MEDIUM' | 'HIGH' | 'CUSTOM';
  paletteDetail: PaletteDetail;
  imageType: ImageType;
  colorCount: number;
  minRegionArea: number;
  maxRegions: number;
  resolution: number;
  smoothingPasses: number;
  isFreeColor?: boolean;
}

export interface UserSettings {
  autoAdvance: boolean;
  difficulty: Difficulty;
  isPaintMode: boolean;
  isFreeColorMode: boolean;
  raisePaletteDock: boolean;
  regionColorMode: RegionColorMode;
  canvasBgColor: CanvasBgColor;
  canvasBgArgb: number;
  saveSortOrder: SaveSortOrder;
  showSavePreviews: boolean;
  highlightStyle: RegionHighlightStyle;
  hintFillStyle: HintFillStyle;
  hintColorArgb: number;
  showRegionLabels: boolean;
  showPreviewLabels: boolean;
  showPreviewBorders: boolean;
  highlightMatching: boolean;
  animateHint: boolean;
  showNextRegionHint: boolean;
  hintIntensity: number;
  labelScale: number;
  showZoomButtons: boolean;
  showZoomOutButton: boolean;
  paletteSort: PaletteSortOrder;
  prioritizeOnScreen: boolean;
  hapticsEnabled: boolean;
  generatorConfig: GeneratorConfig;
}

export interface SavedSnapshot {
  id: string;
  title: string;
  timestamp: number;
  lastOpened: number;
  filledCount: number;
  totalCount: number;
  filledRegionIds: number[];
  paintedRegionColors?: Record<number, number>;
  customPalette?: PaletteColor[];
  isFreeColor?: boolean;
  isAutoSample?: boolean;
  sampleAssetPath?: string | null;
  zoomScale: number;
  panOffsetX: number;
  panOffsetY: number;
  previewDataUrl?: string;
  fileSizeBytes?: number;
}

export interface SampleArtwork {
  id: string;
  title: string;
  assetPath: string;
  category: string;
  isFreeColor?: boolean;
}

export interface PalettePreset {
  id: string;
  name: string;
  colors: string[];
}

export const COLORING_PALETTE_PRESETS: PalettePreset[] = [
  {
    id: 'vibrant',
    name: 'Vibrant Classic',
    colors: ['#EF4444', '#F97316', '#F59E0B', '#EAB308', '#84CC16', '#22C55E', '#10B981', '#06B6D4', '#3B82F6', '#6366F1', '#8B5CF6', '#EC4899', '#B45309', '#1E293B'],
  },
  {
    id: 'mushrooms',
    name: 'Mushroom Fantasy',
    colors: ['#DC2626', '#EA580C', '#D97706', '#65A30D', '#16A34A', '#0D9488', '#0284C7', '#4F46E5', '#9333EA', '#C026D3', '#DB2777', '#78350F', '#F59E0B', '#312E81'],
  },
  {
    id: 'pastels',
    name: 'Pastel Dreams',
    colors: ['#FCA5A5', '#FDBA74', '#FCD34D', '#BEF264', '#86EFAC', '#6EE7B7', '#67E8F9', '#93C5FD', '#A5B4FC', '#C4B5FD', '#F0ABFC', '#F9A8D4', '#FED7AA', '#E2E8F0'],
  },
  {
    id: 'earthy',
    name: 'Earthy Nature',
    colors: ['#854D0E', '#A16207', '#CA8A04', '#4D7C0F', '#15803D', '#047857', '#0F766E', '#1E3A8A', '#3730A3', '#581C87', '#701A75', '#881337', '#451A03', '#1C1917'],
  },
  {
    id: 'neon',
    name: 'Neon Pop',
    colors: ['#FF0055', '#FF5500', '#FFAA00', '#FFFF00', '#55FF00', '#00FF66', '#00FFFF', '#0066FF', '#6600FF', '#CC00FF', '#FF00CC', '#FF0077', '#FFFFFF', '#000000'],
  },
];

export const SAMPLE_GALLERY: SampleArtwork[] = [
  { id: 'capybara_sample', title: 'Capybara', assetPath: 'assets/capybara.webp', category: 'Animals' },
  { id: 'mushrooms', title: 'Mushroom Forest', assetPath: 'assets/mushrooms.webp', category: 'Coloring', isFreeColor: true },
  { id: 'capy_forest', title: 'Capy Forest', assetPath: 'assets/capy_forest.webp', category: 'Nature' },
  { id: 'snail_guitar', title: 'Snail Guitar', assetPath: 'assets/snail_guitar.webp', category: 'Music' },
];

export const CANVAS_BG_MAP: Record<CanvasBgColor, { label: string; hex: string; argb: number }> = {
  BLACK: { label: 'Deep Black', hex: '#000000', argb: 0xff000000 },
  DARK_SLATE: { label: 'Dark Slate', hex: '#0f172a', argb: 0xff0f172a },
  CHARCOAL: { label: 'Charcoal', hex: '#18181b', argb: 0xff18181b },
  LIGHT_GRAY: { label: 'Light Gray', hex: '#e2e8f0', argb: 0xffe2e8f0 },
  PURE_WHITE: { label: 'Pure White', hex: '#ffffff', argb: 0xffffffff },
};
