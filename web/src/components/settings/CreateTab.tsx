import React, { useMemo, useRef, useState } from 'react';
import {
  Image as ImageIcon,
  Info,
  Lightbulb,
  Play,
  Search,
  Sparkles,
  ZoomIn,
} from 'lucide-react';
import {
  GALLERY_FILTER_TAGS,
  PRESET_GALLERY_ITEMS,
  STANDARD_RESOLUTIONS,
} from '../../data/presetGallery';
import { getDailyFeaturedPuzzle } from '../../services/DailyPuzzleService';
import { ProviderRegistry } from '../../services/providers/ProviderRegistry';
import {
  DEFAULT_GENERATOR_CONFIG,
  GeneratorAlgorithm,
  GeneratorConfig,
  LineHandlingMode,
  MAX_GENERATOR_CONFIG,
  matchesGeneratorConfig,
  PaletteDetail,
  SAMPLE_GALLERY,
  SampleArtwork,
  UserSettings,
} from '../../types';
import { SettingSliderRow } from './SettingSliderRow';
import { SettingToggleRow } from './SettingToggleRow';

export interface CreateTabProps {
  settings: UserSettings;
  localConfig: GeneratorConfig;
  setLocalConfig: React.Dispatch<React.SetStateAction<GeneratorConfig>>;
  sourceImage?: HTMLImageElement | null;
  onUpdateSettings: (newSettings: UserSettings) => void;
  onRegenerate: (config: GeneratorConfig) => void;
  onSelectSample: (
    sample: SampleArtwork,
    config?: GeneratorConfig,
    prebakedSnapshotId?: string
  ) => void;
  onUploadImage: () => void;
  onZoomIntoDetailTile?: () => void;
  onExplorePresetGallery?: () => void;
  onClose: () => void;
}

const ALGORITHM_OPTIONS = [
  { key: 'AUTO', label: 'Auto Detect', desc: 'Analyzes lines & photos' },
  { key: 'LINE_ART', label: 'Line Art Tracer', desc: 'Traces black outlines accurately' },
  { key: 'PAINTERLY', label: 'Painterly (Photo)', desc: 'Smooth Kuwahara cel-shading' },
  { key: 'POSTERIZED', label: 'Posterized', desc: 'Crisp geometric color edges' },
  { key: 'MOSAIC_CEL', label: 'Mosaic Cells', desc: 'Even stained-glass superpixels' },
] as const;

const BORDER_OPTIONS = [
  {
    key: 'ABSORB_LINES',
    label: 'Boundaries Follow Artwork Lines',
    desc: 'Symmetrically absorbs lines so region borders run along stroke centers',
  },
  {
    key: 'UNIFIED_BLACK_REGION',
    label: 'Continuous Black Line Region',
    desc: 'Unifies black ink lines into a single playable line-art region with swatch',
  },
] as const;

const DETAIL_PRESETS = [
  { key: 'AUTO', label: 'Auto', colorCount: 16, maxRegions: 200, minRegionArea: 48 },
  { key: 'LOW', label: 'Low (~8-12)', colorCount: 10, maxRegions: 100, minRegionArea: 96 },
  { key: 'MEDIUM', label: 'Medium (~14-24)', colorCount: 18, maxRegions: 250, minRegionArea: 48 },
  { key: 'HIGH', label: 'High (~30-50)', colorCount: 38, maxRegions: 500, minRegionArea: 24 },
  { key: 'CUSTOM', label: 'Custom', colorCount: null, maxRegions: null, minRegionArea: null },
] as const;

const MAX_REGION_PRESETS = [
  { label: 'Simple (~100)', val: 100 },
  { label: 'Standard (~250)', val: 250 },
  { label: 'Detailed (~500)', val: 500 },
  { label: 'Expert (~1000)', val: 1000 },
  { label: 'Ultra (~2000)', val: 2000 },
] as const;

const MIN_AREA_PRESETS = [
  { label: 'Fine (24 px²)', val: 24 },
  { label: 'Balanced (48 px²)', val: 48 },
  { label: 'Chunky (96 px²)', val: 96 },
  { label: 'Relaxed (180 px²)', val: 180 },
] as const;

const PRESET_FILTER_CATEGORIES = [
  { key: 'ALL', label: 'All (10)' },
  { key: 'ALGORITHM', label: 'Algorithms (5)' },
  { key: 'BORDER', label: 'Black Borders (2)' },
  { key: 'DETAIL', label: 'Detail & Size (3)' },
] as const;

interface PresetGallerySectionProps {
  sectionRef: React.RefObject<HTMLDivElement | null>;
  showPresetGallery: boolean;
  setShowPresetGallery: React.Dispatch<React.SetStateAction<boolean>>;
  localConfig: GeneratorConfig;
  setLocalConfig: React.Dispatch<React.SetStateAction<GeneratorConfig>>;
  onExplorePresetGallery?: () => void;
}

