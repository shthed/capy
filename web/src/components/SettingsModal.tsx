import React, { useEffect, useId, useRef, useState } from 'react';
import { SafeLocalStore } from '../services/storage/SafeLocalStore';
import { LAST_SETTINGS_TAB_KEY } from '../services/storage/StorageKeys';
import { GeneratorConfig } from '../types';
import { BrowserStorageModal } from './BrowserStorageModal';
import { AboutTab } from './settings/AboutTab';
import { CreateTab } from './settings/CreateTab';
import { HintsTab } from './settings/HintsTab';
import { SavesTab } from './settings/SavesTab';
import { SettingsTab } from './settings/SettingsTab';
import { SettingsTabBar } from './settings/SettingsTabBar';
import { SettingsModalProps } from './settings/types';

export type { SettingsModalProps } from './settings/types';

function readStoredSettingsTab(): number | null {
  const saved = SafeLocalStore.getScopedItem(LAST_SETTINGS_TAB_KEY);
  if (saved === null) return null;
  const parsed = parseInt(saved, 10);
  return !isNaN(parsed) && parsed >= 0 && parsed <= 4 ? parsed : null;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  onClose,
  navigation,
  preferences,
  about,
  create,
  saves,
  cloudCoop,
}) => {
  const {
    initialTab,
    initialTabRequestKey,
    hasDockedTutorial = false,
    onStartTutorial,
    onStartTour,
    onTabOpened,
    onExplorePresetGallery,
  } = navigation ?? {};

  const { settings, isFullscreen, onUpdateSettings, onToggleFullscreen } = preferences;
  const dialogTitleId = useId();
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);
  const prevIsOpenRef = useRef<boolean>(false);
  const cancelRenameRef = useRef<(() => boolean) | null>(null);
  const onTabOpenedRef = useRef(onTabOpened);
  onTabOpenedRef.current = onTabOpened;

  const [activeTab, setActiveTab] = useState<number>(
    () => initialTab ?? readStoredSettingsTab() ?? 1
  );
  const [localConfig, setLocalConfig] = useState<GeneratorConfig>(settings.generatorConfig);
  const [isStorageAnalyzerOpen, setIsStorageAnalyzerOpen] = useState(false);

  // Resync unsaved Create config and capture/restore keyboard focus across open/close transitions
  useEffect(() => {
    if (isOpen && !prevIsOpenRef.current) {
      setLocalConfig(settings.generatorConfig);
      previouslyFocusedRef.current =
        document.activeElement instanceof HTMLElement ? document.activeElement : null;
      requestAnimationFrame(() => {
        if (dialogRef.current && !dialogRef.current.contains(document.activeElement)) {
          dialogRef.current.focus();
        }
      });
    } else if (!isOpen && prevIsOpenRef.current) {
      const prevEl = previouslyFocusedRef.current;
      previouslyFocusedRef.current = null;
      if (prevEl && prevEl.isConnected) {
        prevEl.focus();
      }
    }
    prevIsOpenRef.current = isOpen;
  }, [isOpen, settings.generatorConfig]);

  // Sync activeTab when modal opens with explicit initialTab or restore last active
  useEffect(() => {
    if (!isOpen) return;
    let resolvedTab = activeTab;
    if (initialTab !== undefined) {
      resolvedTab = initialTab;
      setActiveTab(initialTab);
      SafeLocalStore.setScopedItem(LAST_SETTINGS_TAB_KEY, String(initialTab));
    } else {
      const stored = readStoredSettingsTab();
      if (stored !== null) {
        resolvedTab = stored;
        setActiveTab(stored);
      }
    }
    onTabOpenedRef.current?.(resolvedTab);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, initialTab, initialTabRequestKey]);

  // Reset sub-modal when Settings closes or active tab changes away from Saves
  useEffect(() => {
    if (!isOpen || activeTab !== 4) {
      setIsStorageAnalyzerOpen(false);
    }
  }, [isOpen, activeTab]);

  // Close on Escape key (BrowserStorageModal owns Escape when open; otherwise cancel inline rename first)
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (isStorageAnalyzerOpen) return;
      if (cancelRenameRef.current?.()) return;
      onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, isStorageAnalyzerOpen, onClose]);

  if (!isOpen) return null;

  const handleSelectTab = (tabId: number) => {
    setActiveTab(tabId);
    onTabOpenedRef.current?.(tabId);
    SafeLocalStore.setScopedItem(LAST_SETTINGS_TAB_KEY, String(tabId));
  };

  return (
    <>
      <div
        onClick={(e) => {
          if (e.target === e.currentTarget) {
            onClose();
          }
        }}
        className="fixed inset-0 z-50 flex sm:items-center sm:justify-center sm:p-4 md:p-6 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200 select-none cursor-pointer sm:cursor-default"
      >
        <div
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby={dialogTitleId}
          tabIndex={-1}
          onClick={(e) => e.stopPropagation()}
          className="relative w-full h-full sm:h-[88vh] sm:max-h-[860px] sm:max-w-2xl md:max-w-3xl flex flex-col bg-slate-900 sm:border sm:border-slate-800 sm:rounded-2xl shadow-2xl overflow-hidden text-slate-100 cursor-auto outline-none"
        >
          <h2 id={dialogTitleId} className="sr-only">
            Settings and Menu
          </h2>

          <SettingsTabBar
            activeTab={activeTab}
            onSelectTab={handleSelectTab}
            onStartTour={onStartTour}
            onStartTutorial={onStartTutorial}
            onClose={onClose}
          />

          {/* Tab Contents */}
          <div
            className="flex-1 overflow-y-auto p-3.5 sm:p-5 space-y-4 sm:space-y-5"
            style={{
              paddingBottom: hasDockedTutorial
                ? 'max(calc(13rem * max(1, var(--capy-text-scale, 1), var(--capy-ui-scale, 1))), calc(var(--sab, 0px) + 12rem * max(1, var(--capy-text-scale, 1), var(--capy-ui-scale, 1))))'
                : 'max(2.5rem, calc(var(--sab, 0px) + 1.75rem))',
              paddingLeft: 'max(0.875rem, calc(var(--sal, 0px) + 0.75rem))',
              paddingRight: 'max(0.875rem, calc(var(--sar, 0px) + 0.75rem))',
            }}
          >
            {activeTab === 0 && (
              <AboutTab
                lifetimeStats={about?.lifetimeStats}
                showCloudCoopUi={about?.showCloudCoopUi ?? cloudCoop?.showCloudCoopUi}
                onStartTutorial={onStartTutorial}
                onClose={onClose}
              />
            )}
            {activeTab === 1 && (
              <SettingsTab
                settings={settings}
                isFullscreen={isFullscreen}
                onUpdateSettings={onUpdateSettings}
                onToggleFullscreen={onToggleFullscreen}
              />
            )}
            {activeTab === 2 && (
              <HintsTab settings={settings} onUpdateSettings={onUpdateSettings} />
            )}
            {activeTab === 3 && (
              <CreateTab
                settings={settings}
                localConfig={localConfig}
                setLocalConfig={setLocalConfig}
                sourceImage={create.sourceImage}
                onUpdateSettings={onUpdateSettings}
                onRegenerate={create.onRegenerate}
                onSelectSample={create.onSelectSample}
                onUploadImage={create.onUploadImage}
                onZoomIntoDetailTile={create.onZoomIntoDetailTile}
                isInfiniteZoomDisabled={create.isInfiniteZoomDisabled}
                infiniteZoomDisabledReason={create.infiniteZoomDisabledReason}
                onStartInfiniteZoomIn={create.onStartInfiniteZoomIn}
                onStartInfiniteZoomOut={create.onStartInfiniteZoomOut}
                onExplorePresetGallery={onExplorePresetGallery}
                onClose={onClose}
              />
            )}
            {activeTab === 4 && (
              <SavesTab
                settings={settings}
                onUpdateSettings={onUpdateSettings}
                saves={saves}
                cloudCoop={cloudCoop}
                onOpenStorageAnalyzer={() => setIsStorageAnalyzerOpen(true)}
                cancelRenameRef={cancelRenameRef}
                onClose={onClose}
              />
            )}
          </div>
        </div>
      </div>

      <BrowserStorageModal
        isOpen={isStorageAnalyzerOpen}
        onClose={() => setIsStorageAnalyzerOpen(false)}
        onAfterStorageClear={saves.onAfterStorageClear}
      />
    </>
  );
};
