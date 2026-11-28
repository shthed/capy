export {
  resolveScopedBackupKey,
  resolveScopedDbName,
  resolveScopedStorageKey,
} from '../StorageNamespace';

export const SETTINGS_KEY = 'capy_user_settings_v8';
export const UNDO_DEFAULT_MIGRATED_KEY = 'capy_undo_default_migrated_v1';
export const SNAPSHOTS_KEY = 'capy_snapshots_v8';
export const ACTIVE_STATE_KEY = 'capy_active_session_v8';

export const TUTORIAL_COMPLETED_KEY = 'capy_tutorial_completed_v1';
export const LAST_SETTINGS_TAB_KEY = 'capy_last_settings_tab';
export const SAVES_VIEW_MODE_KEY = 'capy_saves_view_mode';
export const FEATURE_OFFERS_KEY = 'capy_feature_offers_v1';
export const PLAYER_STATS_STORAGE_KEY = 'capy_player_stats_v1';

export const APPLE_CLIENT_ID_STORAGE_KEY = 'capy_apple_client_id_v1';
export const APPLE_CLOUDKIT_CONTAINER_STORAGE_KEY = 'capy_apple_cloudkit_container_v1';
export const APPLE_CLOUDKIT_API_TOKEN_STORAGE_KEY = 'capy_apple_cloudkit_api_token_v1';
export const APPLE_SESSION_STORAGE_KEY = 'capy_apple_cloud_session_v1';

export const GOOGLE_CLIENT_ID_STORAGE_KEY = 'capy_google_oauth_client_id_v1';
export const GOOGLE_TOKEN_STORAGE_KEY = 'capy_google_oauth_token_v1';
export const EXPLICIT_SIGNOUT_STORAGE_KEY = 'capy_cloud_explicit_signout_v1';

export const MICROSOFT_CLIENT_ID_STORAGE_KEY = 'capy_microsoft_oauth_client_id_v1';
export const MICROSOFT_TOKEN_STORAGE_KEY = 'capy_microsoft_oauth_token_v1';

export const IDENTITY_STORAGE_KEY = 'capy_player_identity_v1';
export const CLOUD_VAULT_STORAGE_KEY = 'capy_cloud_vault_v1';
export const CLOUD_MANIFEST_STORAGE_KEY = 'capy_cloud_library_manifest_v2';
export const CLOUD_TOMBSTONES_STORAGE_KEY = 'capy_cloud_tombstones_v1';
export const TAB_SESSION_SUFFIX_KEY = 'capy_tab_peer_suffix_v1';
export const COMMUNITY_IDEAS_STORAGE_KEY = 'capy_community_ideas_v1';
export const AI_CREDITS_STORAGE_KEY = 'capy_ai_credits_v1';
export const GEMINI_BYOK_KEY_STORAGE_KEY = 'capy_gemini_byok_key_v1';
export const OPENROUTER_BYOK_KEY_STORAGE_KEY = 'capy_openrouter_byok_key_v1';
export const OPENAI_BYOK_KEY_STORAGE_KEY = 'capy_openai_byok_key_v1';
export const XAI_BYOK_KEY_STORAGE_KEY = 'capy_xai_byok_key_v1';

export const STORAGE_KEYS = {
  SETTINGS: SETTINGS_KEY,
  UNDO_DEFAULT_MIGRATED: UNDO_DEFAULT_MIGRATED_KEY,
  SNAPSHOTS: SNAPSHOTS_KEY,
  ACTIVE_STATE: ACTIVE_STATE_KEY,
  TUTORIAL_COMPLETED: TUTORIAL_COMPLETED_KEY,
  LAST_SETTINGS_TAB: LAST_SETTINGS_TAB_KEY,
  SAVES_VIEW_MODE: SAVES_VIEW_MODE_KEY,
  FEATURE_OFFERS: FEATURE_OFFERS_KEY,
  PLAYER_STATS: PLAYER_STATS_STORAGE_KEY,
  APPLE_CLIENT_ID: APPLE_CLIENT_ID_STORAGE_KEY,
  APPLE_CLOUDKIT_CONTAINER: APPLE_CLOUDKIT_CONTAINER_STORAGE_KEY,
  APPLE_CLOUDKIT_API_TOKEN: APPLE_CLOUDKIT_API_TOKEN_STORAGE_KEY,
  APPLE_SESSION: APPLE_SESSION_STORAGE_KEY,
  GOOGLE_CLIENT_ID: GOOGLE_CLIENT_ID_STORAGE_KEY,
  GOOGLE_TOKEN: GOOGLE_TOKEN_STORAGE_KEY,
  EXPLICIT_SIGNOUT: EXPLICIT_SIGNOUT_STORAGE_KEY,
  MICROSOFT_CLIENT_ID: MICROSOFT_CLIENT_ID_STORAGE_KEY,
  MICROSOFT_TOKEN: MICROSOFT_TOKEN_STORAGE_KEY,
  PLAYER_IDENTITY: IDENTITY_STORAGE_KEY,
  CLOUD_VAULT: CLOUD_VAULT_STORAGE_KEY,
  CLOUD_MANIFEST: CLOUD_MANIFEST_STORAGE_KEY,
  CLOUD_TOMBSTONES: CLOUD_TOMBSTONES_STORAGE_KEY,
  COMMUNITY_IDEAS: COMMUNITY_IDEAS_STORAGE_KEY,
  AI_CREDITS: AI_CREDITS_STORAGE_KEY,
  GEMINI_BYOK_KEY: GEMINI_BYOK_KEY_STORAGE_KEY,
  OPENROUTER_BYOK_KEY: OPENROUTER_BYOK_KEY_STORAGE_KEY,
  OPENAI_BYOK_KEY: OPENAI_BYOK_KEY_STORAGE_KEY,
  XAI_BYOK_KEY: XAI_BYOK_KEY_STORAGE_KEY,
} as const;

export const DB_VERSION = 1;
export const STORE_PUZZLES = 'puzzles';
export const STORE_IMAGES = 'images';

export const LAYER_IMAGE_KEY_PREFIX = 'layer_';
export const PREVIEW_IMAGE_KEY_PREFIX = 'preview_';

export function isLayerImageKey(key: string): boolean {
  return key.startsWith(LAYER_IMAGE_KEY_PREFIX) && key.length > LAYER_IMAGE_KEY_PREFIX.length;
}

export function isPreviewImageKey(key: string): boolean {
  return key.startsWith(PREVIEW_IMAGE_KEY_PREFIX) && key.length > PREVIEW_IMAGE_KEY_PREFIX.length;
}

export function buildCanonicalLayerImageKey(snapshotId: string, layerId: string): string {
  return `${LAYER_IMAGE_KEY_PREFIX}${snapshotId}_${layerId}`;
}

export function matchesScopedKey(candidateKey: string, baseKey: string): boolean {
  return candidateKey === baseKey || candidateKey.startsWith(`${baseKey}__`);
}
