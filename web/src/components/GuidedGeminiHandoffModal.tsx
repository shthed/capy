import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import {
  AlertTriangle,
  Check,
  ClipboardPaste,
  Copy,
  ExternalLink,
  Image as ImageIcon,
  ImagePlus,
  Loader2,
  Share2,
  Sparkles,
  Upload,
  X,
} from 'lucide-react';
import { NativeBridge } from '../services/NativeBridge';
import type { GuidedAiAppId } from '../types';
import {
  copyPromptToClipboard,
  copyTemplateImageToClipboard,
  getGuidedAiAppMeta,
  GUIDED_AI_APPS,
  GuidedGeminiHandoffPackage,
  launchGeminiHandoff,
} from '../services/ai/NanoBananaService';

function isEditableTarget(target: EventTarget | null): boolean {
  if (!target || typeof target !== 'object') return false;
  const el = target as { tagName?: unknown; isContentEditable?: unknown };
  if (el.isContentEditable === true) return true;
  if (typeof el.tagName === 'string') {
    const tag = el.tagName.toUpperCase();
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
  }
  return false;
}

function isBackgroundCanvasShortcutKey(key: string): boolean {
  if (key.length === 1) {
    if (key >= '0' && key <= '9') return true;
    const lower = key.toLowerCase();
    return (
      lower === 'w' ||
      lower === 'a' ||
      lower === 's' ||
      lower === 'd' ||
      key === '+' ||
      key === '=' ||
      key === '-' ||
      key === '_'
    );
  }
  return (
    key === 'ArrowUp' ||
    key === 'ArrowDown' ||
    key === 'ArrowLeft' ||
    key === 'ArrowRight'
  );
}

const SUPPORTED_CLIPBOARD_RASTER_MIMES = new Set<string>([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'image/bmp',
]);

function normalizeClipboardMime(mime: string | null | undefined): string {
  if (typeof mime !== 'string') return '';
  return mime.split(';')[0].trim().toLowerCase();
}

function isSupportedClipboardRasterMime(mime: string | null | undefined): boolean {
  return SUPPORTED_CLIPBOARD_RASTER_MIMES.has(normalizeClipboardMime(mime));
}

function isAnyImageMime(mime: string | null | undefined): boolean {
  return normalizeClipboardMime(mime).startsWith('image/');
}

function selectPreferredClipboardItemType(
  items: readonly ClipboardItem[]
): { item: ClipboardItem; type: string } | null {
  let fallback: { item: ClipboardItem; type: string } | null = null;
  for (const item of items) {
    for (const type of item.types) {
      if (!isAnyImageMime(type)) continue;
      if (isSupportedClipboardRasterMime(type)) {
        return { item, type };
      }
      if (!fallback) {
        fallback = { item, type };
      }
    }
  }
  return fallback;
}

function selectPreferredPasteFile(clipboardData: DataTransfer): File | null {
  let fallbackFile: File | null = null;
  if (clipboardData.items && clipboardData.items.length > 0) {
    for (let i = 0; i < clipboardData.items.length; i++) {
      const item = clipboardData.items[i];
      if (!item || !isAnyImageMime(item.type)) continue;
      const file = item.getAsFile();
      if (!file) continue;
      if (isSupportedClipboardRasterMime(item.type) || isSupportedClipboardRasterMime(file.type)) {
        return file;
      }
      if (!fallbackFile) {
        fallbackFile = file;
      }
    }
  }
  if (clipboardData.files && clipboardData.files.length > 0) {
    for (let i = 0; i < clipboardData.files.length; i++) {
      const file = clipboardData.files[i];
      if (!file || !isAnyImageMime(file.type)) continue;
      if (isSupportedClipboardRasterMime(file.type)) {
        return file;
      }
      if (!fallbackFile) {
        fallbackFile = file;
      }
    }
  }
  return fallbackFile;
}

interface GuidedGeminiStep1CardProps {
  prompt: string;
  templatePreviewUrl: string;
  isAndroid: boolean;
  selectedApp: GuidedAiAppId;
  isProcessing: boolean;
  isLaunching: boolean;
  copiedOnly: boolean;
  copiedImage: boolean;
  launchStatus: string | null;
  onSelectApp: (app: GuidedAiAppId) => void;
  onCopyPrompt: () => void;
  onCopyImage: () => void;
  onLaunchGemini: () => void;
}

