import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Palette, Pencil, Plus, X } from 'lucide-react';
import {
  COLORING_PALETTE_PRESETS,
  PaletteColor,
  PalettePreset,
  PaletteSortOrder,
  Region,
} from '../types';

interface PaletteDockProps {
  palette: PaletteColor[];
  regions: Region[];
  activeColorId: number;
  filledRegionIds: Set<number>;
  paintedRegionColors?: Map<number, number>;
  sortOrder: PaletteSortOrder;
  prioritizeOnScreen: boolean;
  visibleColorIds: Set<number>;
  raiseDock: boolean;
  isFreeColorMode?: boolean;
  onColorSelected: (colorId: number) => void;
  onColorHintRequested: (colorId: number) => void;
  onAddCustomColor?: (hex: string) => void;
  onUpdateColor?: (colorId: number, hex: string) => void;
  onApplyPresetPalette?: (preset: PalettePreset) => void;
}

export function getHue(hex: string): number {
  const cleanHex = hex.replace('#', '');
  const r = parseInt(cleanHex.substring(0, 2), 16) / 255;
  const g = parseInt(cleanHex.substring(2, 4), 16) / 255;
  const b = parseInt(cleanHex.substring(4, 6), 16) / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;

  if (delta === 0) return 0;
  let hue = 0;
  if (max === r) {
    hue = ((g - b) / delta) % 6;
  } else if (max === g) {
    hue = (b - r) / delta + 2;
  } else {
    hue = (r - g) / delta + 4;
  }
  hue *= 60;
  return hue < 0 ? hue + 360 : hue;
}

export function getDisplayNumberMap(
  palette: PaletteColor[],
  regions: Region[],
  sortOrder: PaletteSortOrder = 'NUMBER'
): Map<number, string> {
  let sorted = [...palette];
  switch (sortOrder) {
    case 'NUMBER':
      sorted.sort((a, b) => a.id - b.id);
      break;
    case 'REMAINING':
      sorted.sort((a, b) => {
        const countA = regions.filter((r) => r.colorId === a.id).length;
        const countB = regions.filter((r) => r.colorId === b.id).length;
        return countB - countA;
      });
      break;
    case 'HUE':
      sorted.sort((a, b) => getHue(a.hex) - getHue(b.hex));
      break;
    case 'LIGHTNESS':
      sorted.sort((a, b) => (a.isLight ? 1 : 0) - (b.isLight ? 1 : 0));
      break;
  }

  const map = new Map<number, string>();
  sorted.forEach((c, idx) => {
    map.set(c.id, (idx + 1).toString());
  });
  return map;
}

export function getVisiblePalette(
  palette: PaletteColor[],
  regions: Region[],
  filledRegionIds: Set<number>,
  sortOrder: PaletteSortOrder = 'NUMBER',
  isFreeColorMode: boolean = false
): PaletteColor[] {
  if (isFreeColorMode) {
    const list = [...palette];
    switch (sortOrder) {
      case 'NUMBER':
        list.sort((a, b) => a.id - b.id);
        break;
      case 'HUE':
        list.sort((a, b) => getHue(a.hex) - getHue(b.hex));
        break;
      case 'LIGHTNESS':
        list.sort((a, b) => (a.isLight ? 1 : 0) - (b.isLight ? 1 : 0));
        break;
    }
    return list;
  }

  const uncompleted = palette.filter((c) =>
    regions.some((r) => r.colorId === c.id && !filledRegionIds.has(r.id))
  );
  const list = [...uncompleted];
  switch (sortOrder) {
    case 'NUMBER':
      list.sort((a, b) => a.id - b.id);
      break;
    case 'REMAINING':
      list.sort((a, b) => {
        const countA = regions.filter((r) => r.colorId === a.id && !filledRegionIds.has(r.id)).length;
        const countB = regions.filter((r) => r.colorId === b.id && !filledRegionIds.has(r.id)).length;
        return countB - countA;
      });
      break;
    case 'HUE':
      list.sort((a, b) => getHue(a.hex) - getHue(b.hex));
      break;
    case 'LIGHTNESS':
      list.sort((a, b) => (a.isLight ? 1 : 0) - (b.isLight ? 1 : 0));
      break;
  }
  return list;
}

