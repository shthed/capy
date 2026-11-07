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
}

export interface UserSettings {
  autoAdvance: boolean;
  difficulty: Difficulty;
  isPaintMode: boolean;
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
  paletteSort: PaletteSortOrder;
  prioritizeOnScreen: boolean;
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
}

export const SAMPLE_GALLERY: SampleArtwork[] = [
  { id: 'capybara_sample', title: 'Capybara', assetPath: 'assets/capybara.webp', category: 'Animals' },
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