const PresetGallerySection: React.FC<PresetGallerySectionProps> = ({
  sectionRef,
  showPresetGallery,
  setShowPresetGallery,
  localConfig,
  setLocalConfig,
  onExplorePresetGallery,
}) => {
  const [presetGalleryFilter, setPresetGalleryFilter] = useState<
    'ALL' | 'ALGORITHM' | 'BORDER' | 'DETAIL'
  >('ALL');

  const visibleItems = PRESET_GALLERY_ITEMS.filter(
    (item) => presetGalleryFilter === 'ALL' || item.category === presetGalleryFilter
  );

  return (
    <div
      ref={sectionRef}
      className="rounded-xl border border-amber-400/30 bg-slate-950/65 overflow-hidden"
    >
      <button
        type="button"
        data-testid="preset-gallery-toggle"
        aria-expanded={showPresetGallery}
        onClick={() => {
          const next = !showPresetGallery;
          setShowPresetGallery(next);
          if (next) {
            onExplorePresetGallery?.();
          }
        }}
        className="w-full flex items-center justify-between gap-2 p-2.5 sm:p-3 text-left hover:bg-slate-900/60 transition-colors cursor-pointer"
      >
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-xs font-extrabold text-amber-300">
              Preset Style Gallery &amp; Visual Guide
            </span>
            <span className="px-1.5 py-0.5 rounded-full bg-amber-400/15 border border-amber-400/40 text-[10px] font-bold text-amber-200">
              10 Presets
            </span>
          </div>
          <p className="text-[10px] sm:text-[11px] text-slate-400 mt-0.5">
            Compare real segmented previews of every algorithm, border mode, and detail preset
          </p>
        </div>
        <span className="px-2.5 py-1 rounded-lg bg-slate-800 border border-slate-700 text-[11px] font-bold text-slate-200 flex-shrink-0">
          {showPresetGallery ? 'Hide Guide' : 'Show Guide'}
        </span>
      </button>

      {showPresetGallery && (
        <div
          data-testid="preset-gallery-panel"
          className="border-t border-slate-800/80 p-2.5 sm:p-3 space-y-2.5"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap gap-1.5" role="group" aria-label="Preset gallery categories">
              {PRESET_FILTER_CATEGORIES.map((cat) => (
                <button
                  key={cat.key}
                  type="button"
                  data-testid={`preset-gallery-filter-${cat.key.toLowerCase()}`}
                  onClick={() => setPresetGalleryFilter(cat.key)}
                  className={`px-2 py-1 rounded-full text-[10px] font-bold border transition-colors cursor-pointer ${
                    presetGalleryFilter === cat.key
                      ? 'bg-amber-400 text-slate-950 border-amber-300'
                      : 'bg-slate-900 text-slate-300 border-slate-700 hover:border-slate-600'
                  }`}
                >
                  {cat.label}
                </button>
              ))}
            </div>
          </div>

          <div
            data-testid="preset-gallery-grid"
            className="grid grid-cols-1 sm:grid-cols-2 gap-2.5"
          >
            {visibleItems.map((item) => {
              const active = item.isMatch(localConfig);
              return (
                <div
                  key={item.id}
                  data-testid={`preset-card-${item.id}`}
                  className={`flex flex-col rounded-xl overflow-hidden border transition-all ${
                    active
                      ? 'border-amber-400 bg-slate-800/80 ring-1 ring-amber-400/70'
                      : 'border-slate-800 bg-slate-900/60 hover:border-slate-700'
                  }`}
                >
                  <div className="relative h-32 w-full bg-slate-950 overflow-hidden">
                    <img
                      src={item.image}
                      alt={`${item.title} preset preview`}
                      loading="lazy"
                      className="w-full h-full object-cover"
                    />
                    <span className="absolute top-1.5 left-1.5 px-1.5 py-0.5 rounded bg-slate-950/85 border border-slate-700/80 text-[9px] font-extrabold uppercase tracking-wider text-amber-300">
                      {item.badge}
                    </span>
                    <span className="absolute bottom-1.5 right-1.5 px-1.5 py-0.5 rounded bg-slate-950/85 text-[9px] font-mono font-bold text-slate-200">
                      {item.stats}
                    </span>
                  </div>
                  <div className="p-2.5 flex-1 flex flex-col justify-between gap-2">
                    <div className="space-y-1">
                      <div className="text-xs font-extrabold text-slate-100">{item.title}</div>
                      <p className="text-[10px] text-slate-300 leading-snug">{item.howItWorks}</p>
                      <p className="text-[10px] text-slate-400 leading-snug">
                        <span className="font-bold text-amber-300/90">Best for:</span>{' '}
                        {item.bestFor}
                      </p>
                    </div>
                    <button
                      type="button"
                      data-testid={`preset-apply-${item.id}`}
                      onClick={() => {
                        setLocalConfig((prev) => item.apply(prev));
                        onExplorePresetGallery?.();
                      }}
                      className={`w-full py-1.5 rounded-lg text-[11px] font-extrabold transition-colors cursor-pointer ${
                        active
                          ? 'bg-amber-400 text-slate-950'
                          : 'bg-slate-800 hover:bg-amber-400 hover:text-slate-950 text-amber-300 border border-slate-700'
                      }`}
                    >
                      {active ? 'Active Preset' : 'Apply Preset'}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};

const CommunityIdeasSection: React.FC = () => {
  const [communityIdeas, setCommunityIdeas] = useState(() =>
    ProviderRegistry.catalog.getCommunityIdeas()
  );
  const [showIdeaForm, setShowIdeaForm] = useState(false);
  const [ideaTitle, setIdeaTitle] = useState('');
  const [ideaPrompt, setIdeaPrompt] = useState('');
  const [ideaCategory, setIdeaCategory] = useState('Animals');
  const [ideaFeedback, setIdeaFeedback] = useState<string | null>(null);

  return (
    <div
      data-testid="community-ideas-section"
      className="p-3 rounded-xl bg-slate-950/65 border border-slate-800 space-y-2.5"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <Lightbulb size={15} className="text-amber-400" />
          <span className="text-xs font-extrabold text-slate-200">Puzzle Idea Notebook</span>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            data-testid="toggle-idea-form-btn"
            onClick={() => {
              setShowIdeaForm((v) => !v);
              setIdeaFeedback(null);
            }}
            className="px-2.5 py-1 rounded-lg bg-amber-400 text-slate-950 text-[11px] font-extrabold hover:bg-amber-300 transition-colors cursor-pointer"
          >
            {showIdeaForm ? 'Close' : '+ Add Idea'}
          </button>
        </div>
      </div>

      {ideaFeedback && (
        <div
          data-testid="idea-feedback-banner"
          className="px-2.5 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-[11px] text-amber-300 font-semibold"
        >
          {ideaFeedback}
        </div>
      )}

      {showIdeaForm && (
        <div className="p-2.5 rounded-lg bg-slate-900/90 border border-slate-800 space-y-2">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <input
              type="text"
              data-testid="idea-title-input"
              value={ideaTitle}
              onChange={(e) => setIdeaTitle(e.target.value)}
              placeholder="Idea title (e.g. Lantern Capybara)"
              maxLength={60}
              className="sm:col-span-2 px-2.5 py-1.5 rounded-lg bg-slate-950 border border-slate-700 text-xs text-slate-100 focus:outline-none focus:border-amber-400"
            />
            <select
              value={ideaCategory}
              onChange={(e) => setIdeaCategory(e.target.value)}
              className="px-2.5 py-1.5 rounded-lg bg-slate-950 border border-slate-700 text-xs text-slate-200 focus:outline-none"
            >
              <option value="Animals">Animals</option>
              <option value="Nature">Nature</option>
              <option value="Coloring">Coloring</option>
              <option value="Music">Music</option>
            </select>
          </div>
          <textarea
            data-testid="idea-prompt-input"
            value={ideaPrompt}
            onChange={(e) => setIdeaPrompt(e.target.value)}
            placeholder="Describe colors, mood, or style for a future puzzle idea..."
            rows={2}
            maxLength={280}
            className="w-full px-2.5 py-1.5 rounded-lg bg-slate-950 border border-slate-700 text-xs text-slate-100 focus:outline-none focus:border-amber-400 resize-none"
          />
          <div className="flex items-center justify-between gap-2">
            <span className="text-[10px] text-slate-400">
              Saved locally in your puzzle idea notebook on this device.
            </span>
            <button
              type="button"
              data-testid="submit-idea-btn"
              onClick={() => {
                const res = ProviderRegistry.catalog.submitCommunityIdea({
                  title: ideaTitle,
                  prompt: ideaPrompt,
                  category: ideaCategory,
                  author: ProviderRegistry.auth.getCurrentIdentity(),
                });
                if (!res.ok) {
                  setIdeaFeedback(res.error);
                  return;
                }
                setCommunityIdeas(ProviderRegistry.catalog.getCommunityIdeas());
                setIdeaTitle('');
                setIdeaPrompt('');
                setShowIdeaForm(false);
                setIdeaFeedback('Idea saved to your local puzzle notebook!');
              }}
              className="px-3 py-1.5 rounded-lg bg-amber-400 text-slate-950 text-xs font-extrabold hover:bg-amber-300 cursor-pointer"
            >
              Save Idea
            </button>
          </div>
        </div>
      )}

      <div className="space-y-1.5 max-h-40 overflow-y-auto pr-0.5">
        {communityIdeas.slice(0, 5).map((idea) => (
          <div
            key={idea.id}
            data-testid={`community-idea-${idea.id}`}
            className="flex items-center justify-between gap-2 p-2 rounded-lg bg-slate-900/70 border border-slate-800/90"
          >
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <span className="text-xs font-bold text-slate-200 truncate">{idea.title}</span>
                <span className="px-1.5 py-0.5 rounded bg-slate-800 text-[9px] font-bold text-slate-400">
                  {idea.category}
                </span>
              </div>
              <p className="text-[10px] text-slate-400 truncate">{idea.prompt}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

interface SampleGallerySectionProps {
  localConfig: GeneratorConfig;
  onSelectSample: CreateTabProps['onSelectSample'];
  onSaveConfig: (cfg: GeneratorConfig) => void;
  onClose: () => void;
}

const SampleGallerySection: React.FC<SampleGallerySectionProps> = ({
  localConfig,
  onSelectSample,
  onSaveConfig,
  onClose,
}) => {
  const [gallerySearch, setGallerySearch] = useState('');
  const [activeGalleryTag, setActiveGalleryTag] = useState('All');

  const q = gallerySearch.trim().toLowerCase();
  const filteredGallery = SAMPLE_GALLERY.filter((sample) => {
    const matchesTag =
      activeGalleryTag === 'All' ||
      sample.category.toLowerCase() === activeGalleryTag.toLowerCase() ||
      Boolean(sample.tags?.some((t) => t.toLowerCase() === activeGalleryTag.toLowerCase()));
    if (!matchesTag) return false;
    if (!q) return true;
    return (
      sample.title.toLowerCase().includes(q) ||
      sample.category.toLowerCase().includes(q) ||
      Boolean(sample.tags?.some((t) => t.toLowerCase().includes(q)))
    );
  });

  return (
    <div className="space-y-2">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
        <span className="text-[11px] sm:text-xs font-bold uppercase tracking-wider text-slate-400">
          Artwork Gallery
        </span>
        <div className="relative w-full sm:w-56">
          <Search
            size={13}
            className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none"
          />
          <input
            type="search"
            aria-label="Search artwork gallery"
            data-testid="gallery-search-input"
            value={gallerySearch}
            onChange={(e) => setGallerySearch(e.target.value)}
            placeholder="Search title or tag..."
            className="w-full pl-8 pr-2.5 py-1.5 rounded-lg bg-slate-950/80 border border-slate-800 text-xs text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-amber-400"
          />
        </div>
      </div>

      {/* Tag Filter Chips */}
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Gallery category filters">
        {GALLERY_FILTER_TAGS.map((tag) => {
          const isSelected = activeGalleryTag === tag;
          return (
            <button
              key={tag}
              type="button"
              data-testid={`gallery-tag-${tag.toLowerCase().replace(/\s+/g, '-')}`}
              onClick={() => setActiveGalleryTag(tag)}
              className={`px-2.5 py-1 rounded-full text-[11px] font-bold border transition-all cursor-pointer ${
                isSelected
                  ? 'bg-amber-400 text-slate-950 border-amber-300 shadow-xs'
                  : 'bg-slate-950/60 text-slate-300 border-slate-800 hover:border-slate-700'
              }`}
            >
              {tag}
            </button>
          );
        })}
      </div>

      {filteredGallery.length === 0 ? (
        <div
          data-testid="gallery-empty-state"
          className="p-4 rounded-xl border border-slate-800 bg-slate-950/50 text-center space-y-2"
        >
          <p className="text-xs text-slate-400">
            No artworks match &ldquo;{gallerySearch || activeGalleryTag}&rdquo;.
          </p>
          <button
            type="button"
            onClick={() => {
              setGallerySearch('');
              setActiveGalleryTag('All');
            }}
            className="px-3 py-1 rounded-lg bg-slate-800 text-amber-300 text-xs font-bold hover:bg-slate-700 cursor-pointer"
          >
            Reset Filters
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-3">
          {filteredGallery.map((sample) => (
            <div
              key={sample.id}
              data-testid={`gallery-card-${sample.id}`}
              className="group relative flex flex-col rounded-xl overflow-hidden border border-slate-800 bg-slate-950/60 hover:border-amber-400/60 transition-all shadow-md"
            >
              <div className="relative h-16 sm:h-24 w-full overflow-hidden bg-slate-900">
                <img
                  src={sample.assetPath}
                  alt={sample.title}
                  className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                />
                {sample.isFreeColor && (
                  <span className="absolute top-1 right-1 px-1.5 py-0.5 rounded text-[8px] font-black uppercase tracking-wider bg-amber-400 text-slate-950 shadow">
                    Free Color
                  </span>
                )}
              </div>
              <div className="p-1.5 sm:p-2 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1">
                <div className="min-w-0">
                  <div className="text-[11px] sm:text-xs font-bold text-slate-200 truncate">
                    {sample.title}
                  </div>
                  <div className="text-[9px] text-slate-400 hidden sm:block">{sample.category}</div>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    onSaveConfig(localConfig);
                    onSelectSample(sample, localConfig);
                    onClose();
                  }}
                  className="w-full sm:w-auto px-2 py-1 text-[11px] sm:text-xs font-bold bg-amber-400 text-slate-950 rounded-md sm:rounded-lg hover:bg-amber-300 transition-colors shadow text-center cursor-pointer"
                >
                  Play
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

interface FineTuningSectionProps {
  settings: UserSettings;
  localConfig: GeneratorConfig;
  setLocalConfig: React.Dispatch<React.SetStateAction<GeneratorConfig>>;
  sourceImage?: HTMLImageElement | null;
  onToggleDetailedProgress: () => void;
  renderHintButton: (id: string, title: string) => React.ReactNode;
  renderHintCallout: (id: string, text: string) => React.ReactNode;
}

const FineTuningSection: React.FC<FineTuningSectionProps> = ({
  settings,
  localConfig,
  setLocalConfig,
  sourceImage,
  onToggleDetailedProgress,
  renderHintButton,
  renderHintCallout,
}) => {
  const nativeW = sourceImage?.naturalWidth || sourceImage?.width || 0;
  const nativeH = sourceImage?.naturalHeight || sourceImage?.height || 0;
  const nativeMax = Math.max(nativeW, nativeH);

  const percentageSnaps =
    nativeMax > 0
      ? [
          { label: '25%', val: Math.max(256, Math.round(nativeMax * 0.25)) },
          { label: '33%', val: Math.max(320, Math.round(nativeMax * 0.33)) },
          { label: '50%', val: Math.max(480, Math.round(nativeMax * 0.5)) },
          { label: '75%', val: Math.max(640, Math.round(nativeMax * 0.75)) },
          { label: '100% (Native)', val: nativeMax },
        ]
      : [];

  const allSnapValues = Array.from(
    new Set([...STANDARD_RESOLUTIONS.map((s) => s.val), ...percentageSnaps.map((p) => p.val)])
  ).sort((a, b) => a - b);

  const snapResolution = (rawVal: number) => {
    let closest = rawVal;
    let minDiff = 40;
    for (const snap of allSnapValues) {
      const diff = Math.abs(rawVal - snap);
      if (diff < minDiff) {
        minDiff = diff;
        closest = snap;
      }
    }
    return closest;
  };

  const isMaxDetailActive =
    localConfig.paletteDetail === 'CUSTOM' &&
    localConfig.colorCount === MAX_GENERATOR_CONFIG.colorCount &&
    localConfig.maxRegions === MAX_GENERATOR_CONFIG.maxRegions &&
    localConfig.minRegionArea === MAX_GENERATOR_CONFIG.minRegionArea &&
    localConfig.resolution === MAX_GENERATOR_CONFIG.resolution;

  return (
    <div className="space-y-3.5 p-3 rounded-xl bg-slate-950/50 border border-slate-800">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-[11px] sm:text-xs font-bold uppercase tracking-wider text-slate-400">
          Manual Fine-Tuning &amp; Constraints
        </div>
        <button
          type="button"
          data-testid="create-max-detail-preset-btn"
          onClick={() =>
            setLocalConfig((prev) => ({
              ...MAX_GENERATOR_CONFIG,
              algorithm: prev.algorithm || MAX_GENERATOR_CONFIG.algorithm,
              lineHandling: prev.lineHandling || MAX_GENERATOR_CONFIG.lineHandling,
              imageType: prev.imageType || MAX_GENERATOR_CONFIG.imageType,
              ...(prev.isFreeColor !== undefined ? { isFreeColor: prev.isFreeColor } : {}),
            }))
          }
          className={`px-2 py-1 rounded-md border text-[10px] font-extrabold transition-all cursor-pointer ${
            isMaxDetailActive
              ? 'border-amber-400 bg-amber-400 text-slate-950 shadow-xs'
              : 'border-amber-400/40 bg-amber-400/10 text-amber-300 hover:bg-amber-400/20'
          }`}
        >
          Max Detail (64c • 2000 • 2048p)
        </button>
      </div>

      {/* Target Palette Colors */}
      <SettingSliderRow
        label="Target Palette Colors"
        ariaLabel="Target Palette Colors"
        valueLabel={
          localConfig.paletteDetail === 'CUSTOM'
            ? `${localConfig.colorCount} colors (Custom)`
            : `Auto-tuned (${localConfig.paletteDetail.toLowerCase()})`
        }
        min="4"
        max="64"
        step="1"
        value={localConfig.colorCount}
        onChange={(_raw, e) =>
          setLocalConfig((prev) => ({
            ...prev,
            paletteDetail: 'CUSTOM',
            colorCount: parseInt(e.target.value, 10),
          }))
        }
        headerAdornment={renderHintButton('color-count', 'Target Palette Colors')}
        callout={renderHintCallout(
          'color-count',
          'Sets the exact number of color swatches (4 to 64). Moving this slider automatically switches Detail Level Preset to Custom.'
        )}
        description={
          localConfig.paletteDetail !== 'CUSTOM' ? (
            <span className="text-[10px]">
              Preset picks the best color count for your artwork; drag slider to switch to Custom (
              {localConfig.colorCount}).
            </span>
          ) : undefined
        }
        containerClassName="space-y-1"
        labelClassName="text-slate-300 font-semibold"
      />

      {/* Max Regions (Puzzle Pieces) */}
      <SettingSliderRow
        label="Max Regions (Puzzle Pieces)"
        ariaLabel="Max Regions (Puzzle Pieces)"
        valueLabel={`${localConfig.maxRegions || 200} max pieces`}
        min="40"
        max="2000"
        step="20"
        value={localConfig.maxRegions || 200}
        onChange={(_raw, e) =>
          setLocalConfig((prev) => ({
            ...prev,
            maxRegions: parseInt(e.target.value, 10),
          }))
        }
        headerAdornment={renderHintButton('max-regions', 'Max Regions (Puzzle Pieces)')}
        callout={renderHintCallout(
          'max-regions',
          'Caps the maximum number of playable puzzle pieces (40 to 2000). Higher values preserve intricate details; lower values create faster, relaxing puzzles.'
        )}
        containerClassName="space-y-1.5"
        labelClassName="text-slate-300 font-semibold"
      >
        <div className="grid grid-cols-3 sm:grid-cols-5 gap-1">
          {MAX_REGION_PRESETS.map((rPreset) => (
            <button
              key={rPreset.val}
              type="button"
              onClick={() => setLocalConfig((prev) => ({ ...prev, maxRegions: rPreset.val }))}
              className={`px-1 py-1 rounded-md border text-[10px] font-bold text-center transition-all ${
                (localConfig.maxRegions || 200) === rPreset.val
                  ? 'border-amber-400 bg-slate-800 text-amber-300 ring-1 ring-amber-400'
                  : 'border-slate-800 bg-slate-900/60 text-slate-400 hover:bg-slate-800/50'
              }`}
            >
              {rPreset.label}
            </button>
          ))}
        </div>
      </SettingSliderRow>

      {/* Minimum Region Area */}
      <SettingSliderRow
        label="Minimum Region Area"
        ariaLabel="Minimum Region Area"
        valueLabel={`${localConfig.minRegionArea} px²`}
        min="15"
        max="300"
        step="5"
        value={localConfig.minRegionArea}
        onChange={(_raw, e) =>
          setLocalConfig((prev) => ({
            ...prev,
            minRegionArea: parseInt(e.target.value, 10),
          }))
        }
        headerAdornment={renderHintButton('min-region-area', 'Minimum Region Area')}
        callout={renderHintCallout(
          'min-region-area',
          'Merges tiny speckles smaller than this pixel area into neighboring regions. Lower values (15-24 px²) keep tiny details; higher values make larger, easier-to-tap pieces.'
        )}
        containerClassName="space-y-1.5"
        labelClassName="text-slate-300 font-semibold"
      >
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-1">
          {MIN_AREA_PRESETS.map((aPreset) => (
            <button
              key={aPreset.val}
              type="button"
              onClick={() => setLocalConfig((prev) => ({ ...prev, minRegionArea: aPreset.val }))}
              className={`px-1.5 py-1 rounded-md border text-[10px] font-bold text-center transition-all ${
                localConfig.minRegionArea === aPreset.val
                  ? 'border-amber-400 bg-slate-800 text-amber-300 ring-1 ring-amber-400'
                  : 'border-slate-800 bg-slate-900/60 text-slate-400 hover:bg-slate-800/50'
              }`}
            >
              {aPreset.label}
            </button>
          ))}
        </div>
      </SettingSliderRow>

      {/* Max Canvas Resolution */}
      <SettingSliderRow
        label="Max Canvas Resolution"
        ariaLabel="Max Canvas Resolution"
        valueLabel={`${localConfig.resolution} px`}
        min="480"
        max="2048"
        step="16"
        value={localConfig.resolution}
        onChange={(_raw, e) => {
          const snapped = snapResolution(parseInt(e.target.value, 10));
          setLocalConfig((prev) => ({ ...prev, resolution: snapped }));
        }}
        headerAdornment={renderHintButton('max-resolution', 'Max Canvas Resolution')}
        callout={
          <>
            {renderHintCallout(
              'max-resolution',
              'Sets the longest edge (480p to 2048p) used when segmenting the artwork. Higher resolutions produce sharper curves and crisp numbers at deep zoom.'
            )}
            {nativeMax > 0 && (
              <div className="text-[11px] text-slate-400 flex items-center justify-between px-2.5 py-1 rounded-lg bg-slate-900/60 border border-slate-800/80">
                <span>Source Artwork Resolution:</span>
                <span className="font-mono text-amber-300 font-bold">
                  {nativeW} × {nativeH} px
                </span>
              </div>
            )}
          </>
        }
        containerClassName="space-y-2"
        labelClassName="text-slate-300 font-semibold"
      >
        {percentageSnaps.length > 0 && (
          <div className="space-y-1">
            <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
              Snap to Artwork Scale
            </div>
            <div className="grid grid-cols-5 gap-1">
              {percentageSnaps.map((snap) => (
                <button
                  key={snap.label}
                  type="button"
                  onClick={() => setLocalConfig((prev) => ({ ...prev, resolution: snap.val }))}
                  className={`px-1 py-1 rounded-md border text-[10px] font-bold text-center transition-all ${
                    localConfig.resolution === snap.val
                      ? 'border-amber-400 bg-slate-800 text-amber-300 ring-1 ring-amber-400'
                      : 'border-slate-800 bg-slate-900/60 text-slate-400 hover:bg-slate-800/50'
                  }`}
                >
                  {snap.label}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="space-y-1">
          <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
            Snap to Standard Resolutions
          </div>
          <div className="grid grid-cols-3 sm:grid-cols-6 gap-1">
            {STANDARD_RESOLUTIONS.map((res) => (
              <button
                key={res.val}
                type="button"
                onClick={() => setLocalConfig((prev) => ({ ...prev, resolution: res.val }))}
                className={`px-1 py-1 rounded-md border text-[10px] font-bold text-center transition-all ${
                  localConfig.resolution === res.val
                    ? 'border-amber-400 bg-slate-800 text-amber-300 ring-1 ring-amber-400'
                    : 'border-slate-800 bg-slate-900/60 text-slate-400 hover:bg-slate-800/50'
                }`}
              >
                {res.label}
              </button>
            ))}
          </div>
        </div>
      </SettingSliderRow>

      {/* Detailed Generation Progress */}
      <div className="pt-2 border-t border-slate-800/70">
        <SettingToggleRow
          label="Detailed Generation Progress"
          description="Show step-by-step progress while creating a puzzle (slightly slower)"
          checked={Boolean(settings.detailedLoadingProgress)}
          onToggle={onToggleDetailedProgress}
          testId="setting-detailed-progress"
        />
      </div>
    </div>
  );
};

export const CreateTab: React.FC<CreateTabProps> = ({
  settings,
  localConfig,
  setLocalConfig,
  sourceImage,
  onUpdateSettings,
  onRegenerate,
  onSelectSample,
  onUploadImage,
  onZoomIntoDetailTile,
  onExplorePresetGallery,
  onClose,
}) => {
  const dailyPuzzle = useMemo(() => getDailyFeaturedPuzzle(), []);
  const [showPresetGallery, setShowPresetGallery] = useState(false);
  const [openHintId, setOpenHintId] = useState<string | null>(null);
  const presetGallerySectionRef = useRef<HTMLDivElement | null>(null);
  const createOptionsSectionRef = useRef<HTMLDivElement | null>(null);

  const updateSetting = <K extends keyof UserSettings>(key: K, value: UserSettings[K]) => {
    onUpdateSettings({ ...settings, [key]: value });
  };

  const renderHintButton = (id: string, title: string) => {
    const isExpanded = openHintId === id;
    return (
      <button
        type="button"
        data-testid={`hint-toggle-${id}`}
        aria-expanded={isExpanded}
        aria-label={`Toggle hint for ${title}`}
        onClick={(e) => {
          e.stopPropagation();
          setOpenHintId((prev) => (prev === id ? null : id));
        }}
        className={`capy-hint-icon-btn inline-flex items-center justify-center w-5 h-5 rounded-full border text-[10px] font-bold transition-colors cursor-pointer flex-shrink-0 ${
          isExpanded
            ? 'bg-amber-400 text-slate-950 border-amber-300'
            : 'bg-slate-900 text-slate-300 border-slate-700 hover:border-amber-400/60 hover:text-amber-300'
        }`}
      >
        <Info size={11} />
      </button>
    );
  };

  const renderHintCallout = (id: string, text: string) => {
    if (openHintId !== id) return null;
    return (
      <div
        data-testid={`hint-tooltip-${id}`}
        role="note"
        className="px-2.5 py-1.5 rounded-lg bg-slate-900/95 border border-amber-400/40 text-[11px] text-slate-200 leading-snug"
      >
        {text}
      </div>
    );
  };

  const isDefaultCfg = matchesGeneratorConfig(localConfig, DEFAULT_GENERATOR_CONFIG);
  const isMaxCfg = matchesGeneratorConfig(localConfig, MAX_GENERATOR_CONFIG);
  const showBorderHandling =
    (localConfig.algorithm || 'AUTO') === 'AUTO' || localConfig.algorithm === 'LINE_ART';

  return (
    <div className="space-y-4 sm:space-y-5">
      {/* Deterministic Offline UTC Puzzle of the Day Hero Card */}
      <div
        data-testid="daily-puzzle-card"
        className="relative overflow-hidden rounded-xl border border-amber-400/40 bg-gradient-to-br from-slate-900 via-slate-950 to-amber-950/25 p-3 sm:p-3.5 shadow-lg space-y-2"
      >
        <div className="flex flex-col sm:flex-row sm:items-center gap-3">
          <div className="relative h-24 sm:h-20 sm:w-28 w-full flex-shrink-0 overflow-hidden rounded-lg border border-slate-800 bg-slate-900">
            <img
              src={dailyPuzzle.sample.assetPath}
              alt={dailyPuzzle.sample.title}
              className="h-full w-full object-cover"
            />
          </div>
          <div className="min-w-0 flex-1 space-y-1">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="inline-flex items-center gap-1 rounded-full bg-amber-400/15 border border-amber-400/40 px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wider text-amber-300">
                <Sparkles size={11} />
                <span>Puzzle of the Day</span>
              </span>
              <span
                data-testid="daily-puzzle-date-badge"
                className="rounded-full bg-slate-900/90 border border-slate-700/80 px-2 py-0.5 text-[10px] font-mono font-bold text-slate-300"
              >
                {dailyPuzzle.utcDate} UTC
              </span>
              {renderHintButton('daily-puzzle', 'Puzzle of the Day')}
            </div>
            <div className="text-sm sm:text-base font-extrabold text-slate-100 truncate">
              {dailyPuzzle.sample.title}
            </div>
            <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-slate-300">
              <span
                data-testid="daily-puzzle-preset-label"
                className="font-bold text-amber-300"
              >
                {dailyPuzzle.presetLabel}
              </span>
              <span className="text-slate-500">•</span>
              <span className="text-slate-400">{dailyPuzzle.presetDescription}</span>
            </div>
          </div>
          <button
            type="button"
            data-testid="daily-puzzle-play-btn"
            onClick={() => {
              onSelectSample(dailyPuzzle.sample, dailyPuzzle.config, dailyPuzzle.snapshotId);
              onClose();
            }}
            className="w-full sm:w-auto flex-shrink-0 inline-flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-lg bg-amber-400 hover:bg-amber-300 text-slate-950 text-xs sm:text-sm font-extrabold shadow-md transition-colors cursor-pointer"
          >
            <Play size={14} className="fill-current" />
            <span>Play Daily</span>
          </button>
        </div>
        {renderHintCallout(
          'daily-puzzle',
          'Deterministic daily challenge paired cleanly across every device by UTC date. All 20 daily combinations are pre-baked at Max Detail (2048p • up to 2000 pieces • 64 colors, or 20 colors in Free Color mode) for instant zero-wait play.'
        )}
      </div>

      {/* Above-the-Fold Style Guide & Hint Quick-Jump Bar */}
      <div
        data-testid="create-style-hint-bar"
        className="flex flex-wrap items-center justify-between gap-2 px-2.5 py-2 rounded-xl border border-slate-800 bg-slate-950/75"
      >
        <div className="flex items-start gap-1.5 flex-1 min-w-0 text-[11px] text-slate-300 leading-snug">
          <Info size={13} className="text-amber-400 flex-shrink-0 mt-0.5" />
          <span className="min-w-0 break-words">
            <span className="font-bold text-slate-100">Active Mode:</span>{' '}
            {isDefaultCfg
              ? 'Built-in Gallery: Max Detail • Photo Uploads: Auto (16 colors)'
              : isMaxCfg
                ? `Max Detail (${localConfig.colorCount} colors • ${localConfig.maxRegions || 2000} pieces)`
                : `Custom (${localConfig.colorCount} colors • ${localConfig.maxRegions || 200} pieces • ${localConfig.resolution}p)`}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-1.5 flex-shrink-0">
          <button
            type="button"
            data-testid="create-hint-style-guide-btn"
            onClick={() => {
              setShowPresetGallery(true);
              onExplorePresetGallery?.();
              requestAnimationFrame(() => {
                presetGallerySectionRef.current?.scrollIntoView({
                  behavior: 'smooth',
                  block: 'start',
                });
              });
            }}
            className="px-2 py-1 rounded-lg bg-amber-400/15 hover:bg-amber-400/25 border border-amber-400/40 text-amber-300 text-[11px] font-bold transition-colors cursor-pointer"
          >
            Style Guide (10)
          </button>
          <button
            type="button"
            data-testid="create-hint-options-btn"
            onClick={() => {
              setOpenHintId('algorithm');
              requestAnimationFrame(() => {
                createOptionsSectionRef.current?.scrollIntoView({
                  behavior: 'smooth',
                  block: 'start',
                });
              });
            }}
            className="px-2 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 text-[11px] font-bold transition-colors cursor-pointer"
          >
            Hint &amp; Options
          </button>
        </div>
      </div>

      {/* Built-in Sample Artwork Gallery */}
      <SampleGallerySection
        localConfig={localConfig}
        onSelectSample={onSelectSample}
        onSaveConfig={(cfg) => updateSetting('generatorConfig', cfg)}
        onClose={onClose}
      />

      {/* Action Row: Upload Photo & Infinite Zoom Detail Sub-Puzzle */}
      <div className="space-y-2">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <div className="flex items-center gap-1.5 min-w-0">
            <button
              type="button"
              data-testid="create-upload-photo-btn"
              onClick={() => {
                onUploadImage();
                onClose();
              }}
              className="flex-1 min-w-0 flex items-center justify-center gap-2 p-2.5 sm:p-3 rounded-xl border border-amber-400/40 bg-amber-400/10 text-amber-300 hover:bg-amber-400/20 text-xs sm:text-sm font-bold transition-colors cursor-pointer"
            >
              <ImageIcon size={16} className="flex-shrink-0" />
              <span className="truncate">Choose Photo from Device</span>
            </button>
            {renderHintButton('upload-photo', 'Choose Photo from Device')}
          </div>

          {onZoomIntoDetailTile && sourceImage && (
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                data-testid="infinite-zoom-subtile-btn"
                onClick={() => {
                  onZoomIntoDetailTile();
                  onClose();
                }}
                title="Generate a higher-detail 2x zoomed sub-puzzle from the center of your current view"
                className="flex-1 min-w-0 flex items-center justify-center gap-2 p-2.5 sm:p-3 rounded-xl border border-sky-400/40 bg-sky-500/10 text-sky-300 hover:bg-sky-500/20 text-xs sm:text-sm font-bold transition-colors cursor-pointer"
              >
                <ZoomIn size={16} className="flex-shrink-0" />
                <span className="truncate">Infinite Zoom 2x Detail Tile</span>
              </button>
              {renderHintButton('infinite-zoom', 'Infinite Zoom 2x Detail Tile')}
            </div>
          )}
        </div>
        {renderHintCallout(
          'upload-photo',
          'Pick any JPG, PNG, or WebP artwork or photo from your device and segment it locally using your chosen algorithm, colors, piece count, and resolution below.'
        )}
        {onZoomIntoDetailTile &&
          sourceImage &&
          renderHintCallout(
            'infinite-zoom',
            'Crops a 2x zoomed region around the center of your current canvas view and generates a fresh, higher-detail sub-puzzle from it.'
          )}
      </div>

      {/* Preset Style Gallery & Visual Guide */}
      <PresetGallerySection
        sectionRef={presetGallerySectionRef}
        showPresetGallery={showPresetGallery}
        setShowPresetGallery={setShowPresetGallery}
        localConfig={localConfig}
        setLocalConfig={setLocalConfig}
        onExplorePresetGallery={onExplorePresetGallery}
      />

      {/* Generation Algorithm Strategy */}
      <div ref={createOptionsSectionRef} className="space-y-1.5">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[11px] sm:text-xs font-bold uppercase tracking-wider text-slate-400">
            Segmentation Algorithm
          </span>
          {renderHintButton('algorithm', 'Segmentation Algorithm')}
        </div>
        {renderHintCallout(
          'algorithm',
          'Controls how the puzzle engine divides the image into paintable regions: Auto Detect adapts to photos or line art, Line Art Tracer follows dark ink strokes, Painterly smooths photos, Posterized snaps crisp color edges, and Mosaic Cells creates even stained-glass tiles.'
        )}
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5 sm:gap-2">
          {ALGORITHM_OPTIONS.map((alg) => (
            <button
              key={alg.key}
              type="button"
              onClick={() =>
                setLocalConfig((prev) => ({
                  ...prev,
                  algorithm: alg.key as GeneratorAlgorithm,
                  imageType:
                    alg.key === 'PAINTERLY' ? 'PHOTO' : alg.key === 'LINE_ART' ? 'DRAWING' : 'AUTO',
                }))
              }
              className={`p-2 sm:p-2.5 rounded-lg border text-left transition-all ${
                (localConfig.algorithm || 'AUTO') === alg.key
                  ? 'border-amber-400 bg-slate-800 text-white ring-1 ring-amber-400'
                  : 'border-slate-800 bg-slate-950/40 text-slate-400 hover:bg-slate-800/50'
              }`}
            >
              <div className="text-xs font-bold text-slate-100">{alg.label}</div>
              <div className="text-[10px] text-slate-400 mt-0.5 leading-snug">{alg.desc}</div>
            </button>
          ))}
        </div>
      </div>

      {/* Black Border & Outline Handling */}
      {showBorderHandling && (
        <div className="space-y-1.5 p-2.5 sm:p-3 rounded-xl bg-slate-950/60 border border-slate-800">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] sm:text-xs font-bold uppercase tracking-wider text-amber-400">
              Artwork Black Border Handling
            </span>
            {renderHintButton('border-handling', 'Artwork Black Border Handling')}
          </div>
          {renderHintCallout(
            'border-handling',
            'Boundaries Follow Artwork Lines keeps dark outlines as crisp dividers between regions; Continuous Black Line Region turns all black ink strokes into one paintable region.'
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
            {BORDER_OPTIONS.map((mode) => (
              <button
                key={mode.key}
                type="button"
                onClick={() =>
                  setLocalConfig((prev) => ({
                    ...prev,
                    lineHandling: mode.key as LineHandlingMode,
                  }))
                }
                className={`p-2 sm:p-2.5 rounded-lg border text-left transition-all ${
                  (localConfig.lineHandling || 'ABSORB_LINES') === mode.key
                    ? 'border-amber-400 bg-slate-800 text-white ring-1 ring-amber-400'
                    : 'border-slate-800 bg-slate-950/40 text-slate-400 hover:bg-slate-800/50'
                }`}
              >
                <div className="text-xs font-bold text-slate-100">{mode.label}</div>
                <div className="text-[10px] text-slate-400 mt-0.5 leading-snug">{mode.desc}</div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Palette Detail Level */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[11px] sm:text-xs font-bold uppercase tracking-wider text-slate-400">
            Detail Level Preset
          </span>
          {renderHintButton('detail-preset', 'Detail Level Preset')}
        </div>
        {renderHintCallout(
          'detail-preset',
          'Picks how many palette colors, max puzzle pieces, and minimum speckle sizes are extracted. Auto, Low, Medium, and High sync all three knobs; Custom keeps your manual slider adjustments.'
        )}
        <div className="grid grid-cols-3 sm:grid-cols-5 gap-1.5">
          {DETAIL_PRESETS.map((det) => (
            <button
              key={det.key}
              type="button"
              data-testid={`detail-preset-${det.key.toLowerCase()}`}
              onClick={() =>
                setLocalConfig((prev) => ({
                  ...prev,
                  paletteDetail: det.key as PaletteDetail,
                  ...(det.colorCount !== null ? { colorCount: det.colorCount } : {}),
                  ...(det.maxRegions !== null ? { maxRegions: det.maxRegions } : {}),
                  ...(det.minRegionArea !== null ? { minRegionArea: det.minRegionArea } : {}),
                }))
              }
              className={`py-1.5 px-1 rounded-lg border text-xs font-bold text-center transition-all ${
                localConfig.paletteDetail === det.key
                  ? 'border-amber-400 bg-slate-800 text-amber-300 ring-1 ring-amber-400'
                  : 'border-slate-800 bg-slate-950/40 text-slate-400 hover:bg-slate-800/50'
              }`}
            >
              {det.label}
            </button>
          ))}
        </div>
      </div>

      {/* Manual Fine-Tuning Sliders */}
      <FineTuningSection
        settings={settings}
        localConfig={localConfig}
        setLocalConfig={setLocalConfig}
        sourceImage={sourceImage}
        onToggleDetailedProgress={() =>
          updateSetting('detailedLoadingProgress', !settings.detailedLoadingProgress)
        }
        renderHintButton={renderHintButton}
        renderHintCallout={renderHintCallout}
      />

      {/* Apply & Regenerate */}
      <button
        type="button"
        onClick={() => {
          updateSetting('generatorConfig', localConfig);
          onRegenerate(localConfig);
          onClose();
        }}
        className="w-full py-2.5 sm:py-3 rounded-xl bg-amber-400 text-slate-950 font-extrabold text-xs sm:text-sm hover:bg-amber-300 transition-colors shadow-lg active:scale-98"
      >
        Regenerate Artwork with Settings
      </button>

      {/* Puzzle Idea Notebook */}
      <CommunityIdeasSection />
    </div>
  );
};