const GuidedGeminiStep1Card: React.FC<GuidedGeminiStep1CardProps> = ({
  prompt,
  templatePreviewUrl,
  isAndroid,
  selectedApp,
  isProcessing,
  isLaunching,
  copiedOnly,
  copiedImage,
  launchStatus,
  onSelectApp,
  onCopyPrompt,
  onCopyImage,
  onLaunchGemini,
}) => {
  const appMeta = getGuidedAiAppMeta(selectedApp);
  return (
    <div className="rounded-xl bg-slate-950/75 border border-slate-800 p-3 space-y-2.5 min-w-0">
      <div className="flex flex-wrap items-center justify-between gap-2 min-w-0">
        <span className="text-xs font-extrabold text-sky-300 min-w-0 break-words">
          Step 1 — Send Template &amp; Prompt to {appMeta.label}
        </span>
        <div className="flex flex-wrap items-center gap-1.5 min-w-0">
          {!isAndroid && (
            <button
              type="button"
              data-testid="guided-gemini-copy-image-btn"
              disabled={isProcessing}
              onClick={onCopyImage}
              className="inline-flex items-center justify-center gap-1 px-2.5 py-1.5 min-h-[44px] max-w-full rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs font-bold text-slate-200 transition-colors cursor-pointer disabled:opacity-50"
            >
              {copiedImage ? (
                <Check size={13} className="text-emerald-400 shrink-0" />
              ) : (
                <ImageIcon size={13} className="text-sky-300 shrink-0" />
              )}
              <span className="whitespace-nowrap">
                {copiedImage ? 'Copied Image' : 'Copy Image'}
              </span>
            </button>
          )}
          <button
            type="button"
            data-testid="guided-gemini-copy-prompt-btn"
            disabled={isProcessing}
            onClick={onCopyPrompt}
            className="inline-flex items-center justify-center gap-1 px-2.5 py-1.5 min-h-[44px] max-w-full rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs font-bold text-slate-200 transition-colors cursor-pointer disabled:opacity-50"
          >
            {copiedOnly ? (
              <Check size={13} className="text-emerald-400 shrink-0" />
            ) : (
              <Copy size={13} className="shrink-0" />
            )}
            <span className="whitespace-nowrap">{copiedOnly ? 'Copied' : 'Copy Prompt'}</span>
          </button>
        </div>
      </div>

      {!isAndroid && (
        <div className="flex flex-wrap items-center gap-1.5 min-w-0" role="group" aria-label="Choose AI app">
          {GUIDED_AI_APPS.map((app) => {
            const active = app.id === appMeta.id;
            return (
              <button
                key={app.id}
                type="button"
                data-testid={`guided-app-chip-${app.id.toLowerCase()}`}
                aria-pressed={active}
                disabled={isProcessing || isLaunching}
                onClick={() => onSelectApp(app.id)}
                className={`inline-flex items-center justify-center px-2.5 py-1 min-h-[36px] rounded-full text-[11px] font-bold border transition-colors cursor-pointer disabled:opacity-50 ${
                  active
                    ? 'bg-sky-500/25 text-sky-200 border-sky-400/70'
                    : 'bg-slate-900 text-slate-400 border-slate-700 hover:text-slate-200'
                }`}
              >
                {app.label}
              </button>
            );
          })}
        </div>
      )}

      <div className="flex flex-col sm:flex-row gap-2.5 items-start min-w-0">
        {templatePreviewUrl && (
          <div className="w-full sm:w-28 shrink-0 rounded-lg overflow-hidden border border-slate-700/80 bg-slate-900 flex items-center justify-center p-1">
            <img
              src={templatePreviewUrl}
              alt="Prepared puzzle template preview"
              className="capy-guided-gemini-preview max-h-32 sm:max-h-24 w-auto object-contain rounded"
            />
          </div>
        )}

        <div className="w-full min-w-0 flex-1 rounded-lg bg-slate-900/90 border border-slate-800 p-2 max-h-28 overflow-y-auto">
          <p className="text-[11px] text-slate-300 leading-relaxed whitespace-pre-wrap break-words select-text">
            {prompt}
          </p>
        </div>
      </div>

      <button
        type="button"
        data-testid="guided-gemini-launch-btn"
        disabled={isProcessing || isLaunching}
        onClick={onLaunchGemini}
        className="w-full inline-flex items-center justify-center gap-2 px-3 py-2.5 min-h-[44px] rounded-xl bg-sky-400 hover:bg-sky-300 disabled:bg-slate-800 disabled:text-slate-500 text-slate-950 text-xs sm:text-sm font-extrabold transition-colors cursor-pointer"
      >
        {isLaunching ? (
          <Loader2 size={15} className="animate-spin shrink-0" />
        ) : isAndroid ? (
          <Share2 size={15} className="shrink-0" />
        ) : (
          <ExternalLink size={15} className="shrink-0" />
        )}
        <span className="break-words text-center">
          {isAndroid
            ? 'Copy Prompt & Share to Gemini App'
            : `Copy Prompt & Open ${appMeta.label}`}
        </span>
      </button>

      {launchStatus && (
        <p
          role="status"
          className="text-[11px] text-emerald-300 bg-emerald-500/10 border border-emerald-500/30 rounded-lg px-2.5 py-1.5 leading-snug break-words"
        >
          {launchStatus}
        </p>
      )}
    </div>
  );
};

