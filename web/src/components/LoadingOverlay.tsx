import React, { useState } from 'react';
import {
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Circle,
  Cpu,
  HardDrive,
  Image as ImageIcon,
  Layers,
  Loader2,
  Palette,
  Sparkles,
  Zap,
} from 'lucide-react';
import {
  GENERATION_PIPELINE_STEPS,
  GenerationProgressPayload,
} from '../types';

interface LoadingOverlayProps {
  isLoading: boolean;
  status: string;
  progress: number;
  payload?: GenerationProgressPayload | null;
  detailedProgress?: boolean;
  onToggleDetailedProgress?: (enabled: boolean) => void;
}

export const LoadingOverlay: React.FC<LoadingOverlayProps> = ({
  isLoading,
  status,
  progress,
  payload,
  detailedProgress = true,
  onToggleDetailedProgress,
}) => {
  const [isExpanded, setIsExpanded] = useState<boolean>(false);

  if (!isLoading && !isExpanded) return null;
  if (!isLoading) return null;

  const pct = Math.min(100, Math.max(0, Math.round(progress * 100)));
  const stepIndex = payload?.stepIndex || 1;
  const totalSteps = payload?.totalSteps || GENERATION_PIPELINE_STEPS.length;
  const stepName =
    payload?.stepName ||
    GENERATION_PIPELINE_STEPS[stepIndex - 1]?.name ||
    'Artwork Analysis & Style Detection';
  const stepDescription =
    payload?.stepDescription ||
    GENERATION_PIPELINE_STEPS[stepIndex - 1]?.description ||
    'Analyzing artwork composition and preparing puzzle regions...';
  const steps =
    payload?.steps ||
    GENERATION_PIPELINE_STEPS.map((s) => ({
      ...s,
      status:
        s.id < stepIndex
          ? ('completed' as const)
          : s.id === stepIndex
            ? ('in_progress' as const)
            : ('pending' as const),
    }));
  const inspection = payload?.inspection || {};

  return (
    <div
      className="fixed inset-x-0 bottom-0 z-40 pointer-events-none flex flex-col items-center justify-end p-3 sm:p-5"
      style={{
        paddingBottom: 'max(1rem, calc(var(--sab, 0px) + 0.75rem))',
      }}
    >
      <div className="pointer-events-auto w-full max-w-lg bg-slate-900/92 border border-slate-700/80 rounded-2xl shadow-2xl backdrop-blur-xl text-slate-100 overflow-hidden transition-all duration-200 animate-in fade-in slide-in-from-bottom-4">
        {/* Simple Progress Mode: Sleek, lightweight, low-overhead HUD */}
        {!detailedProgress ? (
          <div className="p-3.5 sm:p-4 space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-emerald-400/20 text-emerald-300 border border-emerald-400/30 flex-shrink-0">
                  <Zap size={10} />
                  Fast
                </span>
                <h3 className="text-xs sm:text-sm font-bold text-white truncate">
                  Generating Puzzle...
                </h3>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                {onToggleDetailedProgress && (
                  <button
                    type="button"
                    onClick={() => onToggleDetailedProgress(true)}
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold bg-slate-800/90 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-700 transition-colors flex-shrink-0 cursor-pointer"
                    title="Switch to Detailed Progress with real-time pipeline metrics and live palette swatches"
                  >
                    <Sparkles size={11} className="text-amber-400" />
                    <span>Detailed</span>
                  </button>
                )}
                <span className="text-xs font-extrabold text-amber-400 tabular-nums flex-shrink-0">
                  {pct}%
                </span>
              </div>
            </div>

            {/* Monotonic Progress Bar */}
            <div className="w-full h-2 bg-slate-800 rounded-full overflow-hidden border border-slate-700/50">
              <div
                className="h-full bg-gradient-to-r from-amber-500 via-amber-400 to-yellow-300 rounded-full transition-all duration-150 ease-out"
                style={{ width: `${pct}%` }}
              />
            </div>

            {/* Active Sub-Status */}
            <div className="flex items-center justify-between gap-2 pt-0.5">
              <div className="flex items-center gap-1.5 text-[11px] text-slate-400 min-w-0">
                <Loader2 size={13} className="text-amber-400 animate-spin flex-shrink-0" />
                <span className="truncate">{status || 'Generating puzzle regions...'}</span>
              </div>
              <span className="text-[10px] text-slate-500 hidden sm:inline flex-shrink-0">
                Optimized for speed
              </span>
            </div>
          </div>
        ) : (
          /* Detailed Progress Mode: Full pipeline stages, inspection metrics, and step details */
          <div className="p-4 space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-amber-400/20 text-amber-300 border border-amber-400/30 flex-shrink-0">
                  <Sparkles size={10} />
                  Step {stepIndex}/{totalSteps}
                </span>
                <h3 className="text-xs sm:text-sm font-bold text-white truncate">
                  {stepName}
                </h3>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                {onToggleDetailedProgress && (
                  <button
                    type="button"
                    onClick={() => onToggleDetailedProgress(false)}
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold bg-slate-800/90 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-700 transition-colors flex-shrink-0 cursor-pointer"
                    title="Switch to Simple Progress (Faster, minimal rendering)"
                  >
                    <Zap size={11} className="text-amber-400" />
                    <span>Fast Mode</span>
                  </button>
                )}
                <span className="text-xs font-extrabold text-amber-400 tabular-nums flex-shrink-0">
                  {pct}%
                </span>
              </div>
            </div>

            {/* Monotonic Progress Bar */}
            <div className="w-full h-2 bg-slate-800 rounded-full overflow-hidden border border-slate-700/50">
              <div
                className="h-full bg-gradient-to-r from-amber-500 via-amber-400 to-yellow-300 rounded-full transition-all duration-150 ease-out"
                style={{ width: `${pct}%` }}
              />
            </div>

            {/* Active Sub-Status & Toggle Details Button */}
            <div className="flex items-center justify-between gap-2 pt-0.5">
              <div className="flex items-center gap-1.5 text-[11px] text-slate-300 min-w-0">
                <Loader2 size={13} className="text-amber-400 animate-spin flex-shrink-0" />
                <span className="truncate">{status}</span>
              </div>

              <button
                type="button"
                onClick={() => setIsExpanded((prev) => !prev)}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-bold bg-slate-800/90 hover:bg-slate-700/90 text-amber-300 border border-slate-700 transition-colors flex-shrink-0 cursor-pointer"
              >
                <span>{isExpanded ? 'Hide Details' : 'Generation Details'}</span>
                {isExpanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
              </button>
            </div>

            {/* Real Pipeline Parameter Badges */}
            {(inspection.detectedType || inspection.chosenStrategy || inspection.colorCount || inspection.maxRegions) && (
              <div className="flex flex-wrap items-center gap-1.5 pt-0.5 text-[10px]">
                {inspection.detectedType && (
                  <span className="px-2 py-0.5 rounded-md bg-slate-800/90 text-slate-200 border border-slate-700/80 font-medium">
                    <span className="text-slate-400">Style: </span>
                    <span className="text-white font-semibold">{inspection.detectedType}</span>
                  </span>
                )}
                {inspection.chosenStrategy && (
                  <span className="px-2 py-0.5 rounded-md bg-amber-500/15 text-amber-200 border border-amber-400/30 font-medium">
                    <span className="text-amber-400">Strategy: </span>
                    <span className="text-amber-300 font-semibold">{inspection.chosenStrategy}</span>
                  </span>
                )}
                {inspection.colorCount && (
                  <span className="px-2 py-0.5 rounded-md bg-slate-800/90 text-slate-200 border border-slate-700/80 font-medium">
                    <span className="text-slate-400">Colors: </span>
                    <span className="text-white font-semibold">{inspection.colorCount}</span>
                  </span>
                )}
                {inspection.maxRegions && (
                  <span className="px-2 py-0.5 rounded-md bg-slate-800/90 text-slate-200 border border-slate-700/80 font-medium">
                    <span className="text-slate-400">Target: </span>
                    <span className="text-white font-semibold">Max {inspection.maxRegions}</span>
                  </span>
                )}
              </div>
            )}

            {/* Real Clustered Palette Swatches from K-Means */}
            {inspection.paletteColors && inspection.paletteColors.length > 0 && (
              <div className="space-y-1 pt-1.5 border-t border-slate-800/70">
                <div className="flex items-center justify-between text-[10px] text-slate-400">
                  <span className="font-semibold text-amber-300">
                    Extracted Palette Swatches ({inspection.paletteColors.length})
                  </span>
                  <span className="text-[9px] text-slate-500">Live K-Means Centroids</span>
                </div>
                <div className="flex flex-wrap gap-1 max-h-12 overflow-hidden py-0.5">
                  {inspection.paletteColors.slice(0, 36).map((col, idx) => (
                    <span
                      key={idx}
                      className="w-3.5 h-3.5 rounded-full border border-slate-600/70 shadow-xs inline-block flex-shrink-0"
                      style={{ backgroundColor: `rgb(${col.r}, ${col.g}, ${col.b})` }}
                      title={`rgb(${col.r}, ${col.g}, ${col.b})`}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Brief description of current step */}
            <p className="text-[11px] text-slate-400 leading-relaxed">
              {stepDescription}
            </p>
          </div>
        )}

        {/* Expandable Puzzle Generation Details Panel */}
        {isExpanded && (
          <div className="border-t border-slate-800 bg-slate-950/80 px-4 py-3.5 space-y-3.5 max-h-[55vh] overflow-y-auto text-xs">
            {/* Auto-Detected Artwork & Strategy Metrics */}
            <div className="space-y-2">
              <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-amber-400">
                <Cpu size={13} />
                <span>Auto-Detected Artwork & Engine Parameters</span>
              </div>

              {inspection.strategyRationale && (
                <div className="p-2.5 rounded-xl bg-amber-500/10 border border-amber-400/25 text-[11px] text-slate-200 leading-relaxed">
                  <span className="font-bold text-amber-300">Strategy Decision: </span>
                  {inspection.strategyRationale}
                </div>
              )}

              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                <div className="p-2 rounded-lg bg-slate-900/90 border border-slate-800">
                  <div className="flex items-center gap-1 text-[10px] text-slate-400">
                    <ImageIcon size={11} />
                    <span>Detected Style</span>
                  </div>
                  <div className="font-bold text-slate-100 mt-0.5 truncate">
                    {inspection.detectedType || 'Analyzing...'}
                  </div>
                </div>

                <div className="p-2 rounded-lg bg-slate-900/90 border border-slate-800">
                  <div className="flex items-center gap-1 text-[10px] text-slate-400">
                    <Sparkles size={11} />
                    <span>Active Strategy</span>
                  </div>
                  <div className="font-bold text-amber-300 mt-0.5 truncate">
                    {inspection.chosenStrategy || 'Auto-Detect'}
                  </div>
                </div>

                <div className="p-2 rounded-lg bg-slate-900/90 border border-slate-800">
                  <div className="flex items-center gap-1 text-[10px] text-slate-400">
                    <Palette size={11} />
                    <span>Colors & Detail</span>
                  </div>
                  <div className="font-bold text-slate-100 mt-0.5">
                    {inspection.colorCount ?? '--'} colors ({inspection.paletteDetail || 'AUTO'})
                  </div>
                </div>

                <div className="p-2 rounded-lg bg-slate-900/90 border border-slate-800">
                  <div className="flex items-center gap-1 text-[10px] text-slate-400">
                    <Layers size={11} />
                    <span>Region Target & Area</span>
                  </div>
                  <div className="font-bold text-slate-100 mt-0.5">
                    {inspection.finalRegionCount
                      ? `${inspection.finalRegionCount} regions`
                      : `Max ${inspection.maxRegions ?? 200}`}{' '}
                    <span className="text-[10px] font-normal text-slate-400">
                      (min {inspection.minRegionArea ?? 48}px²)
                    </span>
                  </div>
                </div>

                <div className="p-2 rounded-lg bg-slate-900/90 border border-slate-800">
                  <div className="flex items-center gap-1 text-[10px] text-slate-400">
                    <ImageIcon size={11} />
                    <span>Working Resolution</span>
                  </div>
                  <div className="font-bold text-slate-100 mt-0.5">
                    {inspection.targetWidth && inspection.targetHeight
                      ? `${inspection.targetWidth}×${inspection.targetHeight}`
                      : `${inspection.resolution ?? 1024}p`}
                  </div>
                </div>

                <div className="p-2 rounded-lg bg-slate-900/90 border border-slate-800">
                  <div className="flex items-center gap-1 text-[10px] text-slate-400">
                    <HardDrive size={11} />
                    <span>Est. Save Size</span>
                  </div>
                  <div className="font-bold text-slate-100 mt-0.5">
                    {inspection.estimatedSaveSizeKb
                      ? `~${inspection.estimatedSaveSizeKb} KB`
                      : 'Calculating...'}
                  </div>
                </div>
              </div>
            </div>

            {/* Step-by-Step Pipeline Breakdown */}
            <div className="space-y-2">
              <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                Generation Pipeline Stages
              </div>
              <div className="space-y-1.5">
                {steps.map((step) => {
                  const isDone = step.status === 'completed';
                  const isActive = step.status === 'in_progress';
                  return (
                    <div
                      key={step.id}
                      className={`p-2.5 rounded-xl border transition-colors ${
                        isActive
                          ? 'bg-amber-500/10 border-amber-400/40'
                          : isDone
                            ? 'bg-slate-900/60 border-slate-800/80'
                            : 'bg-slate-900/30 border-slate-800/40 opacity-65'
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        {isDone ? (
                          <CheckCircle2 size={14} className="text-emerald-400 flex-shrink-0" />
                        ) : isActive ? (
                          <Loader2 size={14} className="text-amber-400 animate-spin flex-shrink-0" />
                        ) : (
                          <Circle size={14} className="text-slate-600 flex-shrink-0" />
                        )}
                        <span
                          className={`text-xs font-bold ${
                            isActive
                              ? 'text-amber-300'
                              : isDone
                                ? 'text-slate-200'
                                : 'text-slate-400'
                          }`}
                        >
                          {step.id}. {step.name}
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-400 mt-1 pl-5 leading-relaxed">
                        {step.description}
                      </p>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
