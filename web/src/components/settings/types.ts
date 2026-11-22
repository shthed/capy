import { CloudSyncLiveStatus } from '../CloudAccountCard';
import { CoopParticipant } from '../../services/providers/types';
import { PlayerLifetimeStats } from '../../services/PlayerStatsService';
import { GeneratorConfig, SampleArtwork, SavedSnapshot, UserSettings } from '../../types';

export type SettingsTabId = 0 | 1 | 2 | 3 | 4;

export interface CloudSyncSummaryPayload {
  addedFromCloud: number;
  syncedAt: number;
  uploadedCount?: number;
  downloadedCount?: number;
  backend?: string;
}

export interface SettingsNavigationProps {
  initialTab?: number;
  initialTabRequestKey?: number;
  hasDockedTutorial?: boolean;
  onStartTutorial?: () => void;
  onStartTour?: () => void;
  onTabOpened?: (tabId: number) => void;
  onExplorePresetGallery?: () => void;
}

export interface SettingsPreferencesProps {
  settings: UserSettings;
  isFullscreen?: boolean;
  onUpdateSettings: (newSettings: UserSettings) => void;
  onToggleFullscreen?: () => void;
}

export interface SettingsAboutProps {
  lifetimeStats?: PlayerLifetimeStats;
  showCloudCoopUi?: boolean;
}

export interface SettingsCreateProps {
  sourceImage?: HTMLImageElement | null;
  onRegenerate: (config: GeneratorConfig) => void;
  onSelectSample: (
    sample: SampleArtwork,
    config?: GeneratorConfig,
    prebakedSnapshotId?: string
  ) => void;
  onUploadImage: () => void;
  onZoomIntoDetailTile?: () => void;
}

export interface SettingsSavesProps {
  snapshots: SavedSnapshot[];
  activeSnapshotId: string | null;
  onLoadSnapshot: (snapshot: SavedSnapshot) => void;
  onReplaySnapshot?: (snapshot: SavedSnapshot) => void;
  onRenameSnapshot: (id: string, newTitle: string) => void;
  onTogglePinSnapshot?: (id: string) => void;
  onDeleteSnapshot: (id: string) => void;
  onClearAllSnapshots: () => void;
  onAfterStorageClear?: (opts: {
    clearedActiveChannel: boolean;
    clearedSettings?: boolean;
  }) => Promise<void> | void;
  onResetProgress?: () => void;
  onExportSnapshot?: (id: string, title: string) => void;
  onExportSnapshotSvg?: (id: string, title: string) => Promise<boolean> | void;
  onExportAllSnapshots?: () => void;
  onImportSnapshots?: (
    file: File
  ) => Promise<{ ok: boolean; importedCount: number; message: string } | void> | void;
  onRestoreStarterSample?: () => void;
}

export interface SettingsCloudCoopProps {
  showCloudCoopUi?: boolean;
  coopRoomCode?: string | null;
  coopParticipants?: CoopParticipant[];
  canShareActiveLink?: boolean;
  cloudSyncStatus?: CloudSyncLiveStatus;
  lastCloudSyncError?: string | null;
  onHostCoopRoom?: () => Promise<string | null>;
  onJoinCoopRoom?: (code: string) => Promise<boolean>;
  onLeaveCoopRoom?: () => void;
  onShareProgressLink?: () => Promise<string | null>;
  onCopyCoopInviteLink?: () => Promise<string | null>;
  onExportPrintableSvg?: () => Promise<boolean> | void;
  onSyncCloudProgress?: () => Promise<CloudSyncSummaryPayload | null>;
}

export interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  navigation?: SettingsNavigationProps;
  preferences: SettingsPreferencesProps;
  about?: SettingsAboutProps;
  create: SettingsCreateProps;
  saves: SettingsSavesProps;
  cloudCoop?: SettingsCloudCoopProps;
}
