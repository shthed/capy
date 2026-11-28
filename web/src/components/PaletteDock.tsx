import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
const useIsomorphicLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect;
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
  prioritizedColorIds?: ReadonlySet<number>;
  raiseDock: boolean;
  isFreeColorMode?: boolean;
  isReplaying?: boolean;
  reducedMotion?: boolean;
  largeText?: boolean;
  uiScale?: number;
  showCustomColorButton?: boolean;
  onColorSelected: (colorId: number) => void;
  onSyncActiveColor?: (colorId: number) => void;
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
  sortOrder: PaletteSortOrder = 'HUE'
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
  sortOrder: PaletteSortOrder = 'HUE',
  isFreeColorMode: boolean = false,
  activeColorId?: number,
  paintedRegionColors?: ReadonlyMap<number, number>
): PaletteColor[] {
  if (isFreeColorMode) {
    const list = [...palette];
    switch (sortOrder) {
      case 'NUMBER':
        list.sort((a, b) => a.id - b.id);
        break;
      case 'REMAINING': {
        const usageMap = new Map<number, number>();
        for (const r of regions) {
          if (filledRegionIds.has(r.id)) {
            const colId = paintedRegionColors?.get(r.id) ?? r.colorId;
            usageMap.set(colId, (usageMap.get(colId) || 0) + 1);
          }
        }
        list.sort((a, b) => (usageMap.get(b.id) || 0) - (usageMap.get(a.id) || 0));
        break;
      }
      case 'HUE':
        list.sort((a, b) => getHue(a.hex) - getHue(b.hex));
        break;
      case 'LIGHTNESS':
        list.sort((a, b) => (a.isLight ? 1 : 0) - (b.isLight ? 1 : 0));
        break;
    }
    return list;
  }

  const isPuzzleComplete = regions.length > 0 && filledRegionIds.size >= regions.length;
  if (isPuzzleComplete) {
    return [];
  }

  const remainingMap = new Map<number, number>();
  for (const r of regions) {
    if (!filledRegionIds.has(r.id)) {
      remainingMap.set(r.colorId, (remainingMap.get(r.colorId) || 0) + 1);
    }
  }

  const list = palette.filter(
    (c) =>
      (remainingMap.get(c.id) || 0) > 0 || (activeColorId !== undefined && c.id === activeColorId)
  );
  switch (sortOrder) {
    case 'NUMBER':
      list.sort((a, b) => a.id - b.id);
      break;
    case 'REMAINING':
      list.sort((a, b) => (remainingMap.get(b.id) || 0) - (remainingMap.get(a.id) || 0));
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
  _prioritizeOnScreen: boolean = false,
  _visibleColorIds: Set<number> = new Set(),
  _activeColorId?: number
): PaletteColor[] {
  return basePalette;
}

export interface PartitionedDockPalette {
  dockPalette: PaletteColor[];
  floatedCount: number;
}

/**
 * Stable-partitions `sortedPalette` so colors in `prioritizedColorIds` (e.g.
 * zoomed-in nested-layer colors) float to the front while preserving exact
 * relative `sortedPalette` order inside both floated and remaining groups.
 * Returns `sortedPalette` reference untouched with `floatedCount: 0` when no
 * swatches are prioritized (100% unchanged standard 0-nested-layer behavior).
 */
export function partitionDockPaletteByPriority(
  sortedPalette: readonly PaletteColor[],
  prioritizedColorIds?: ReadonlySet<number>
): PartitionedDockPalette {
  if (!prioritizedColorIds || prioritizedColorIds.size === 0 || sortedPalette.length === 0) {
    return { dockPalette: sortedPalette as PaletteColor[], floatedCount: 0 };
  }
  const floated: PaletteColor[] = [];
  const rest: PaletteColor[] = [];
  for (let i = 0; i < sortedPalette.length; i++) {
    const color = sortedPalette[i];
    if (prioritizedColorIds.has(color.id)) {
      floated.push(color);
    } else {
      rest.push(color);
    }
  }
  if (floated.length === 0) {
    return { dockPalette: sortedPalette as PaletteColor[], floatedCount: 0 };
  }
  if (rest.length === 0) {
    return { dockPalette: floated, floatedCount: floated.length };
  }
  return {
    dockPalette: floated.concat(rest),
    floatedCount: floated.length,
  };
}

export const PaletteDock: React.FC<PaletteDockProps> = React.memo(({
  palette,
  regions,
  activeColorId,
  filledRegionIds,
  paintedRegionColors,
  sortOrder,
  prioritizeOnScreen,
  visibleColorIds,
  prioritizedColorIds,
  raiseDock,
  isFreeColorMode = false,
  isReplaying = false,
  reducedMotion = false,
  largeText = false,
  uiScale,
  showCustomColorButton = false,
  onColorSelected,
  onSyncActiveColor,
  onColorHintRequested,
  onOpenPaletteOptions,
  onAddCustomColor: _onAddCustomColor,
  onUpdateColor: _onUpdateColor,
  onApplyPresetPalette: _onApplyPresetPalette,
}) => {
  const effectiveUiScale = uiScale ?? (largeText ? 1.25 : 1.0);
  const onColorSelectedRef = useRef(onColorSelected);
  onColorSelectedRef.current = onColorSelected;
  const onSyncActiveColorRef = useRef(onSyncActiveColor);
  onSyncActiveColorRef.current = onSyncActiveColor;

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

  // Stable-partition dock so prominently visible nested-layer colors float to front
  // while keeping standard 0-nested-layer puzzles 100% in sorted order
  const { dockPalette, floatedCount } = useMemo(
    () => partitionDockPaletteByPriority(sortedPalette, prioritizedColorIds),
    [sortedPalette, prioritizedColorIds]
  );

  const hasNestedDivider = floatedCount > 0 && floatedCount < dockPalette.length;

  const floatedSignature = useMemo(() => {
    if (floatedCount === 0) return '';
    let sig = `${floatedCount}:`;
    for (let i = 0; i < floatedCount; i++) {
      sig += i === 0 ? `${dockPalette[i].id}` : `,${dockPalette[i].id}`;
    }
    return sig;
  }, [dockPalette, floatedCount]);

  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const footerRef = useRef<HTMLDivElement>(null);
  const activeSwatchRef = useRef<HTMLButtonElement | null>(null);
  const [isScrollable, setIsScrollable] = useState(false);

  const itemCount =
    dockPalette.length + (showCustomColorButton && onOpenPaletteOptions ? 1 : 0);

  useIsomorphicLayoutEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    const measure = () => {
      const clientW = container.clientWidth;
      if (clientW <= 0) return;
      const swatchW = Math.round(46 * effectiveUiScale);
      const swatchGap = Math.round(8 * effectiveUiScale);
      const dividerExtraW = hasNestedDivider ? 2 + swatchGap : 0;
      const naturalWidth =
        itemCount * swatchW + Math.max(0, itemCount - 1) * swatchGap + dividerExtraW + 24;
      setIsScrollable(naturalWidth > clientW);
    };

    measure();
    if (typeof ResizeObserver === 'function') {
      const ro = new ResizeObserver(measure);
      ro.observe(container);
      return () => ro.disconnect();
    }
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [itemCount, hasNestedDivider, effectiveUiScale]);

  // Smoothly center the active color in view when activeColorId or dock layout changes
  useEffect(() => {
    const container = scrollContainerRef.current;
    const swatch = activeSwatchRef.current;
    if (!container || !swatch) return;
    if (!isScrollable) {
      container.scrollLeft = 0;
      return;
    }
    const targetLeft = Math.max(
      0,
      swatch.offsetLeft + swatch.offsetWidth / 2 - container.clientWidth / 2
    );
    if (typeof container.scrollTo === 'function') {
      container.scrollTo({
        left: targetLeft,
        behavior: reducedMotion ? 'auto' : 'smooth',
      });
    } else {
      container.scrollLeft = targetLeft;
    }
  }, [
    activeColorId,
    reducedMotion,
    isScrollable,
    sortOrder,
    dockPalette.length,
    floatedSignature,
    effectiveUiScale,
  ]);

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
      if (onSyncActiveColorRef.current) {
        onSyncActiveColorRef.current(dockPalette[0].id);
      } else {
        onColorSelectedRef.current(dockPalette[0].id);
      }
    }
  }, [dockPalette, activeColorId]);

  if (dockPalette.length === 0) return null;

  const handleSwatchClick = (c: PaletteColor) => {
    if (c.id === activeColorId && !isReplaying) {
      onColorHintRequested(c.id);
    } else {
      onColorSelected(c.id);
    }
  };

  return (
    <div
      ref={footerRef}
      data-testid="palette-dock"
      className="fixed z-20 left-0 right-0 pointer-events-none transition-all flex items-center"
      style={{
        bottom: `calc(${raiseDock ? '2rem' : '0.375rem'} + var(--sab, 0px))`,
      }}
      aria-label="Palette dock"
    >
      {/* Scrollable swatches floating all the way to screen edges with no outer border and ample vertical padding for active ring */}
      <div
        ref={scrollContainerRef}
        className="pointer-events-auto w-full flex overflow-x-auto no-scrollbar py-3"
        style={{
          scrollbarWidth: 'none',
          msOverflowStyle: 'none',
        }}
      >
        <div
          className="flex items-center mx-auto min-w-max"
          style={{
            paddingLeft: isScrollable
              ? 'max(calc(50% - var(--capy-swatch-half, 23px)), calc(var(--sal, 0px) + 0.75rem))'
              : 'max(0.75rem, calc(var(--sal, 0px) + 0.75rem))',
            paddingRight: isScrollable
              ? 'max(calc(50% - var(--capy-swatch-half, 23px)), calc(var(--sar, 0px) + 0.75rem))'
              : 'max(0.75rem, calc(var(--sar, 0px) + 0.75rem))',
          }}
        >
        <div data-testid="palette-dock-tray" className="capy-palette-tray flex items-center gap-2">
        {dockPalette.map((color, index) => {
          const isActive = color.id === activeColorId;
          const isFloated = index < floatedCount;
          const isVisibleOnScreen = visibleColorIds.has(color.id);
          const dispNum = displayNumberMap.get(color.id);
          const badgeVal = isFreeColorMode
            ? colorUsageMap.get(color.id) || 0
            : remainingCountMap.get(color.id) || 0;

          return (
            <React.Fragment key={color.id}>
              <button
                ref={isActive ? activeSwatchRef : undefined}
                type="button"
                data-testid={`palette-swatch-${dispNum}`}
                data-nested-floated={isFloated ? 'true' : undefined}
                aria-label={`Color #${dispNum}${
                  isFreeColorMode
                    ? ` (${badgeVal} painted)`
                    : ` (${badgeVal} remaining)`
                }`}
                aria-pressed={isActive}
                onClick={() => handleSwatchClick(color)}
                title={`Color #${dispNum}${
                  isFreeColorMode
                    ? ` (${badgeVal} painted)`
                    : ` (${badgeVal} remaining)`
                }${isFloated ? ' • Detail Area' : ''}${isVisibleOnScreen ? ' • On Screen' : ''}${isActive ? ' (Selected)' : ''}`}
                className={`capy-swatch-btn flex-shrink-0 relative flex flex-col items-center justify-center w-[46px] h-[40px] rounded-xl transition-[transform,opacity,box-shadow,background-color] active:scale-95 shadow-md ${
                  isActive
                    ? 'ring-2 ring-amber-400 ring-offset-2 ring-offset-slate-950 scale-105 shadow-xl opacity-100 z-10'
                    : isFloated
                    ? 'ring-1 ring-amber-300/80 shadow-md opacity-95 hover:opacity-100 hover:scale-102'
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
              {hasNestedDivider && index === floatedCount - 1 && (
                <span
                  data-testid="palette-nested-divider"
                  role="separator"
                  aria-orientation="vertical"
                  className="flex-shrink-0 w-[2px] h-7 rounded-full bg-amber-400/60"
                />
              )}
            </React.Fragment>
          );
        })}

        {/* Button to open custom color picker & palette options at the end of the dock */}
        {showCustomColorButton && onOpenPaletteOptions && (
          <button
            type="button"
            data-testid="palette-custom-btn"
            onClick={onOpenPaletteOptions}
            aria-label="Custom Color and Palette Options"
            title="Custom Color & Palette Options"
            className="capy-swatch-btn flex-shrink-0 relative flex flex-col items-center justify-center w-[46px] h-[40px] rounded-xl bg-slate-900/90 text-amber-400 border border-slate-700/80 shadow-md hover:bg-slate-800 hover:scale-105 active:scale-95 transition-[transform,opacity,box-shadow,background-color]"
          >
            <Palette size={18} />
            <span className="text-[8.5px] font-bold text-slate-300 leading-none mt-0.5">
              Custom
            </span>
          </button>
        )}
        </div>
        </div>
      </div>
    </div>
  );
});
