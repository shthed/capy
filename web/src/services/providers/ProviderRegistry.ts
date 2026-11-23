import { MultiProviderAuthManager } from '../auth/AuthManager';
import {
  DefaultAiArtworkAdapter,
  NoOpMonetizationAdapter,
  StaticAndCommunityCatalogAdapter,
} from '../catalog/CatalogIdeasService';
import { CloudLibrarySyncOrchestrator } from '../cloud/CloudLibrarySyncOrchestrator';
import { HybridCoopRoomClient, LocationLike } from '../coop/HybridCoopRoomClient';

export {
  COLLABORATOR_AVATAR_COLORS,
  MultiProviderAuthManager,
  MultiProviderAuthManager as AuthManager,
} from '../auth/AuthManager';
export {
  CatalogIdeasService,
  ConsentRewardedAdAdapter,
  DefaultAiArtworkAdapter,
  NoOpMonetizationAdapter,
  StaticAndCommunityCatalogAdapter,
} from '../catalog/CatalogIdeasService';
export {
  CloudLibrarySyncOrchestrator,
  computeSnapshotContentFingerprint,
  CrdtCloudSaveAdapter,
  mapProviderToBackendKind,
} from '../cloud/CloudLibrarySyncOrchestrator';
export { computeSlotKeyForSnapshot } from '../cloud/slotKey';
export {
  CHANNEL_PEER_STALE_MS,
  computeCoopReconnectDelayMs,
  HybridCoopRoomAdapter,
  HybridCoopRoomClient,
  MAX_COOP_PARTICIPANTS,
  resolveCoopBroadcastChannelName,
  resolveCoopRoomWsUrl,
  WS_PEER_STALE_MS,
} from '../coop/HybridCoopRoomClient';
export type { LocationLike };
export type { AiArtworkProvider, AiCreditLedger } from './types';

// ---------------------------------------------------------------------------
// Singleton Provider Registry Facade
// ---------------------------------------------------------------------------

const auth = new MultiProviderAuthManager();
const cloudSave = new CloudLibrarySyncOrchestrator(auth);
auth.onSignOut((previousIdentity) => {
  cloudSave.clearLocalCloudCache(previousIdentity);
});

const realtimeRoom = new HybridCoopRoomClient();
const catalog = new StaticAndCommunityCatalogAdapter();
const aiArtwork = new DefaultAiArtworkAdapter();
const monetization = new NoOpMonetizationAdapter();

export const ProviderRegistry = {
  auth,
  cloudSave,
  realtimeRoom,
  catalog,
  aiArtwork,
  monetization,
};