export function getDockPalette(
  basePalette: PaletteColor[],
  prioritizeOnScreen: boolean = false,
  visibleColorIds: Set<number> = new Set()
): PaletteColor[] {
  if (!prioritizeOnScreen || visibleColorIds.size === 0) return basePalette;
  return [...basePalette].sort((a, b) => {
    const aVis = visibleColorIds.has(a.id) ? 1 : 0;
    const bVis = visibleColorIds.has(b.id) ? 1 : 0;
    return bVis - aVis;
  });
}

export const PaletteDock: React.FC<PaletteDockProps> = ({
  palette,
  regions,
  activeColorId,
  filledRegionIds,
  paintedRegionColors,
  sortOrder,
  prioritizeOnScreen,
  visibleColorIds,
  raiseDock,
  isFreeColorMode = false,
  onColorSelected,
  onColorHintRequested,
  onAddCustomColor,
  onUpdateColor,
  onApplyPresetPalette,
}) => {
  const [showPresetsMenu, setShowPresetsMenu] = useState(false);
  const addColorInputRef = useRef<HTMLInputElement>(null);
  const editColorInputRef = useRef<HTMLInputElement>(null);

  // Remaining counts per color (for standard color-by-number mode)
  const remainingCountMap = useMemo(() => {
    const map = new Map<number, number>();
    for (const r of regions) {
      if (!filledRegionIds.has(r.id)) {
        map.set(r.colorId, (map.get(r.colorId) || 0) + 1);
      }
    }
    return map;
  }, [regions, filledRegionIds]);

  // Color usage counts per color (for Free Colour Mode)
  const colorUsageMap = useMemo(() => {
    const map = new Map<number, number>();
    for (const r of regions) {
      if (filledRegionIds.has(r.id)) {
        const colId = paintedRegionColors?.get(r.id) ?? r.colorId;
        map.set(colId, (map.get(colId) || 0) + 1);
      }
    }
    return map;
  }, [regions, filledRegionIds, paintedRegionColors]);

  // Available palette in dock
  const uncompletedPalette = useMemo(() => {
    if (isFreeColorMode) {
      return palette;
    }
    return palette.filter((c) => (remainingCountMap.get(c.id) || 0) > 0);
  }, [palette, remainingCountMap, isFreeColorMode]);

  // Sorted base palette
  const sortedPalette = useMemo(() => {
    const list = [...uncompletedPalette];
    switch (sortOrder) {
      case 'NUMBER':
        list.sort((a, b) => a.id - b.id);
        break;
      case 'REMAINING':
        if (isFreeColorMode) {
          list.sort(
            (a, b) =>
              (colorUsageMap.get(b.id) || 0) - (colorUsageMap.get(a.id) || 0)
          );
        } else {
          list.sort(
            (a, b) =>
              (remainingCountMap.get(b.id) || 0) - (remainingCountMap.get(a.id) || 0)
          );
        }
        break;
      case 'HUE':
        list.sort((a, b) => getHue(a.hex) - getHue(b.hex));
        break;
      case 'LIGHTNESS':
        list.sort((a, b) => (a.isLight ? 1 : 0) - (b.isLight ? 1 : 0));
        break;
    }
    return list;
  }, [uncompletedPalette, sortOrder, remainingCountMap, colorUsageMap, isFreeColorMode]);

  const displayNumberMap = useMemo(() => {
    return getDisplayNumberMap(palette, regions, sortOrder);
  }, [palette, regions, sortOrder]);

  // Order with on-screen prioritization
  const dockPalette = useMemo(() => {
    if (!prioritizeOnScreen || visibleColorIds.size === 0) return sortedPalette;
    return [...sortedPalette].sort((a, b) => {
      const aVis = visibleColorIds.has(a.id) ? 1 : 0;
      const bVis = visibleColorIds.has(b.id) ? 1 : 0;
      return bVis - aVis;
    });
  }, [sortedPalette, prioritizeOnScreen, visibleColorIds]);

  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const footerRef = useRef<HTMLElement>(null);

  // Enable horizontal mouse wheel scrolling across the color chooser
  useEffect(() => {
    const footer = footerRef.current;
    const container = scrollContainerRef.current;
    if (!footer || !container) return;

    const handleWheel = (e: WheelEvent) => {
      if (Math.abs(e.deltaY) > 0 || Math.abs(e.deltaX) > 0) {
        if (container.scrollWidth > container.clientWidth) {
          e.preventDefault();
          const scrollDelta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
          container.scrollLeft += scrollDelta;
        }
      }
    };

    footer.addEventListener('wheel', handleWheel, { passive: false });
    return () => footer.removeEventListener('wheel', handleWheel);
  }, []);

  // Defensively sync active color if current activeColorId is not in dock
  useEffect(() => {
    if (dockPalette.length > 0 && !dockPalette.some((c) => c.id === activeColorId)) {
      onColorSelected(dockPalette[0].id);
    }
  }, [dockPalette, activeColorId, onColorSelected]);

  if (dockPalette.length === 0) return null;

  // Active item
  const activeColor = dockPalette.find((c) => c.id === activeColorId) || dockPalette[0];
  const scrollableColors = dockPalette.filter((c) => c.id !== activeColor?.id);

  const handleSwatchClick = (c: PaletteColor) => {
    if (c.id === activeColorId) {
      onColorHintRequested(c.id);
    } else {
      onColorSelected(c.id);
    }
  };

  return (
    <footer
      ref={footerRef}
      className={`fixed bottom-0 left-0 right-0 z-20 flex flex-col items-center px-3 pt-2 bg-slate-950/90 backdrop-blur-md border-t border-slate-800/80 shadow-2xl transition-all ${
        raiseDock ? 'safe-bottom-raised' : 'safe-bottom'
      }`}
      style={{
        paddingLeft: 'max(0.75rem, calc(var(--sal, 0px) + 0.75rem))',
        paddingRight: 'max(0.75rem, calc(var(--sar, 0px) + 0.75rem))',
      }}
      aria-label="Palette dock"
    >
      {/* Hidden Color Picker Inputs */}
      <input
        ref={addColorInputRef}
        type="color"
        defaultValue="#ef4444"
        onChange={(e) => {
          onAddCustomColor?.(e.target.value);
        }}
        className="sr-only"
        aria-hidden="true"
        tabIndex={-1}
      />
      <input
        ref={editColorInputRef}
        type="color"
        defaultValue={activeColor?.hex || '#ef4444'}
        onChange={(e) => {
          if (activeColor) {
            onUpdateColor?.(activeColor.id, e.target.value);
          }
        }}
        className="sr-only"
        aria-hidden="true"
        tabIndex={-1}
      />

      {/* Preset Palettes Menu Popover */}
      {showPresetsMenu && onApplyPresetPalette && (
        <div
          onClick={(e) => e.stopPropagation()}
          className="w-full max-w-md mb-2 p-3 rounded-2xl bg-slate-900 border border-slate-700/80 shadow-2xl animate-in fade-in slide-in-from-bottom-2 duration-150 z-30 select-none"
        >
          <div className="flex items-center justify-between pb-2 mb-2 border-b border-slate-800">
            <div className="flex items-center gap-1.5 text-xs font-bold text-amber-400">
              <Palette size={14} />
              <span>Coloring Palettes & Themes</span>
            </div>
            <button
              type="button"
              onClick={() => setShowPresetsMenu(false)}
              className="p-1 rounded text-slate-400 hover:text-white"
              title="Close"
            >
              <X size={14} />
            </button>
          </div>
          <div className="grid grid-cols-1 gap-1.5 max-h-56 overflow-y-auto no-scrollbar">
            {COLORING_PALETTE_PRESETS.map((preset) => (
              <button
                key={preset.id}
                type="button"
                onClick={() => {
                  onApplyPresetPalette(preset);
                  setShowPresetsMenu(false);
                }}
                className="flex items-center justify-between p-2 rounded-xl bg-slate-950/60 hover:bg-slate-800 border border-slate-800/80 transition-all text-left group"
              >
                <span className="text-xs font-semibold text-slate-200 group-hover:text-amber-300">
                  {preset.name}
                </span>
                <div className="flex items-center gap-0.5 ml-2">
                  {preset.colors.slice(0, 10).map((hex, idx) => (
                    <span
                      key={idx}
                      className="w-3.5 h-3.5 rounded-full border border-black/30 shadow-xs"
                      style={{ backgroundColor: hex }}
                    />
                  ))}
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="flex items-center w-full max-w-7xl mx-auto gap-2.5 overflow-hidden">
        {/* Pinned Active Color Swatch with Edit button */}
        {activeColor && (
          <div className="flex-shrink-0 flex items-center pr-2 border-r border-slate-800/80">
            <div className="relative group">
              <button
                type="button"
                onClick={() => handleSwatchClick(activeColor)}
                title={`Color #${displayNumberMap.get(activeColor.id)}${
                  isFreeColorMode
                    ? ` (${colorUsageMap.get(activeColor.id) || 0} painted) - Tap to hint or choose`
                    : ` (${remainingCountMap.get(activeColor.id) || 0} remaining) - Click for hint`
                }`}
                className="relative flex flex-col items-center justify-center w-[48px] h-[40px] rounded-lg shadow-lg ring-2 ring-amber-400 ring-offset-2 ring-offset-slate-950 scale-105 transition-transform"
                style={{ backgroundColor: activeColor.hex }}
              >
                <span
                  className={`text-[13px] font-extrabold leading-tight ${
                    activeColor.isLight ? 'text-slate-950' : 'text-white'
                  }`}
                >
                  {displayNumberMap.get(activeColor.id)}
                </span>
                <span
                  className={`text-[10px] font-bold leading-tight ${
                    activeColor.isLight ? 'text-slate-900/90' : 'text-slate-100/90'
                  }`}
                >
                  {isFreeColorMode
                    ? colorUsageMap.get(activeColor.id) || 0
                    : remainingCountMap.get(activeColor.id) || 0}
                </span>
              </button>

              {/* Edit active color button */}
              {onUpdateColor && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    editColorInputRef.current?.click();
                  }}
                  title="Customize this color"
                  className="absolute -top-1.5 -right-1.5 w-4.5 h-4.5 rounded-full bg-slate-900 border border-amber-400 text-amber-300 flex items-center justify-center shadow-md hover:scale-110 transition-transform"
                >
                  <Pencil size={9} />
                </button>
              )}
            </div>
          </div>
        )}

        {/* Scrollable swatches */}
        <div
          ref={scrollContainerRef}
          className="flex items-center gap-2 overflow-x-auto no-scrollbar py-1 flex-1"
        >
          {scrollableColors.map((color) => {
            const isVisibleOnScreen = visibleColorIds.has(color.id);
            const dispNum = displayNumberMap.get(color.id);
            const badgeVal = isFreeColorMode
              ? colorUsageMap.get(color.id) || 0
              : remainingCountMap.get(color.id) || 0;

            return (
              <button
                key={color.id}
                type="button"
                onClick={() => handleSwatchClick(color)}
                title={`Color #${dispNum}${
                  isFreeColorMode
                    ? ` (${badgeVal} painted)`
                    : ` (${badgeVal} remaining)`
                }${isVisibleOnScreen ? ' • On Screen' : ''}`}
                className={`flex-shrink-0 relative flex flex-col items-center justify-center w-[42px] h-[36px] rounded-md transition-all active:scale-95 hover:brightness-110 ${
                  isVisibleOnScreen && prioritizeOnScreen
                    ? 'ring-1 ring-white/50 shadow-md'
                    : 'opacity-90'
                }`}
                style={{ backgroundColor: color.hex }}
              >
                <span
                  className={`text-[12px] font-extrabold leading-tight ${
                    color.isLight ? 'text-slate-950' : 'text-white'
                  }`}
                >
                  {dispNum}
                </span>
                <span
                  className={`text-[9.5px] font-bold leading-tight ${
                    color.isLight ? 'text-slate-900/90' : 'text-slate-100/90'
                  }`}
                >
                  {badgeVal}
                </span>
              </button>
            );
          })}
        </div>

        {/* Action buttons: Pick Color & Palette Presets */}
        <div className="flex-shrink-0 flex items-center gap-1.5 pl-2 border-l border-slate-800/80">
          {onAddCustomColor && (
            <button
              type="button"
              onClick={() => addColorInputRef.current?.click()}
              title="Add Custom Colour (Color Picker)"
              className="flex items-center justify-center w-[36px] h-[36px] rounded-lg border border-dashed border-amber-400/70 bg-amber-400/10 text-amber-300 hover:bg-amber-400/20 active:scale-95 transition-all shadow-sm"
            >
              <Plus size={16} />
            </button>
          )}

          {onApplyPresetPalette && (
            <button
              type="button"
              onClick={() => setShowPresetsMenu((prev) => !prev)}
              title="Palette Presets & Themes"
              className={`flex items-center justify-center w-[36px] h-[36px] rounded-lg border transition-all shadow-sm ${
                showPresetsMenu
                  ? 'border-amber-400 bg-amber-400/20 text-amber-300 ring-1 ring-amber-400'
                  : 'border-slate-800 bg-slate-900 text-slate-400 hover:text-slate-100 hover:bg-slate-800'
              }`}
            >
              <Palette size={16} />
            </button>
          )}
        </div>
      </div>
    </footer>
  );
};
