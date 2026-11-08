import React, { useEffect, useState } from 'react';
import { Palette, Pipette, Plus, RefreshCw, X } from 'lucide-react';
import { COLORING_PALETTE_PRESETS, PaletteColor, PalettePreset } from '../types';

interface ColorPickerPopoverProps {
  isOpen: boolean;
  activeColor: PaletteColor | null;
  onClose: () => void;
  onAddCustomColor?: (hex: string) => void;
  onUpdateColor?: (colorId: number, hex: string) => void;
  onApplyPresetPalette?: (preset: PalettePreset) => void;
}

const QUICK_SWATCHES = [
  '#EF4444', '#F97316', '#F59E0B', '#EAB308',
  '#84CC16', '#22C55E', '#10B981', '#06B6D4',
  '#3B82F6', '#6366F1', '#8B5CF6', '#A855F7',
  '#EC4899', '#F43F5E', '#78350F', '#1E293B',
  '#FCA5A5', '#FDBA74', '#FDE68A', '#BEF264',
  '#86EFAC', '#6EE7B7', '#67E8F9', '#93C5FD',
  '#C4B5FD', '#F472B6', '#E2E8F0', '#FFFFFF',
];

// Helper: HSL to Hex
function hslToHex(h: number, s: number, l: number): string {
  l /= 100;
  const a = (s * Math.min(l, 1 - l)) / 100;
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const color = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
    return Math.round(255 * color)
      .toString(16)
      .padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`.toUpperCase();
}

// Helper: Hex to HSL
function hexToHsl(hex: string): { h: number; s: number; l: number } {
  const cleanHex = hex.replace('#', '');
  if (cleanHex.length < 6) return { h: 0, s: 80, l: 50 };
  const r = parseInt(cleanHex.substring(0, 2), 16) / 255;
  const g = parseInt(cleanHex.substring(2, 4), 16) / 255;
  const b = parseInt(cleanHex.substring(4, 6), 16) / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r:
        h = (g - b) / d + (g < b ? 6 : 0);
        break;
      case g:
        h = (b - r) / d + 2;
        break;
      case b:
        h = (r - g) / d + 4;
        break;
    }
    h = Math.round(h * 60);
  }
  return { h, s: Math.round(s * 100), l: Math.round(l * 100) };
}

export const ColorPickerPopover: React.FC<ColorPickerPopoverProps> = ({
  isOpen,
  activeColor,
  onClose,
  onAddCustomColor,
  onUpdateColor,
  onApplyPresetPalette,
}) => {
  const [activeTab, setActiveTab] = useState<'custom' | 'themes'>('custom');
  const [currentHex, setCurrentHex] = useState<string>(activeColor?.hex || '#EF4444');
  const [hue, setHue] = useState<number>(0);
  const [saturation, setSaturation] = useState<number>(85);
  const [lightness, setLightness] = useState<number>(55);
  const [hexInput, setHexInput] = useState<string>(activeColor?.hex || '#EF4444');

  // Sync when activeColor changes or dialog opens
  useEffect(() => {
    if (activeColor?.hex) {
      setCurrentHex(activeColor.hex);
      setHexInput(activeColor.hex);
      const { h, s, l } = hexToHsl(activeColor.hex);
      setHue(h);
      setSaturation(s);
      setLightness(l);
    }
  }, [activeColor, isOpen]);

  if (!isOpen) return null;

  const handleHslChange = (newH: number, newS: number, newL: number) => {
    setHue(newH);
    setSaturation(newS);
    setLightness(newL);
    const hex = hslToHex(newH, newS, newL);
    setCurrentHex(hex);
    setHexInput(hex);
  };

  const handleHexInputChange = (val: string) => {
    let clean = val.trim();
    if (!clean.startsWith('#')) clean = `#${clean}`;
    setHexInput(clean);
    if (/^#[0-9A-Fa-f]{6}$/.test(clean)) {
      setCurrentHex(clean.toUpperCase());
      const { h, s, l } = hexToHsl(clean);
      setHue(h);
      setSaturation(s);
      setLightness(l);
    }
  };

  const selectSwatch = (hex: string) => {
    setCurrentHex(hex);
    setHexInput(hex);
    const { h, s, l } = hexToHsl(hex);
    setHue(h);
    setSaturation(s);
    setLightness(l);
  };

  return (
    <div
      className="fixed inset-0 z-40 flex items-end sm:items-center justify-center p-3 sm:p-4 bg-slate-950/60 backdrop-blur-xs animate-in fade-in duration-150"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm rounded-2xl bg-slate-900 border border-slate-700/80 shadow-2xl overflow-hidden animate-in zoom-in-95 duration-150 text-slate-200 select-none"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header with Tabs */}
        <div className="flex items-center justify-between px-3.5 py-2.5 border-b border-slate-800 bg-slate-950/40">
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setActiveTab('custom')}
              className={`px-2.5 py-1 text-xs font-bold rounded-lg transition-all ${
                activeTab === 'custom'
                  ? 'bg-amber-400/20 text-amber-300 border border-amber-400/40 shadow-xs'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
              }`}
            >
              Custom Colour
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('themes')}
              className={`px-2.5 py-1 text-xs font-bold rounded-lg transition-all ${
                activeTab === 'themes'
                  ? 'bg-amber-400/20 text-amber-300 border border-amber-400/40 shadow-xs'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
              }`}
            >
              Palette Themes
            </button>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
            title="Close"
          >
            <X size={16} />
          </button>
        </div>

        {/* Custom Colour Tab Content */}
        {activeTab === 'custom' && (
          <div className="p-3.5 flex flex-col gap-3">
            {/* Live Preview & Hex Input Row */}
            <div className="flex items-center gap-3">
              <div
                className="w-14 h-14 rounded-xl border-2 border-white/40 shadow-md flex-shrink-0 transition-colors"
                style={{ backgroundColor: currentHex }}
              />
              <div className="flex-1 flex flex-col gap-1">
                <span className="text-[11px] font-semibold text-slate-400">HEX Code</span>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={hexInput}
                    maxLength={7}
                    onChange={(e) => handleHexInputChange(e.target.value)}
                    className="w-28 px-2.5 py-1 rounded-lg bg-slate-950 border border-slate-700 text-xs font-mono font-bold text-amber-300 focus:outline-hidden focus:border-amber-400 focus:ring-1 focus:ring-amber-400"
                    placeholder="#RRGGBB"
                  />
                  {/* System native eyedropper trigger */}
                  <label
                    title="System Eyedropper / Color Picker"
                    className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 cursor-pointer flex items-center justify-center transition-colors active:scale-95"
                  >
                    <Pipette size={14} />
                    <input
                      type="color"
                      value={currentHex}
                      onChange={(e) => selectSwatch(e.target.value.toUpperCase())}
                      className="sr-only"
                    />
                  </label>
                </div>
              </div>
            </div>

            {/* Sliders: Hue, Saturation, Lightness */}
            <div className="flex flex-col gap-2 pt-1">
              {/* Hue rainbow slider */}
              <div className="flex flex-col gap-1">
                <div className="flex justify-between text-[10px] font-bold text-slate-400">
                  <span>Hue</span>
                  <span>{hue}°</span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={360}
                  value={hue}
                  onChange={(e) => handleHslChange(parseInt(e.target.value), saturation, lightness)}
                  className="w-full h-3 rounded-lg appearance-none cursor-pointer"
                  style={{
                    background:
                      'linear-gradient(to right, #f00 0%, #ff0 17%, #0f0 33%, #0ff 50%, #00f 67%, #f0f 83%, #f00 100%)',
                  }}
                />
              </div>

              {/* Saturation slider */}
              <div className="flex flex-col gap-1">
                <div className="flex justify-between text-[10px] font-bold text-slate-400">
                  <span>Saturation</span>
                  <span>{saturation}%</span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={saturation}
                  onChange={(e) => handleHslChange(hue, parseInt(e.target.value), lightness)}
                  className="w-full h-2.5 rounded-lg appearance-none cursor-pointer bg-slate-800 accent-amber-400"
                />
              </div>

              {/* Lightness slider */}
              <div className="flex flex-col gap-1">
                <div className="flex justify-between text-[10px] font-bold text-slate-400">
                  <span>Lightness</span>
                  <span>{lightness}%</span>
                </div>
                <input
                  type="range"
                  min={5}
                  max={95}
                  value={lightness}
                  onChange={(e) => handleHslChange(hue, saturation, parseInt(e.target.value))}
                  className="w-full h-2.5 rounded-lg appearance-none cursor-pointer bg-slate-800 accent-amber-400"
                />
              </div>
            </div>

            {/* Quick Palette Swatches */}
            <div className="flex flex-col gap-1.5 pt-1">
              <span className="text-[11px] font-semibold text-slate-400">Quick Swatches</span>
              <div className="grid grid-cols-7 gap-1.5 max-h-24 overflow-y-auto no-scrollbar py-0.5">
                {QUICK_SWATCHES.map((hex, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => selectSwatch(hex)}
                    style={{ backgroundColor: hex }}
                    title={hex}
                    className={`w-7 h-7 rounded-md border shadow-xs transition-all active:scale-90 hover:scale-110 ${
                      currentHex === hex ? 'border-amber-400 ring-2 ring-amber-400 ring-offset-1 ring-offset-slate-900 scale-105' : 'border-black/30'
                    }`}
                  />
                ))}
              </div>
            </div>

            {/* Action Buttons */}
            <div className="flex items-center gap-2 pt-2 border-t border-slate-800">
              {activeColor && onUpdateColor && (
                <button
                  type="button"
                  onClick={() => {
                    onUpdateColor(activeColor.id, currentHex);
                    onClose();
                  }}
                  className="flex-1 flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-bold text-slate-100 transition-all active:scale-98 border border-slate-700 shadow-sm"
                >
                  <RefreshCw size={13} />
                  <span>Update Swatch #{activeColor.id}</span>
                </button>
              )}
              {onAddCustomColor && (
                <button
                  type="button"
                  onClick={() => {
                    onAddCustomColor(currentHex);
                    onClose();
                  }}
                  className="flex-1 flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl bg-amber-400 hover:bg-amber-300 text-xs font-black text-slate-950 transition-all active:scale-98 shadow-md"
                >
                  <Plus size={14} />
                  <span>Add to Palette</span>
                </button>
              )}
            </div>
          </div>
        )}

        {/* Themes Tab Content */}
        {activeTab === 'themes' && (
          <div className="p-3.5 flex flex-col gap-2 max-h-80 overflow-y-auto no-scrollbar">
            <span className="text-[11px] font-semibold text-slate-400 mb-1">
              Select a curated color theme:
            </span>
            {COLORING_PALETTE_PRESETS.map((preset) => (
              <button
                key={preset.id}
                type="button"
                onClick={() => {
                  onApplyPresetPalette?.(preset);
                  onClose();
                }}
                className="flex flex-col gap-1.5 p-2.5 rounded-xl bg-slate-950/70 hover:bg-slate-800 border border-slate-800/80 transition-all text-left group"
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-200 group-hover:text-amber-300 transition-colors">
                    {preset.name}
                  </span>
                  <span className="text-[10px] text-slate-500 font-medium">
                    {preset.colors.length} colours
                  </span>
                </div>
                <div className="flex items-center gap-1 overflow-x-hidden">
                  {preset.colors.slice(0, 14).map((hex, idx) => (
                    <span
                      key={idx}
                      className="w-4 h-4 rounded-full border border-black/30 shadow-xs flex-shrink-0"
                      style={{ backgroundColor: hex }}
                    />
                  ))}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
