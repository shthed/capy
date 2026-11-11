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
export type PresetCanvasBgColor = 'BLACK' | 'DARK_SLATE' | 'CHARCOAL' | 'LIGHT_GRAY' | 'PURE_WHITE';
export type CanvasBgColor = PresetCanvasBgColor | 'CUSTOM';
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
  minLabelSize: number;
  maxLabelSize: number;
  showZoomButtons: boolean;
  showResetViewButton: boolean;
  paletteSort: PaletteSortOrder;
  prioritizeOnScreen: boolean;
  hapticsEnabled: boolean;
  panMomentum: boolean;
  enableCustomColorForAllPuzzles: boolean;
  enableUndo: boolean;
  replaySpeed: number;
  autoReplayOnLoad: boolean;
  replayLoop: boolean;
  replayFollow: boolean;
  reverseDoubleTapZoom: boolean;
  zoomSensitivity: number;
  snapZoomLevels: boolean;
  soundEnabled: boolean;
  soundVolume: number;
  reducedMotion: boolean;
  detailedLoadingProgress: boolean;
  generatorConfig: GeneratorConfig;
}

export interface GenerationStepInfo {
  id: number;
  name: string;
  description: string;
  status: 'pending' | 'in_progress' | 'completed';
}

export interface GenerationInspectionDetails {
  sourceWidth?: number;
  sourceHeight?: number;
  targetWidth?: number;
  targetHeight?: number;
  detectedType?: string;
  isLineArt?: boolean;
  isBlackAndWhite?: boolean;
  edgeRatio?: number;
  localVariance?: number;
  globalVariance?: number;
  colorClusterCount?: number;
  chosenStrategy?: string;
  strategyRationale?: string;
  paletteDetail?: string;
  colorCount?: number;
  minRegionArea?: number;
  maxRegions?: number;
  finalRegionCount?: number;
  minActualArea?: number;
  maxActualArea?: number;
  resolution?: number;
  estimatedSaveSizeKb?: number;
  paletteColors?: Array<{ r: number; g: number; b: number }>;
}

export interface GenerationProgressPayload {
  progress: number;
  status: string;
  stepIndex: number;
  totalSteps: number;
  stepName: string;
  stepDescription: string;
  steps: GenerationStepInfo[];
  inspection: GenerationInspectionDetails;
}

export const GENERATION_PIPELINE_STEPS: Array<{ id: number; name: string; description: string }> = [
  {
    id: 1,
    name: 'Artwork Analysis & Style Detection',
    description: 'Scans luminance distribution, Sobel edge density, and 32k-bucket color histograms to detect whether the image is a photo, illustration, or black-and-white line drawing.',
  },
  {
    id: 2,
    name: 'Strategy Selection & Auto-Calibration',
    description: 'Selects the optimal puzzle engine strategy (Line Art, Painterly, Posterized, or Mosaic Cel) and automatically tunes target resolution, color count, and region size limits.',
  },
  {
    id: 3,
    name: 'Pre-Filtering & Edge Preparation',
    description: 'Applies edge-preserving bilateral filtering, morphological ink stroke extraction, or median denoising to prepare clean region boundaries.',
  },
  {
    id: 4,
    name: 'Perceptual Color Palette Clustering',
    description: 'Runs K-Means++ clustering in perceptual Redmean color space to extract dominant, visually distinct palette swatches.',
  },
  {
    id: 5,
    name: 'Connected Region Segmentation & Merging',
    description: 'Traces 4-connected pixel islands, merges micro-speckles below minimum area thresholds, and balances total region counts.',
  },
  {
    id: 6,
    name: 'Boundary Alignment & Label Placement',
    description: 'Expands regions to artwork line centers and computes pole-of-inaccessibility distance transforms to place number labels with maximum clearance.',
  },
];

export type PuzzleSourceKind = 'sample' | 'catalog' | 'url' | 'blob';

export interface PuzzleSourceRef {
  kind: PuzzleSourceKind;
  /** Asset path for 'sample', catalog item ID for 'catalog', remote URL for 'url', or snapshot ID for 'blob' */
  uri: string;
  contentHash?: string;
}

export interface SavedSnapshot {
  id: string;
  title: string;
  timestamp: number;
  lastOpened: number;
  isPinned?: boolean;
  filledCount: number;
  totalCount: number;
  /** Region IDs in exact chronological order of completion */
  filledRegionIds: number[];
  paintedRegionColors?: Record<number, number>;
  customPalette?: PaletteColor[];
  isFreeColor?: boolean;
  isAutoSample?: boolean;
  sampleAssetPath?: string | null;
  sourceRef?: PuzzleSourceRef;
  parentSnapshotId?: string;
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
  tags?: string[];
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
  { id: 'capybara_sample', title: 'Capybara', assetPath: 'assets/capybara.webp', category: 'Animals', tags: ['Animals', 'Cute', 'Illustration'] },
  { id: 'mushrooms', title: 'Mushroom Forest', assetPath: 'assets/mushrooms.webp', category: 'Coloring', tags: ['Coloring', 'Line Art', 'Nature', 'Fantasy'], isFreeColor: true },
  { id: 'capy_forest', title: 'Capy Forest', assetPath: 'assets/capy_forest.webp', category: 'Nature', tags: ['Animals', 'Nature', 'Detailed'] },
  { id: 'snail_guitar', title: 'Snail Guitar', assetPath: 'assets/snail_guitar.webp', category: 'Music', tags: ['Music', 'Animals', 'Whimsical'] },
];

export const CANVAS_BG_MAP: Record<PresetCanvasBgColor, { label: string; hex: string; argb: number }> = {
  BLACK: { label: 'Deep Black', hex: '#000000', argb: 0xff000000 },
  DARK_SLATE: { label: 'Dark Slate', hex: '#0f172a', argb: 0xff0f172a },
  CHARCOAL: { label: 'Charcoal', hex: '#18181b', argb: 0xff18181b },
  LIGHT_GRAY: { label: 'Light Gray', hex: '#e2e8f0', argb: 0xffe2e8f0 },
  PURE_WHITE: { label: 'Pure White', hex: '#ffffff', argb: 0xffffffff },
};

export function argbToHex(argb: number): string {
  return `#${(argb & 0x00ffffff).toString(16).padStart(6, '0')}`;
}

export function hexToArgb(hex: string): number {
  const clean = hex.replace('#', '');
  return (0xff000000 | parseInt(clean, 16)) >>> 0;
}