export interface GuidedGeminiHandoffModalProps {
  isOpen: boolean;
  handoff: GuidedGeminiHandoffPackage | null;
  guidedAiApp?: GuidedAiAppId;
  onChangeGuidedAiApp?: (app: GuidedAiAppId) => void;
  fallbackReason?: string | null;
  isProcessing?: boolean;
  errorMessage?: string | null;
  onImageReceived: (input: Blob | File | string) => Promise<void> | void;
  onCancel: () => void;
}

export const GuidedGeminiHandoffModal: React.FC<GuidedGeminiHandoffModalProps> = React.memo(
  ({
    isOpen,
    handoff,
    guidedAiApp,
    onChangeGuidedAiApp,
    fallbackReason = null,
    isProcessing = false,
    errorMessage = null,
    onImageReceived,
    onCancel,
  }) => {
    const titleId = useId();
    const [localApp, setLocalApp] = useState<GuidedAiAppId>(
      () => guidedAiApp ?? handoff?.targetApp ?? 'GEMINI'
    );
    const activeApp: GuidedAiAppId = guidedAiApp ?? localApp;
    const activeAppMeta = getGuidedAiAppMeta(activeApp);
    const handleSelectApp = useCallback(
      (nextApp: GuidedAiAppId) => {
        setLocalApp(nextApp);
        onChangeGuidedAiApp?.(nextApp);
      },
      [onChangeGuidedAiApp]
    );
    const fileInputRef = useRef<HTMLInputElement | null>(null);
    const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const copiedImageTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const [templatePreviewUrl, setTemplatePreviewUrl] = useState<string>('');
    const [launchStatus, setLaunchStatus] = useState<string | null>(null);
    const [copiedOnly, setCopiedOnly] = useState<boolean>(false);
    const [copiedImage, setCopiedImage] = useState<boolean>(false);
    const [localError, setLocalError] = useState<string | null>(null);
    const [isDraggingFile, setIsDraggingFile] = useState<boolean>(false);
    const [isLaunching, setIsLaunching] = useState<boolean>(false);

    const isAndroid = NativeBridge.isAndroidNative();

    // Synchronous refs eliminate stale-closure double-submission races across paste/drop/Android share/clipboard.read.
    const isOpenRef = useRef<boolean>(isOpen);
    isOpenRef.current = isOpen;
    const isProcessingRef = useRef<boolean>(isProcessing);
    isProcessingRef.current = isProcessing;
    const handoffRef = useRef<GuidedGeminiHandoffPackage | null>(handoff);
    handoffRef.current = handoff;
    const isSubmittingRef = useRef<boolean>(false);
    const hasPendingSubmitPromiseRef = useRef<boolean>(false);
    const submitSeqRef = useRef<number>(0);
    const isReadingClipboardRef = useRef<boolean>(false);
    const pasteClipboardSeqRef = useRef<number>(0);
    const isCopyingImageRef = useRef<boolean>(false);
    const copyImageSeqRef = useRef<number>(0);
    const isLaunchingRef = useRef<boolean>(false);
    const launchSeqRef = useRef<number>(0);
    const copyPromptSeqRef = useRef<number>(0);

    useEffect(() => {
      if (!isOpen || !handoff) {
        submitSeqRef.current += 1;
        hasPendingSubmitPromiseRef.current = false;
        isSubmittingRef.current = false;
      } else if (!isProcessing && !hasPendingSubmitPromiseRef.current) {
        isSubmittingRef.current = false;
      }
    }, [isProcessing, isOpen, handoff, errorMessage]);

    // Manage object URL for template image preview and strictly revoke on change/unmount.
    useEffect(() => {
      if (!isOpen || !handoff) {
        setTemplatePreviewUrl('');
        setLaunchStatus(null);
        setCopiedOnly(false);
        setCopiedImage(false);
        setLocalError(null);
        setIsDraggingFile(false);
        copyImageSeqRef.current += 1;
        isCopyingImageRef.current = false;
        pasteClipboardSeqRef.current += 1;
        isReadingClipboardRef.current = false;
        launchSeqRef.current += 1;
        isLaunchingRef.current = false;
        setIsLaunching(false);
        copyPromptSeqRef.current += 1;
        if (copiedTimerRef.current !== null) {
          clearTimeout(copiedTimerRef.current);
          copiedTimerRef.current = null;
        }
        if (copiedImageTimerRef.current !== null) {
          clearTimeout(copiedImageTimerRef.current);
          copiedImageTimerRef.current = null;
        }
        return;
      }

      setLaunchStatus(null);
      setCopiedOnly(false);
      setCopiedImage(false);
      setLocalError(null);
      setIsLaunching(false);
      setIsDraggingFile(false);

      let createdUrl: string | null = null;
      if (
        handoff.templatePngBlob &&
        typeof URL !== 'undefined' &&
        typeof URL.createObjectURL === 'function'
      ) {
        try {
          createdUrl = URL.createObjectURL(handoff.templatePngBlob);
          setTemplatePreviewUrl(createdUrl);
        } catch {
          setTemplatePreviewUrl(handoff.templateDataUrl || '');
        }
      } else {
        setTemplatePreviewUrl(handoff.templateDataUrl || '');
      }

      return () => {
        submitSeqRef.current += 1;
        hasPendingSubmitPromiseRef.current = false;
        isSubmittingRef.current = false;
        copyImageSeqRef.current += 1;
        isCopyingImageRef.current = false;
        pasteClipboardSeqRef.current += 1;
        isReadingClipboardRef.current = false;
        launchSeqRef.current += 1;
        isLaunchingRef.current = false;
        copyPromptSeqRef.current += 1;
        if (copiedTimerRef.current !== null) {
          clearTimeout(copiedTimerRef.current);
          copiedTimerRef.current = null;
        }
        if (copiedImageTimerRef.current !== null) {
          clearTimeout(copiedImageTimerRef.current);
          copiedImageTimerRef.current = null;
        }
        if (createdUrl && typeof URL !== 'undefined' && typeof URL.revokeObjectURL === 'function') {
          try {
            URL.revokeObjectURL(createdUrl);
          } catch {
            // Ignore cleanup errors in synthetic environments
          }
        }
      };
    }, [isOpen, handoff]);

    const handleReceiveInput = useCallback(
      (input: Blob | File | string) => {
        if (!isOpenRef.current || isProcessingRef.current || isSubmittingRef.current) return;
        isSubmittingRef.current = true;
        const seq = ++submitSeqRef.current;
        setLocalError(null);
        try {
          const result = onImageReceived(input);
          if (result && typeof (result as PromiseLike<void>).then === 'function') {
            hasPendingSubmitPromiseRef.current = true;
            void Promise.resolve(result)
              .catch(() => {
                // Parent controller owns error display; always release synchronous submit lock.
              })
              .finally(() => {
                if (submitSeqRef.current === seq) {
                  hasPendingSubmitPromiseRef.current = false;
                  isSubmittingRef.current = false;
                }
              });
          } else if (submitSeqRef.current === seq && !isProcessingRef.current) {
            isSubmittingRef.current = false;
          }
        } catch {
          if (submitSeqRef.current === seq) {
            hasPendingSubmitPromiseRef.current = false;
            isSubmittingRef.current = false;
          }
        }
      },
      [onImageReceived]
    );

    // LIFO Android Back handler + capture-phase Escape & background shortcut guard + LIFO Android Shared Image interceptor + global paste listener
    useEffect(() => {
      if (!isOpen || !handoff) return;

      const popBack = NativeBridge.pushBackHandler(() => {
        if (!isProcessingRef.current) {
          onCancel();
        }
      });

      const popSharedImage = NativeBridge.pushSharedImageInterceptor((_title, dataUrl) => {
        handleReceiveInput(dataUrl);
      });

      const handleKeyDown = (e: KeyboardEvent) => {
        if (e.key === 'Escape') {
          e.stopImmediatePropagation();
          e.preventDefault();
          if (!isProcessingRef.current) {
            onCancel();
          }
          return;
        }

        const editable =
          isEditableTarget(e.target) ||
          (typeof document !== 'undefined' && isEditableTarget(document.activeElement));
        if (editable) return;

        // Defense-in-depth: block background canvas Undo/Redo & navigation shortcuts while preserving Ctrl/Cmd+C/V, Tab, Enter, Space, and text selection.
        if ((e.ctrlKey || e.metaKey) && !e.altKey) {
          const lower = e.key.toLowerCase();
          if (lower === 'z' || lower === 'y') {
            e.stopImmediatePropagation();
            e.preventDefault();
          }
          return;
        }

        if (!e.ctrlKey && !e.metaKey && !e.altKey && isBackgroundCanvasShortcutKey(e.key)) {
          e.stopImmediatePropagation();
        }
      };

      const handleWindowPaste = (e: ClipboardEvent) => {
        if (!isOpenRef.current || isProcessingRef.current || isSubmittingRef.current) return;
        const clipboardData = e.clipboardData;
        if (!clipboardData) return;

        const file = selectPreferredPasteFile(clipboardData);
        if (file) {
          e.preventDefault();
          handleReceiveInput(file);
        }
      };

      window.addEventListener('keydown', handleKeyDown, true);
      window.addEventListener('paste', handleWindowPaste);

      return () => {
        popSharedImage();
        popBack();
        window.removeEventListener('keydown', handleKeyDown, true);
        window.removeEventListener('paste', handleWindowPaste);
      };
    }, [isOpen, handoff, onCancel, handleReceiveInput]);

    const handleLaunchGemini = useCallback(async () => {
      const activeHandoff = handoffRef.current;
      if (
        !isOpenRef.current ||
        !activeHandoff ||
        isLaunchingRef.current ||
        isProcessingRef.current
      ) {
        return;
      }
      const seq = ++launchSeqRef.current;
      isLaunchingRef.current = true;
      setLocalError(null);
      setIsLaunching(true);
      try {
        const res = await launchGeminiHandoff(activeHandoff, activeApp);
        if (
          !isOpenRef.current ||
          handoffRef.current !== activeHandoff ||
          launchSeqRef.current !== seq
        ) {
          return;
        }
        const appLabel = activeAppMeta.label;
        if (isAndroid) {
          setLaunchStatus(
            res.copiedPrompt
              ? 'Prompt copied! Choose Gemini, ChatGPT, or Grok in the share sheet, paste the prompt, then share the result back to Capy.'
              : 'Template shared! Copy the prompt below, paste it in your AI app, then share the result back to Capy.'
          );
        } else {
          setLaunchStatus(
            res.copiedPrompt
              ? `Prompt copied & template saved! Attach the template image in ${appLabel}, paste the prompt, then paste or upload the result below.`
              : `Template saved & ${appLabel} opened! Copy the prompt below, attach the template image, then return the result below.`
          );
        }
      } catch {
        if (
          !isOpenRef.current ||
          handoffRef.current !== activeHandoff ||
          launchSeqRef.current !== seq
        ) {
          return;
        }
        setLocalError(
          `Could not open ${activeAppMeta.label} automatically. Copy the prompt below and upload the template image in ${activeAppMeta.label}.`
        );
      } finally {
        if (launchSeqRef.current === seq) {
          isLaunchingRef.current = false;
          if (isOpenRef.current && handoffRef.current === activeHandoff) {
            setIsLaunching(false);
          }
        }
      }
    }, [activeApp, activeAppMeta.label, isAndroid]);

    const handleCopyPromptOnly = useCallback(async () => {
      const activeHandoff = handoffRef.current;
      if (!isOpenRef.current || !activeHandoff) return;
      const seq = ++copyPromptSeqRef.current;
      setLocalError(null);
      const ok = await copyPromptToClipboard(activeHandoff.prompt);
      if (
        !isOpenRef.current ||
        handoffRef.current !== activeHandoff ||
        copyPromptSeqRef.current !== seq
      ) {
        return;
      }
      if (ok) {
        setCopiedOnly(true);
        if (copiedTimerRef.current !== null) {
          clearTimeout(copiedTimerRef.current);
        }
        copiedTimerRef.current = setTimeout(() => {
          copiedTimerRef.current = null;
          setCopiedOnly(false);
        }, 2500);
      } else {
        setLocalError('Clipboard access was blocked. Select and copy the prompt text manually.');
      }
    }, []);

    const handleCopyImage = useCallback(async () => {
      const activeHandoff = handoffRef.current;
      if (
        !isOpenRef.current ||
        !activeHandoff ||
        isProcessingRef.current ||
        isCopyingImageRef.current
      ) {
        return;
      }
      const seq = ++copyImageSeqRef.current;
      isCopyingImageRef.current = true;
      setLocalError(null);
      try {
        const ok = await copyTemplateImageToClipboard(
          activeHandoff.templatePngBlob,
          activeHandoff.templateDataUrl
        );
        if (
          !isOpenRef.current ||
          handoffRef.current !== activeHandoff ||
          copyImageSeqRef.current !== seq
        ) {
          return;
        }
        if (ok) {
          setCopiedImage(true);
          if (copiedImageTimerRef.current !== null) {
            clearTimeout(copiedImageTimerRef.current);
          }
          copiedImageTimerRef.current = setTimeout(() => {
            copiedImageTimerRef.current = null;
            setCopiedImage(false);
          }, 2500);
        } else {
          setLocalError(
            'Could not copy image to clipboard in this browser. Tap Copy Prompt & Open Gemini to download the template image instead.'
          );
        }
      } finally {
        if (copyImageSeqRef.current === seq) {
          isCopyingImageRef.current = false;
        }
      }
    }, []);

    const handlePasteClipboard = useCallback(async () => {
      const activeHandoff = handoffRef.current;
      if (
        !isOpenRef.current ||
        !activeHandoff ||
        isProcessingRef.current ||
        isSubmittingRef.current ||
        isReadingClipboardRef.current
      ) {
        return;
      }
      setLocalError(null);
      if (
        typeof navigator === 'undefined' ||
        !navigator.clipboard ||
        typeof navigator.clipboard.read !== 'function'
      ) {
        setLocalError(
          'Direct clipboard read is unavailable here. Press Ctrl+V / Cmd+V anywhere in this window, or pick an image file below.'
        );
        return;
      }
      isReadingClipboardRef.current = true;
      const seq = ++pasteClipboardSeqRef.current;
      const isReadStale = () =>
        !isOpenRef.current ||
        pasteClipboardSeqRef.current !== seq ||
        handoffRef.current !== activeHandoff ||
        isProcessingRef.current ||
        isSubmittingRef.current;
      try {
        const items = await navigator.clipboard.read();
        if (isReadStale()) return;
        const preferred = selectPreferredClipboardItemType(items);
        if (preferred) {
          const blob = await preferred.item.getType(preferred.type);
          if (isReadStale()) return;
          handleReceiveInput(blob);
          return;
        }
        if (isReadStale()) return;
        setLocalError(
          'No image was found in your clipboard yet. Copy the generated image from Gemini first, or pick a saved image file below.'
        );
      } catch {
        if (isReadStale()) return;
        setLocalError(
          'Clipboard permission was denied. Press Ctrl+V / Cmd+V to paste, or pick an image file below.'
        );
      } finally {
        if (pasteClipboardSeqRef.current === seq) {
          isReadingClipboardRef.current = false;
        }
      }
    }, [handleReceiveInput]);

    const handleFileChange = useCallback(
      (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        e.target.value = '';
        if (!file) return;
        handleReceiveInput(file);
      },
      [handleReceiveInput]
    );

    const handleDrop = useCallback(
      (e: React.DragEvent<HTMLDivElement>) => {
        e.preventDefault();
        setIsDraggingFile(false);
        if (!isOpenRef.current || isProcessingRef.current || isSubmittingRef.current) return;
        const file = e.dataTransfer?.files?.[0];
        if (!file) return;
        if (file.type && !file.type.startsWith('image/')) {
          setLocalError('Please drop a PNG, JPEG, or WebP image file.');
          return;
        }
        handleReceiveInput(file);
      },
      [handleReceiveInput]
    );

    if (!isOpen || !handoff) return null;

    const displayedError = errorMessage || localError;
    const modeLabel =
      handoff.direction === 'extend-out'
        ? 'Extend Canvas Borders'
        : 'Infill Selected Detail';

    return (
      <div
        className="fixed inset-0 z-[58] flex items-center justify-center bg-slate-950/80 backdrop-blur-sm sm:p-4"
        onClick={(e) => {
          if (e.target === e.currentTarget && !isProcessing) {
            onCancel();
          }
        }}
      >
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          data-testid="guided-gemini-modal"
          className="capy-guided-gemini-modal w-full h-full sm:h-auto sm:max-h-[90dvh] sm:max-w-lg bg-slate-900 sm:border sm:border-slate-700/80 sm:rounded-2xl shadow-2xl flex flex-col overflow-hidden text-slate-100"
        >
          {/* Sticky Header */}
          <div
            className="capy-guided-gemini-header flex items-center justify-between gap-2 px-4 py-3 border-b border-slate-800 bg-slate-950/80 shrink-0"
            style={{
              paddingTop: 'max(0.75rem, var(--sat, 0px))',
              paddingLeft: 'max(1rem, var(--sal, 0px))',
              paddingRight: 'max(1rem, var(--sar, 0px))',
            }}
          >
            <div className="flex items-center gap-2 min-w-0">
              <Sparkles size={16} className="text-sky-400 shrink-0" />
              <div className="min-w-0">
                <h2
                  id={titleId}
                  className="text-sm font-extrabold text-slate-100 truncate"
                >
                  Free Gemini App Handoff
                </h2>
                <p className="text-[11px] text-slate-400 truncate">
                  {modeLabel} • 100% Free with Gemini
                </p>
              </div>
            </div>

            <button
              type="button"
              disabled={isProcessing}
              aria-label="Close Guided Gemini Handoff"
              onClick={onCancel}
              className="capy-icon-btn inline-flex items-center justify-center min-w-[44px] min-h-[44px] p-2 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer disabled:opacity-50 shrink-0"
            >
              <X size={18} />
            </button>
          </div>

          {/* Scrollable Body */}
          <div
            className="capy-guided-gemini-body flex-1 min-h-0 overflow-y-auto overscroll-contain p-3.5 sm:p-4 space-y-3"
            style={{
              paddingLeft: 'max(0.875rem, var(--sal, 0px))',
              paddingRight: 'max(0.875rem, var(--sar, 0px))',
            }}
          >
            {fallbackReason && (
              <div
                role="status"
                data-testid="guided-gemini-fallback-notice"
                className="flex items-start gap-2 px-3 py-2 rounded-xl bg-amber-500/15 border border-amber-400/45 text-xs text-amber-200 min-w-0"
              >
                <AlertTriangle size={14} className="text-amber-300 shrink-0 mt-0.5" />
                <span className="min-w-0 break-words leading-snug">{fallbackReason}</span>
              </div>
            )}

            {/* Step 1: Template & Prompt */}
            <GuidedGeminiStep1Card
              prompt={handoff.prompt}
              templatePreviewUrl={templatePreviewUrl}
              isAndroid={isAndroid}
              selectedApp={activeApp}
              isProcessing={isProcessing}
              isLaunching={isLaunching}
              copiedOnly={copiedOnly}
              copiedImage={copiedImage}
              launchStatus={launchStatus}
              onSelectApp={handleSelectApp}
              onCopyPrompt={() => void handleCopyPromptOnly()}
              onCopyImage={() => void handleCopyImage()}
              onLaunchGemini={() => void handleLaunchGemini()}
            />

            {/* Step 2: Return Generated Image */}
            <div className="rounded-xl bg-slate-950/75 border border-slate-800 p-3 space-y-2.5 min-w-0">
              <div className="text-xs font-extrabold text-amber-300">
                Step 2 — Return Generated Image
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <button
                  type="button"
                  data-testid="guided-gemini-paste-btn"
                  disabled={isProcessing}
                  onClick={() => void handlePasteClipboard()}
                  className="inline-flex items-center justify-center gap-1.5 px-3 py-2.5 min-h-[44px] rounded-xl bg-amber-400 hover:bg-amber-300 disabled:bg-slate-800 disabled:text-slate-500 text-slate-950 text-xs font-extrabold transition-colors cursor-pointer"
                >
                  <ClipboardPaste size={15} className="shrink-0" />
                  <span className="truncate">Paste Result</span>
                </button>

                <button
                  type="button"
                  disabled={isProcessing}
                  onClick={() => fileInputRef.current?.click()}
                  className="inline-flex items-center justify-center gap-1.5 px-3 py-2.5 min-h-[44px] rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 disabled:opacity-50 text-slate-100 text-xs font-bold transition-colors cursor-pointer"
                >
                  <Upload size={15} className="shrink-0 text-sky-300" />
                  <span className="truncate">Pick Image File</span>
                </button>
              </div>

              <div
                data-testid="guided-gemini-dropzone"
                onDragOver={(e) => {
                  e.preventDefault();
                  if (!isProcessing) setIsDraggingFile(true);
                }}
                onDragLeave={() => setIsDraggingFile(false)}
                onDrop={handleDrop}
                onClick={() => {
                  if (!isProcessing) fileInputRef.current?.click();
                }}
                className={`rounded-xl border-2 border-dashed p-3 text-center transition-colors cursor-pointer min-w-0 ${
                  isDraggingFile
                    ? 'border-sky-400 bg-sky-500/15 text-sky-100'
                    : 'border-slate-700 hover:border-slate-500 bg-slate-900/60 text-slate-400'
                }`}
              >
                <div className="flex flex-col items-center justify-center gap-1">
                  {isProcessing ? (
                    <Loader2 size={18} className="animate-spin text-sky-400" />
                  ) : (
                    <ImagePlus size={18} className="text-slate-400" />
                  )}
                  <span className="text-[11px] font-semibold text-slate-300 break-words">
                    {isProcessing
                      ? 'Compositing & segmenting your artwork...'
                      : 'Drop generated PNG/WebP/JPEG here, press Ctrl+V, or tap to choose a file'}
                  </span>
                  {isAndroid && !isProcessing && (
                    <span className="text-[10px] text-slate-400 break-words">
                      On Android, you can also tap Share in Gemini and select Capy.
                    </span>
                  )}
                </div>
              </div>

              <input
                ref={fileInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                data-testid="guided-gemini-file-input"
                disabled={isProcessing}
                onChange={handleFileChange}
                className="hidden"
              />
            </div>

            {displayedError && (
              <div
                role="alert"
                data-testid="guided-gemini-error"
                className="flex items-start gap-2 px-3 py-2 rounded-xl bg-red-950/70 border border-red-500/50 text-xs text-red-200 min-w-0"
              >
                <AlertTriangle size={14} className="text-red-400 shrink-0 mt-0.5" />
                <span className="min-w-0 break-words leading-snug">{displayedError}</span>
              </div>
            )}
          </div>

          {/* Sticky Footer */}
          <div
            className="capy-guided-gemini-footer flex items-center justify-end gap-2 px-4 py-2.5 border-t border-slate-800 bg-slate-950/80 shrink-0"
            style={{
              paddingBottom: 'max(0.75rem, calc(var(--sab, 0px) + 0.5rem))',
              paddingLeft: 'max(1rem, var(--sal, 0px))',
              paddingRight: 'max(1rem, var(--sar, 0px))',
            }}
          >
            <button
              type="button"
              data-testid="guided-gemini-cancel-btn"
              disabled={isProcessing}
              onClick={onCancel}
              className="inline-flex items-center justify-center px-4 py-2 min-h-[44px] rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs font-bold text-slate-200 transition-colors cursor-pointer disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    );
  }
);
