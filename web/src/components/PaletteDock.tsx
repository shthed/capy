import React, { useEffect, useMemo, useRef } from 'react';
import { PaletteColor, PaletteSortOrder, Region } from '../types';

interface PaletteDockProps {
  palette: PaletteColor[];
  regions: Region[];
  activeColorId: number;
  filledRegionIds: Set<number>;
  sortOrder: PaletteSortOrder;
  prioritizeOnScreen: boolean;
  visibleColorIds: Set<number>;
  raiseDock: boolean;
  onColorSelected: (colorId: number) => void;
  onColorHintRequested: (colorId: number) => void;
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
  sortOrder: PaletteSortOrder = 'NUMBER'
): PaletteColor[] {
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
  sortOrder,
  prioritizeOnScreen,
  visibleColorIds,
  raiseDock,
  onColorSelected,
  onColorHintRequested,
}) => {
  // Remaining counts per color
  const remainingCountMap = useMemo(() => {
    const map = new Map<number, number>();
    for (const r of regions) {
      if (!filledRegionIds.has(r.id)) {
        map.set(r.colorId, (map.get(r.colorId) || 0) + 1);
      }
    }
    return map;
  }, [regions, filledRegionIds]);

  // Uncompleted colors
  const uncompletedPalette = useMemo(() => {
    return palette.filter((c) => (remainingCountMap.get(c.id) || 0) > 0);
  }, [palette, remainingCountMap]);

  // Sorted base palette
  const sortedPalette = useMemo(() => {
    const list = [...uncompletedPalette];
    switch (sortOrder) {
      case 'NUMBER':
        list.sort((a, b) => a.id - b.id);
        break;
      case 'REMAINING':
        list.sort(
          (a, b) =>
            (remainingCountMap.get(b.id) || 0) - (remainingCountMap.get(a.id) || 0)
        );
        break;
      case 'HUE':
        list.sort((a, b) => getHue(a.hex) - getHue(b.hex));
        break;
      case 'LIGHTNESS':
        list.sort((a, b) => (a.isLight ? 1 : 0) - (b.isLight ? 1 : 0));
        break;
    }
    return list;
  }, [uncompletedPalette, sortOrder, remainingCountMap]);

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
      // If user is scrolling vertically or horizontally, scroll the palette horizontally
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

  if (dockPalette.length === 0) return null;

  // Active item
  const activeColor = dockPalette.find((c) => c.id === activeColorId) || dockPalette[0];
  const scrollableColors = dockPalette.filter((c) => c.id !== activeColor?.id);

  const handleSwatchClick = (c: PaletteColor) => {
    if (c.id === activeColorId) {
      // Tap already-selected swatch to trigger hint!
      onColorHintRequested(c.id);
    } else {
      onColorSelected(c.id);
    }
  };

  return (
    <footer
      ref={footerRef}
      className={`fixed bottom-0 left-0 right-0 z-20 flex items-center px-3 py-2 bg-slate-950/90 backdrop-blur-md border-t border-slate-800/80 shadow-2xl transition-all ${
        raiseDock ? 'pb-6' : 'pb-2'
      }`}
      aria-label="Palette dock"
    >
      <div className="flex items-center w-full max-w-7xl mx-auto gap-2.5 overflow-hidden">
        {/* Pinned Active Color Swatch */}
        {activeColor && (
          <div className="flex-shrink-0 flex items-center pr-2 border-r border-slate-800/80">
            <button
              type="button"
              onClick={() => handleSwatchClick(activeColor)}
              title={`Color #${displayNumberMap.get(activeColor.id)} (${remainingCountMap.get(activeColor.id) || 0} remaining) - Click for hint`}
              className="relative flex flex-col items-center justify-center w-[48px] h-[40px] rounded-lg shadow-lg ring-2 ring-amber-400 ring-offset-2 ring-offset-slate-950 scale-105 transition-transform"
              style={{ backgroundColor: activeColor.hex }}
            >
              <span
                className={`text-[12.5px] font-extrabold leading-tight ${
                  activeColor.isLight ? 'text-slate-950' : 'text-white'
                }`}
              >
                {displayNumberMap.get(activeColor.id)}
              </span>
              <span
                className={`text-[9.5px] font-bold leading-tight ${
                  activeColor.isLight ? 'text-slate-800' : 'text-slate-200'
                }`}
              >
                {remainingCountMap.get(activeColor.id) || 0}
              </span>
            </button>
          </div>
        )}

        {/* Scrollable remaining swatches */}
        <div
          ref={scrollContainerRef}
          className="flex items-center gap-2 overflow-x-auto no-scrollbar py-1"
        >
          {scrollableColors.map((color) => {
            const isVisibleOnScreen = visibleColorIds.has(color.id);
            const dispNum = displayNumberMap.get(color.id);
            const remaining = remainingCountMap.get(color.id) || 0;

            return (
              <button
                key={color.id}
                type="button"
                onClick={() => handleSwatchClick(color)}
                title={`Color #${dispNum} (${remaining} remaining)${isVisibleOnScreen ? ' • On Screen' : ''}`}
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
                  className={`text-[9px] font-bold leading-tight ${
                    color.isLight ? 'text-slate-800' : 'text-slate-200'
                  }`}
                >
                  {remaining}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </footer>
  );
};
