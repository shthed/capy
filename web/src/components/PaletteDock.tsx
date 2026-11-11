import React, { useEffect, useMemo, useRef } from 'react';
import { Palette } from 'lucide-react';
import {
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
  reducedMotion?: boolean;
  showCustomColorButton?: boolean;
  onColorSelected: (colorId: number) => void;
  onColorHintRequested: (colorId: number) => void;
  onOpenPaletteOptions?: () => void;
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
  visibleColorIds: Set<number> = new Set(),
  activeColorId?: number
): PaletteColor[] {
  if (!prioritizeOnScreen || visibleColorIds.size === 0) return basePalette;
  return [...basePalette].sort((a, b) => {
    if (activeColorId !== undefined) {
      if (a.id === activeColorId) return -1;
      if (b.id === activeColorId) return 1;
    }
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
  reducedMotion = false,
  showCustomColorButton = false,
  onColorSelected,
  onColorHintRequested,
  onOpenPaletteOptions,
  onAddCustomColor,
  onUpdateColor,
  onApplyPresetPalette,
}) => {
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

  // Available palette in dock - hide active colour when the puzzle is complete
  const uncompletedPalette = useMemo(() => {
    if (isFreeColorMode) {
      return palette;
    }
    const isPuzzleComplete = regions.length > 0 && filledRegionIds.size >= regions.length;
    if (isPuzzleComplete) {
      return [];
    }
    return palette.filter((c) => (remainingCountMap.get(c.id) || 0) > 0 || c.id === activeColorId);
  }, [palette, remainingCountMap, isFreeColorMode, activeColorId, regions.length, filledRegionIds.size]);

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

  // Order with on-screen prioritization - never hide or deprioritize active colour even if offscreen
  const dockPalette = useMemo(() => {
    if (!prioritizeOnScreen || visibleColorIds.size === 0) return sortedPalette;
    return [...sortedPalette].sort((a, b) => {
      if (a.id === activeColorId) return -1;
      if (b.id === activeColorId) return 1;
      const aVis = visibleColorIds.has(a.id) ? 1 : 0;
      const bVis = visibleColorIds.has(b.id) ? 1 : 0;
      return bVis - aVis;
    });
  }, [sortedPalette, prioritizeOnScreen, visibleColorIds, activeColorId]);

  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const footerRef = useRef<HTMLDivElement>(null);
  const activeSwatchRef = useRef<HTMLButtonElement | null>(null);

  // Smoothly center the active color in view when activeColorId changes
  useEffect(() => {
    if (activeSwatchRef.current) {
      activeSwatchRef.current.scrollIntoView({
        behavior: reducedMotion ? 'auto' : 'smooth',
        block: 'nearest',
        inline: 'center',
      });
    }
  }, [activeColorId, reducedMotion]);

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

  const handleSwatchClick = (c: PaletteColor) => {
    if (c.id === activeColorId) {
      onColorHintRequested(c.id);
    } else {
      onColorSelected(c.id);
    }
  };

  return (
    <div
      ref={footerRef}
      className="fixed z-20 left-0 right-0 pointer-events-none transition-all flex items-center"
      style={{
        bottom: `calc(${raiseDock ? '2rem' : '0.375rem'} + var(--sab, 0px))`,
      }}
      aria-label="Palette dock"
    >
      {/* Scrollable swatches floating all the way to screen edges with no outer border and ample vertical padding for active ring */}
      <div
        ref={scrollContainerRef}
        className="pointer-events-auto w-full flex items-center gap-2 overflow-x-auto no-scrollbar py-3"
        style={{
          paddingLeft: 'max(0.75rem, calc(var(--sal, 0px) + 0.75rem))',
          paddingRight: 'max(4.5rem, calc(var(--sar, 0px) + 4.5rem))',
          scrollbarWidth: 'none',
          msOverflowStyle: 'none',
        }}
      >
        {dockPalette.map((color) => {
          const isActive = color.id === activeColorId;
          const isVisibleOnScreen = visibleColorIds.has(color.id);
          const dispNum = displayNumberMap.get(color.id);
          const badgeVal = isFreeColorMode
            ? colorUsageMap.get(color.id) || 0
            : remainingCountMap.get(color.id) || 0;

          return (
            <button
              key={color.id}
              ref={isActive ? activeSwatchRef : undefined}
              type="button"
              data-testid={`palette-swatch-${dispNum}`}
              aria-pressed={isActive}
              onClick={() => handleSwatchClick(color)}
              title={`Color #${dispNum}${
                isFreeColorMode
                  ? ` (${badgeVal} painted)`
                  : ` (${badgeVal} remaining)`
              }${isVisibleOnScreen ? ' • On Screen' : ''}${isActive ? ' (Selected)' : ''}`}
              className={`flex-shrink-0 relative flex flex-col items-center justify-center w-[46px] h-[40px] rounded-xl transition-all active:scale-95 shadow-md ${
                isActive
                  ? 'ring-2 ring-amber-400 ring-offset-2 ring-offset-slate-950 scale-105 shadow-xl opacity-100 z-10'
                  : isVisibleOnScreen && prioritizeOnScreen
                  ? 'ring-1 ring-white/60 shadow-md opacity-95 hover:opacity-100 hover:scale-102'
                  : 'opacity-90 hover:opacity-100 hover:scale-102'
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

        {/* Button to open custom colour picker & palette options at the end of the dock */}
        {showCustomColorButton && onOpenPaletteOptions && (
          <button
            type="button"
            onClick={onOpenPaletteOptions}
            title="Custom Colour & Palette Options"
            className="flex-shrink-0 relative flex flex-col items-center justify-center w-[46px] h-[40px] rounded-xl bg-slate-900/90 text-amber-400 border border-slate-700/80 shadow-md hover:bg-slate-800 hover:scale-105 active:scale-95 transition-all"
          >
            <Palette size={18} />
            <span className="text-[8.5px] font-bold text-slate-300 leading-none mt-0.5">
              Custom
            </span>
          </button>
        )}
      </div>
    </div>
  );
};
