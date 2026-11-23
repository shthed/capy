import {
  Dispatch,
  MutableRefObject,
  SetStateAction,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  GeneratorConfig,
  PuzzleData,
  PuzzleSourceRef,
  Region,
  SampleArtwork,
  SavedSnapshot,
  UserSettings,
} from '../types';
import { StorageService } from '../services/StorageService';
import { NativeBridge } from '../services/NativeBridge';
import { reportSwallowed } from '../services/telemetry';
import {
  decodeProgressDeltaToken,
  encodeProgressDeltaToken,
  isAllowedSampleAssetPath,
  mergeProgressDeltas,
  ProgressDeltaV2,
} from '../services/CapyCodec';
import {
  buildShareProgressUrl,
  clearShareHashFromWindowUrl,
  generateCoopRoomCode,
  normalizeCoopRoomCode,
  parseShareLinkFromUrl,
  resolveSampleFromSourceRef,
} from '../services/ShareLinkService';
import {
  AuthProvider,
  CoopPaintEvent,
  CoopParticipant,
  CoopUnfillEvent,
  RealtimeRoomProvider,
} from '../services/providers/types';
import { useAuthProvider, useRealtimeRoomProvider } from '../context/ProviderContext';
import { CoopRippleBuffer } from '../engine/CoopRippleBuffer';
import { getVisiblePalette } from '../components/PaletteDock';
import { TutorialStepKey } from '../components/OnboardingTutorial';
import {
  buildUnifiedRegionIndex,
  getAllPuzzleRegions,
  getTotalRegionCount,
  UnifiedRegionRef,
} from '../engine/UnifiedPuzzleLayers';
import { useLatest } from './useLatest';

export interface CoopViewport {
  zoomScale: number;
  panOffsetX: number;
  panOffsetY: number;
}

export interface CoopLiveState {
  puzzle: PuzzleData | null;
  activeSnapshotId: string | null;
  activeSave: SavedSnapshot | undefined;
  activeTitle: string;
  filledRegionIds: Set<number>;
  paintedRegionColors: Map<number, number>;
  isFreeColorMode: boolean;
  activeColorId: number;
  settings: UserSettings;
}

export type CoopLoadSampleFn = (
  sample: SampleArtwork,
  seedFilledIds?: number[],
  seedPaintedColors?: Record<number, number>,
  seedFreeColor?: boolean,
  forceGeneratorConfig?: GeneratorConfig,
  seedResetEpoch?: number
) => Promise<void>;

export interface CoopRipplePoint {
  x: number;
  y: number;
  colorHex: string;
}

export interface CoopPaintTransitionResult {
  nextFilled: Set<number>;
  nextPainted: Map<number, number>;
  changed: boolean;
  ripples: CoopRipplePoint[];
}

export interface CoopUnfillTransitionResult {
  nextFilled: Set<number>;
  nextPainted: Map<number, number>;
  nextActiveColorId: number;
  changed: boolean;
  ripple: CoopRipplePoint | null;
}

export interface CoopWelcomeMergeResult {
  nextFilled: Set<number>;
  nextPainted: Map<number, number>;
  mergedEpoch: number;
  epochAdvanced: boolean;
  stateChanged: boolean;
  nextActiveColorId: number;
  shouldUpdateActiveColor: boolean;
}

export function resolveActiveSourceRefFields(
  sampleAssetPath: string | null | undefined,
  sourceRefKind: PuzzleSourceRef['kind'] | undefined,
  sourceRefUri: string | undefined
): PuzzleSourceRef | undefined {
  if (isAllowedSampleAssetPath(sampleAssetPath)) {
    return { kind: 'sample', uri: sampleAssetPath };
  }
  if (sourceRefKind === 'sample' && isAllowedSampleAssetPath(sourceRefUri)) {
    return { kind: 'sample', uri: sourceRefUri };
  }
  if (sourceRefKind === 'catalog' && sourceRefUri) {
    return { kind: 'catalog', uri: sourceRefUri };
  }
  return undefined;
}

export function resolveActiveSourceRef(
  activeSave: Pick<SavedSnapshot, 'sampleAssetPath' | 'sourceRef'> | undefined
): PuzzleSourceRef | undefined {
  return resolveActiveSourceRefFields(
    activeSave?.sampleAssetPath,
    activeSave?.sourceRef?.kind,
    activeSave?.sourceRef?.uri
  );
}

export function resolveSeedSampleUri(
  activeSave: Pick<SavedSnapshot, 'sampleAssetPath' | 'sourceRef'> | undefined
): string | undefined {
  if (isAllowedSampleAssetPath(activeSave?.sampleAssetPath)) {
    return activeSave.sampleAssetPath;
  }
  if (
    activeSave?.sourceRef?.kind === 'sample' &&
    isAllowedSampleAssetPath(activeSave.sourceRef.uri)
  ) {
    return activeSave.sourceRef.uri;
  }
  return undefined;
}

export function shouldBroadcastWelcomeOnSeedUpdate(
  prevSnapshotId: string | null,
  nextSnapshotId: string | null,
  prevResetEpoch: number,
  nextResetEpoch: number
): boolean {
  return (
    (prevSnapshotId !== null && prevSnapshotId !== nextSnapshotId) ||
    nextResetEpoch > prevResetEpoch
  );
}

export function buildCoopProgressDelta(params: {
  sourceRef?: PuzzleSourceRef;
  filledRegionIds: Iterable<number>;
  paintedRegionColors: Map<number, number>;
  isFreeColorMode: boolean;
  resetEpoch: number;
  updatedAt?: number;
}): ProgressDeltaV2 {
  const paintedObj =
    params.paintedRegionColors.size > 0
      ? Object.fromEntries(params.paintedRegionColors)
      : undefined;
  return {
    version: 2,
    ...(params.sourceRef ? { sourceRef: params.sourceRef } : {}),
    filledRegionIds: Array.from(params.filledRegionIds),
    ...(paintedObj ? { paintedRegionColors: paintedObj } : {}),
    ...(params.isFreeColorMode ? { isFreeColor: true } : {}),
    ...(params.resetEpoch > 0 ? { resetEpoch: params.resetEpoch } : {}),
    updatedAt: params.updatedAt ?? Date.now(),
  };
}

interface ResolvedCoopRegion {
  region: Region;
  worldCentroidX: number;
  worldCentroidY: number;
}

function resolveEffectiveWorldById(
  puzzle: PuzzleData,
  worldById?: Map<number, UnifiedRegionRef> | null
): Map<number, UnifiedRegionRef> | null {
  if (worldById) return worldById;
  if (puzzle.nestedLayers && puzzle.nestedLayers.length > 0) {
    return buildUnifiedRegionIndex(puzzle).worldById;
  }
  return null;
}

function lookupCoopRegion(
  puzzle: PuzzleData,
  regionId: number,
  currentPuzzle?: PuzzleData | null,
  regionById?: Map<number, Region>,
  effectiveWorldById?: Map<number, UnifiedRegionRef> | null
): ResolvedCoopRegion | undefined {
  if (effectiveWorldById) {
    const ref = effectiveWorldById.get(regionId);
    if (ref) {
      return {
        region: ref.region,
        worldCentroidX: ref.worldCentroidX,
        worldCentroidY: ref.worldCentroidY,
      };
    }
    return undefined;
  }
  const reg =
    currentPuzzle && puzzle === currentPuzzle && regionById
      ? regionById.get(regionId)
      : puzzle.regions.find((r) => r.id === regionId);
  return reg
    ? { region: reg, worldCentroidX: reg.centroidX, worldCentroidY: reg.centroidY }
    : undefined;
}

export function applyCoopPaintEvent(params: {
  event: CoopPaintEvent;
  puzzle: PuzzleData | null;
  currentPuzzle?: PuzzleData | null;
  regionById?: Map<number, Region>;
  worldById?: Map<number, UnifiedRegionRef> | null;
  filledRegionIds: Set<number>;
  paintedRegionColors: Map<number, number>;
}): CoopPaintTransitionResult | null {
  const {
    event,
    puzzle,
    currentPuzzle,
    regionById,
    worldById,
    filledRegionIds,
    paintedRegionColors,
  } = params;
  if (!puzzle) return null;

  const nextFilled = new Set(filledRegionIds);
  const nextPainted = new Map(paintedRegionColors);
  const ripples: CoopRipplePoint[] = [];
  let changed = false;

  if (event.action === 'FILL') {
    const effectiveWorldById = resolveEffectiveWorldById(puzzle, worldById);
    for (const rId of event.regionIds) {
      const resolved = lookupCoopRegion(puzzle, rId, currentPuzzle, regionById, effectiveWorldById);
      if (!resolved) continue;
      if (!nextFilled.has(rId)) {
        nextFilled.add(rId);
        changed = true;
      }
      if (event.paintedColors && event.paintedColors[rId] !== undefined) {
        if (nextPainted.get(rId) !== event.paintedColors[rId]) {
          nextPainted.set(rId, event.paintedColors[rId]);
          changed = true;
        }
      }
      ripples.push({
        x: resolved.worldCentroidX,
        y: resolved.worldCentroidY,
        colorHex: event.avatarColorHex,
      });
    }
  } else if (event.action === 'UNFILL') {
    for (const rId of event.regionIds) {
      if (nextFilled.has(rId)) {
        nextFilled.delete(rId);
        nextPainted.delete(rId);
        changed = true;
      }
    }
  }

  return { nextFilled, nextPainted, changed, ripples };
}

export function applyCoopUnfillEvent(params: {
  event: CoopUnfillEvent;
  localPeerId: string;
  puzzle: PuzzleData | null;
  currentPuzzle?: PuzzleData | null;
  regionById?: Map<number, Region>;
  worldById?: Map<number, UnifiedRegionRef> | null;
  filledRegionIds: Set<number>;
  paintedRegionColors: Map<number, number>;
  activeColorId: number;
}): CoopUnfillTransitionResult | null {
  const {
    event,
    localPeerId,
    puzzle,
    currentPuzzle,
    regionById,
    worldById,
    filledRegionIds,
    paintedRegionColors,
    activeColorId,
  } = params;

  if ((event.senderId || event.playerId) === localPeerId) return null;
  if (!puzzle) return null;

  const targetIds =
    event.regionIds && event.regionIds.length > 0
      ? event.regionIds
      : event.regionId !== undefined
        ? [event.regionId]
        : [];
  if (targetIds.length === 0) return null;

  const nextFilled = new Set(filledRegionIds);
  const nextPainted = new Map(paintedRegionColors);
  let changed = false;
  let firstUnfilledColorId: number | null = null;
  let ripple: CoopRipplePoint | null = null;
  const effectiveWorldById = resolveEffectiveWorldById(puzzle, worldById);

  for (const rId of targetIds) {
    if (!nextFilled.has(rId)) continue;
    nextFilled.delete(rId);
    nextPainted.delete(rId);
    changed = true;
    if (firstUnfilledColorId === null) {
      const resolved = lookupCoopRegion(puzzle, rId, currentPuzzle, regionById, effectiveWorldById);
      if (resolved) {
        firstUnfilledColorId = resolved.region.colorId;
        ripple = {
          x: resolved.worldCentroidX,
          y: resolved.worldCentroidY,
          colorHex: event.avatarColorHex,
        };
      }
    }
  }

  if (!changed) return null;

  const totalRegionCount = getTotalRegionCount(puzzle);
  const wasCompleted = totalRegionCount > 0 && filledRegionIds.size >= totalRegionCount;
  const nextActiveColorId =
    (wasCompleted || activeColorId === 0) && firstUnfilledColorId !== null
      ? firstUnfilledColorId
      : activeColorId;

  return { nextFilled, nextPainted, nextActiveColorId, changed: true, ripple };
}

function hasProgressStateChanged(
  epochAdvanced: boolean,
  prevFilled: Set<number>,
  nextFilled: Set<number>,
  prevPainted: Map<number, number>,
  nextPainted: Map<number, number>
): boolean {
  if (epochAdvanced || nextFilled.size !== prevFilled.size) return true;
  for (const rId of nextFilled) {
    if (!prevFilled.has(rId)) return true;
  }
  if (nextPainted.size !== prevPainted.size) return true;
  for (const [rId, col] of nextPainted) {
    if (prevPainted.get(rId) !== col) return true;
  }
  return false;
}

export function applyCoopWelcomeMerge(params: {
  delta: ProgressDeltaV2;
  puzzle: PuzzleData;
  activeSave?: Pick<SavedSnapshot, 'resetEpoch'>;
  filledRegionIds: Set<number>;
  paintedRegionColors: Map<number, number>;
  isFreeColorMode: boolean;
  activeColorId: number;
  paletteSort: UserSettings['paletteSort'];
  now?: number;
}): CoopWelcomeMergeResult {
  const {
    delta,
    puzzle,
    activeSave,
    filledRegionIds,
    paintedRegionColors,
    isFreeColorMode,
    activeColorId,
    paletteSort,
    now,
  } = params;

  const allRegions = getAllPuzzleRegions(puzzle);
  const totalRegionCount = getTotalRegionCount(puzzle);
  const validIds = new Set(allRegions.map((r) => r.id));
  const localEpoch = activeSave?.resetEpoch ?? 0;
  const localDelta = buildCoopProgressDelta({
    filledRegionIds,
    paintedRegionColors,
    isFreeColorMode,
    resetEpoch: localEpoch,
    updatedAt: now,
  });

  const mergedWelcome = mergeProgressDeltas(localDelta, delta);
  const mergedEpoch = mergedWelcome.resetEpoch ?? 0;
  const epochAdvanced = mergedEpoch > localEpoch;

  const nextFilled = new Set<number>();
  for (const rId of mergedWelcome.filledRegionIds) {
    if (validIds.has(rId)) nextFilled.add(rId);
  }
  const nextPainted = new Map<number, number>();
  if (mergedWelcome.paintedRegionColors) {
    for (const [k, v] of Object.entries(mergedWelcome.paintedRegionColors)) {
      const numK = Number(k);
      if (validIds.has(numK)) nextPainted.set(numK, v);
    }
  }

  const stateChanged = hasProgressStateChanged(
    epochAdvanced,
    filledRegionIds,
    nextFilled,
    paintedRegionColors,
    nextPainted
  );

  let nextActiveColorId = activeColorId;
  let shouldUpdateActiveColor = false;
  if (stateChanged && !isFreeColorMode && nextFilled.size < totalRegionCount) {
    const curStillAvailable = allRegions.some(
      (r) => r.colorId === activeColorId && !nextFilled.has(r.id)
    );
    if (!curStillAvailable) {
      const fallback = getVisiblePalette(
        puzzle.palette,
        allRegions,
        nextFilled,
        paletteSort
      )[0];
      if (fallback) {
        nextActiveColorId = fallback.id;
        shouldUpdateActiveColor = true;
      }
    }
  }

  return {
    nextFilled,
    nextPainted,
    mergedEpoch,
    epochAdvanced,
    stateChanged,
    nextActiveColorId,
    shouldUpdateActiveColor,
  };
}

export function emitCoopPaintToRoom(
  realtimeRoom: Pick<RealtimeRoomProvider, 'activeRoomCode' | 'broadcastPaintEvent'>,
  auth: Pick<AuthProvider, 'getCurrentIdentity'>,
  action: 'FILL' | 'UNFILL',
  regionIds: number[],
  paintedColors?: Record<number, number>
): boolean {
  const room = realtimeRoom.activeRoomCode;
  if (!room || regionIds.length === 0) return false;
  const identity = auth.getCurrentIdentity();
  realtimeRoom.broadcastPaintEvent({
    eventId: `${identity.playerId}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    roomCode: room,
    playerId: identity.playerId,
    displayName: identity.displayName,
    avatarColorHex: identity.avatarColorHex,
    action,
    regionIds,
    ...(paintedColors && Object.keys(paintedColors).length > 0 ? { paintedColors } : {}),
    timestamp: Date.now(),
  });
  return true;
}

export function emitCoopUnfillToRoom(
  realtimeRoom: Pick<RealtimeRoomProvider, 'activeRoomCode' | 'broadcastUnfillEvent'>,
  auth: Pick<AuthProvider, 'getCurrentIdentity'>,
  regionIds: number[],
  maxBatch: number = 512
): number {
  const room = realtimeRoom.activeRoomCode;
  if (!room || regionIds.length === 0) return 0;
  const identity = auth.getCurrentIdentity();
  const safeBatch = Math.max(1, Math.floor(maxBatch));
  let batches = 0;
  for (let offsetIdx = 0; offsetIdx < regionIds.length; offsetIdx += safeBatch) {
    const slice = regionIds.slice(offsetIdx, offsetIdx + safeBatch);
    const now = Date.now();
    realtimeRoom.broadcastUnfillEvent({
      eventId: `${identity.playerId}_unfill_${now}_${Math.random().toString(36).slice(2, 6)}`,
      roomCode: room,
      senderId: identity.playerId,
      playerId: identity.playerId,
      displayName: identity.displayName,
      avatarColorHex: identity.avatarColorHex,
      regionId: slice[0],
      regionIds: slice,
      timestamp: now,
    });
    batches += 1;
  }
  return batches;
}

export async function buildCoopShareUrl(params: {
  puzzle: PuzzleData | null;
  activeSourceRef?: PuzzleSourceRef;
  filledRegionIds: Set<number>;
  paintedRegionColors: Map<number, number>;
  isFreeColorMode: boolean;
  resetEpoch?: number;
  roomOverride?: string | null;
}): Promise<string | null> {
  if (!params.puzzle) return null;
  const paintedObj =
    params.paintedRegionColors.size > 0
      ? Object.fromEntries(params.paintedRegionColors)
      : undefined;
  const { url } = await buildShareProgressUrl({
    sourceRef: params.activeSourceRef,
    filledRegionIds: Array.from(params.filledRegionIds),
    paintedRegionColors: paintedObj,
    isFreeColor: params.isFreeColorMode,
    resetEpoch: params.resetEpoch,
    roomCode: params.roomOverride,
  });
  return url;
}

export interface CoopRoomJoinDeps {
  realtimeRoom: Pick<
    RealtimeRoomProvider,
    'activeRoomCode' | 'joinRoom' | 'leaveRoom' | 'getParticipants'
  >;
  auth: Pick<AuthProvider, 'getCurrentIdentity'>;
  coopJoinSeqRef: MutableRefObject<number>;
  onSetRoomState: (roomCode: string | null, participants: CoopParticipant[]) => void;
  hapticsEnabled: boolean;
  haptic?: (style: 'light' | 'medium' | 'success' | 'tick', enabled: boolean) => void;
}

export async function hostCoopRoomAction(
  deps: CoopRoomJoinDeps & {
    activeSourceRef?: PuzzleSourceRef;
    filledRegionIds: Set<number>;
    paintedRegionColors: Map<number, number>;
    isFreeColorMode: boolean;
    resetEpoch: number;
    generateCode?: (length?: number) => string;
  }
): Promise<string | null> {
  const joinSeq = ++deps.coopJoinSeqRef.current;
  try {
    const code = (deps.generateCode ?? generateCoopRoomCode)(6);
    const id = deps.auth.getCurrentIdentity();
    const seedToken = await encodeProgressDeltaToken(
      buildCoopProgressDelta({
        sourceRef: deps.activeSourceRef,
        filledRegionIds: deps.filledRegionIds,
        paintedRegionColors: deps.paintedRegionColors,
        isFreeColorMode: deps.isFreeColorMode,
        resetEpoch: deps.resetEpoch,
      })
    );
    if (joinSeq !== deps.coopJoinSeqRef.current) return null;
    await deps.realtimeRoom.joinRoom(
      code,
      {
        playerId: id.playerId,
        displayName: id.displayName,
        avatarColorHex: id.avatarColorHex,
        lastActiveAt: Date.now(),
      },
      seedToken
    );
    if (joinSeq !== deps.coopJoinSeqRef.current) {
      if (deps.realtimeRoom.activeRoomCode === code) {
        deps.realtimeRoom.leaveRoom();
      }
      return null;
    }
    const activeCode = deps.realtimeRoom.activeRoomCode;
    deps.onSetRoomState(activeCode, deps.realtimeRoom.getParticipants());
    (deps.haptic ?? NativeBridge.haptic)('success', deps.hapticsEnabled);
    return activeCode;
  } catch (err) {
    reportSwallowed('useCoopSession.hostCoopRoom', err);
    return null;
  }
}

export async function joinCoopRoomAction(
  rawCode: string,
  deps: CoopRoomJoinDeps
): Promise<boolean> {
  const normalized = normalizeCoopRoomCode(rawCode);
  if (!normalized) return false;
  const joinSeq = ++deps.coopJoinSeqRef.current;
  try {
    const id = deps.auth.getCurrentIdentity();
    await deps.realtimeRoom.joinRoom(normalized, {
      playerId: id.playerId,
      displayName: id.displayName,
      avatarColorHex: id.avatarColorHex,
      lastActiveAt: Date.now(),
    });
    if (joinSeq !== deps.coopJoinSeqRef.current) {
      if (deps.realtimeRoom.activeRoomCode === normalized) {
        deps.realtimeRoom.leaveRoom();
      }
      return false;
    }
    const activeCode = deps.realtimeRoom.activeRoomCode;
    deps.onSetRoomState(activeCode, deps.realtimeRoom.getParticipants());
    (deps.haptic ?? NativeBridge.haptic)('success', deps.hapticsEnabled);
    return Boolean(activeCode);
  } catch (err) {
    reportSwallowed('useCoopSession.joinCoopRoom', err, { roomCode: normalized });
    return false;
  }
}

export function leaveCoopRoomAction(deps: {
  realtimeRoom: Pick<RealtimeRoomProvider, 'leaveRoom'>;
  coopJoinSeqRef: MutableRefObject<number>;
  onSetRoomState: (roomCode: string | null, participants: CoopParticipant[]) => void;
  clearShareHash?: (roomCode: string | null) => void;
}): void {
  ++deps.coopJoinSeqRef.current;
  deps.realtimeRoom.leaveRoom();
  deps.onSetRoomState(null, []);
  (deps.clearShareHash ?? clearShareHashFromWindowUrl)(null);
}

export async function handleIncomingShareUrlAction(
  rawUrl: string,
  deps: {
    realtimeRoom: Pick<
      RealtimeRoomProvider,
      'activeRoomCode' | 'joinRoom' | 'getParticipants'
    > &
      Partial<Pick<RealtimeRoomProvider, 'leaveRoom'>>;
    auth: Pick<AuthProvider, 'getCurrentIdentity'>;
    coopJoinSeqRef: MutableRefObject<number>;
    onSetRoomState: (roomCode: string | null, participants: CoopParticipant[]) => void;
    loadSampleFromPrebakedOrGenerate: CoopLoadSampleFn;
    clearShareHash?: (roomCode?: string | null) => void;
  }
): Promise<void> {
  const parsed = await parseShareLinkFromUrl(rawUrl);
  if (parsed.roomCode) {
    const joinSeq = ++deps.coopJoinSeqRef.current;
    try {
      const id = deps.auth.getCurrentIdentity();
      await deps.realtimeRoom.joinRoom(parsed.roomCode, {
        playerId: id.playerId,
        displayName: id.displayName,
        avatarColorHex: id.avatarColorHex,
        lastActiveAt: Date.now(),
      });
      if (joinSeq === deps.coopJoinSeqRef.current) {
        deps.onSetRoomState(
          deps.realtimeRoom.activeRoomCode,
          deps.realtimeRoom.getParticipants()
        );
      } else if (deps.realtimeRoom.activeRoomCode === parsed.roomCode) {
        deps.realtimeRoom.leaveRoom?.();
      }
    } catch (err) {
      reportSwallowed('useCoopSession.incomingShareLinkJoin', err, {
        roomCode: parsed.roomCode,
      });
    }
  }
  const clearHash = deps.clearShareHash ?? clearShareHashFromWindowUrl;
  if (parsed.matchedSample && parsed.delta) {
    clearHash(deps.realtimeRoom.activeRoomCode || parsed.roomCode);
    await deps.loadSampleFromPrebakedOrGenerate(
      parsed.matchedSample,
      parsed.delta.filledRegionIds,
      parsed.delta.paintedRegionColors,
      parsed.delta.isFreeColor,
      undefined,
      parsed.delta.resetEpoch
    );
  } else if (parsed.hasToken || parsed.tokenError) {
    clearHash(deps.realtimeRoom.activeRoomCode || parsed.roomCode);
  }
}

function persistCoopSnapshotProgress(params: {
  activeSnapshotId: string;
  puzzle: PuzzleData;
  orderedList: number[];
  paintedObj: Record<number, number>;
  activeColorId: number;
  isFreeColorMode: boolean;
  viewport: CoopViewport;
  resetEpoch?: number;
  setSnapshots: Dispatch<SetStateAction<SavedSnapshot[]>>;
}): SavedSnapshot | undefined {
  const { zoomScale, panOffsetX, panOffsetY } = params.viewport;
  const updated = StorageService.updateSnapshotProgress(
    params.activeSnapshotId,
    params.orderedList.length,
    getTotalRegionCount(params.puzzle),
    params.orderedList,
    zoomScale,
    panOffsetX,
    panOffsetY,
    undefined,
    params.paintedObj,
    params.puzzle.palette,
    params.puzzle.isFreeColor,
    undefined,
    params.resetEpoch
  );
  params.setSnapshots(updated);
  StorageService.saveActiveState({
    activeSnapshotId: params.activeSnapshotId,
    activeColorId: params.activeColorId,
    filledRegionIds: params.orderedList,
    paintedRegionColors: params.paintedObj,
    isFreeColorMode: params.isFreeColorMode,
    ...(params.resetEpoch && params.resetEpoch > 0 ? { resetEpoch: params.resetEpoch } : {}),
    zoomScale,
    panOffsetX,
    panOffsetY,
  });
  return updated.find((s) => s.id === params.activeSnapshotId);
}

export async function handleCoopWelcomeTokenAction(
  seedToken: string,
  deps: {
    liveCoopRef: MutableRefObject<CoopLiveState>;
    viewportRef: MutableRefObject<CoopViewport>;
    loadSampleFromPrebakedOrGenerate: CoopLoadSampleFn;
    setFilledRegionIds: Dispatch<SetStateAction<Set<number>>>;
    setPaintedRegionColors: Dispatch<SetStateAction<Map<number, number>>>;
    setActiveColorId: Dispatch<SetStateAction<number>>;
    setSnapshots: Dispatch<SetStateAction<SavedSnapshot[]>>;
  }
): Promise<void> {
  try {
    const delta = await decodeProgressDeltaToken(seedToken);
    const cur = deps.liveCoopRef.current;
    const targetSample = resolveSampleFromSourceRef(delta.sourceRef);
    const currentSamplePath =
      cur.activeSave?.sampleAssetPath ||
      (cur.activeSave?.sourceRef?.kind === 'sample' ? cur.activeSave.sourceRef.uri : null);

    if (
      targetSample &&
      currentSamplePath?.replace(/^\.\//, '') !== targetSample.assetPath.replace(/^\.\//, '')
    ) {
      await deps.loadSampleFromPrebakedOrGenerate(
        targetSample,
        delta.filledRegionIds,
        delta.paintedRegionColors,
        delta.isFreeColor,
        undefined,
        delta.resetEpoch
      );
      return;
    }

    if (!cur.puzzle) return;
    const merged = applyCoopWelcomeMerge({
      delta,
      puzzle: cur.puzzle,
      activeSave: cur.activeSave,
      filledRegionIds: cur.filledRegionIds,
      paintedRegionColors: cur.paintedRegionColors,
      isFreeColorMode: cur.isFreeColorMode,
      activeColorId: cur.activeColorId,
      paletteSort: cur.settings.paletteSort,
    });

    if (!merged.stateChanged) return;

    const orderedList = Array.from(merged.nextFilled);
    const paintedObj = Object.fromEntries(merged.nextPainted);
    if (merged.shouldUpdateActiveColor) {
      deps.setActiveColorId(merged.nextActiveColorId);
    }
    deps.liveCoopRef.current = {
      ...cur,
      filledRegionIds: merged.nextFilled,
      paintedRegionColors: merged.nextPainted,
      activeColorId: merged.nextActiveColorId,
    };
    deps.setFilledRegionIds(merged.nextFilled);
    deps.setPaintedRegionColors(merged.nextPainted);

    if (cur.activeSnapshotId) {
      const updatedSave = persistCoopSnapshotProgress({
        activeSnapshotId: cur.activeSnapshotId,
        puzzle: cur.puzzle,
        orderedList,
        paintedObj,
        activeColorId: merged.nextActiveColorId,
        isFreeColorMode: cur.isFreeColorMode,
        viewport: deps.viewportRef.current,
        resetEpoch: merged.mergedEpoch > 0 ? merged.mergedEpoch : undefined,
        setSnapshots: deps.setSnapshots,
      });
      if (updatedSave) {
        deps.liveCoopRef.current = {
          ...deps.liveCoopRef.current,
          activeSave: updatedSave,
        };
      }
    } else if (merged.epochAdvanced && deps.liveCoopRef.current.activeSave) {
      deps.liveCoopRef.current = {
        ...deps.liveCoopRef.current,
        activeSave: {
          ...deps.liveCoopRef.current.activeSave,
          resetEpoch: merged.mergedEpoch,
        },
      };
    }
  } catch (err) {
    reportSwallowed('useCoopSession.onWelcomeState', err);
  }
}

export interface UseCoopSessionOptions {
  puzzle: PuzzleData | null;
  activeSnapshotId: string | null;
  activeSave: SavedSnapshot | undefined;
  activeTitle: string;
  filledRegionIds: Set<number>;
  paintedRegionColors: Map<number, number>;
  isFreeColorMode: boolean;
  hapticsEnabled: boolean;
  liveCoopRef: MutableRefObject<CoopLiveState>;
  viewportRef: MutableRefObject<CoopViewport>;
  regionByIdRef: MutableRefObject<Map<number, Region>>;
  loadSampleFromPrebakedOrGenerate: CoopLoadSampleFn;
  markTutorialActionTried: (stepKey: TutorialStepKey) => void;
  setFilledRegionIds: Dispatch<SetStateAction<Set<number>>>;
  setPaintedRegionColors: Dispatch<SetStateAction<Map<number, number>>>;
  setActiveColorId: Dispatch<SetStateAction<number>>;
  setSnapshots: Dispatch<SetStateAction<SavedSnapshot[]>>;
}

export interface UseCoopSessionResult {
  coopRippleBuffer: CoopRippleBuffer;
  coopRoomCode: string | null;
  coopRoomCodeRef: MutableRefObject<string | null>;
  coopParticipants: CoopParticipant[];
  nextCoopJoinSeq: () => number;
  getCoopJoinSeq: () => number;
  setCoopRoomState: (roomCode: string | null, participants: CoopParticipant[]) => void;
  isCoopSessionActive: () => boolean;
  emitCoopPaint: (
    action: 'FILL' | 'UNFILL',
    regionIds: number[],
    paintedColors?: Record<number, number>
  ) => void;
  emitCoopUnfill: (regionIds: number[]) => void;
  activeSourceRef: PuzzleSourceRef | undefined;
  canShareActiveLink: boolean;
  buildActiveShareUrl: (roomOverride?: string | null) => Promise<string | null>;
  handleShareProgressLink: () => Promise<string | null>;
  handleHostCoopRoom: () => Promise<string | null>;
  handleJoinCoopRoom: (rawCode: string) => Promise<boolean>;
  handleLeaveCoopRoom: () => void;
  handleCopyCoopInviteLink: () => Promise<string | null>;
}

export function useCoopSession(options: UseCoopSessionOptions): UseCoopSessionResult {
  const {
    puzzle,
    activeSnapshotId,
    activeSave,
    activeTitle,
    filledRegionIds,
    paintedRegionColors,
    isFreeColorMode,
    hapticsEnabled,
    liveCoopRef,
    viewportRef,
    regionByIdRef,
    loadSampleFromPrebakedOrGenerate,
    markTutorialActionTried,
    setFilledRegionIds,
    setPaintedRegionColors,
    setActiveColorId,
    setSnapshots,
  } = options;

  const realtimeRoom = useRealtimeRoomProvider();
  const auth = useAuthProvider();

  const [coopRippleBuffer] = useState<CoopRippleBuffer>(() => new CoopRippleBuffer());
  const coopJoinSeqRef = useRef<number>(0);
  const [coopRoomCode, setCoopRoomCode] = useState<string | null>(null);
  const [coopParticipants, setCoopParticipants] = useState<CoopParticipant[]>([]);
  const coopRoomCodeRef = useLatest(coopRoomCode);
  const puzzleRef = useLatest(puzzle);
  const unifiedWorldById = useMemo<Map<number, UnifiedRegionRef> | null>(() => {
    if (!puzzle?.nestedLayers?.length) return null;
    return buildUnifiedRegionIndex(puzzle).worldById;
  }, [puzzle]);
  const unifiedWorldByIdRef = useLatest(unifiedWorldById);
  const loadSampleRef = useLatest(loadSampleFromPrebakedOrGenerate);
  const prevCoopSnapRef = useRef<string | null>(null);
  const prevCoopResetEpochRef = useRef<number>(0);

  const nextCoopJoinSeq = useCallback(() => ++coopJoinSeqRef.current, []);
  const getCoopJoinSeq = useCallback(() => coopJoinSeqRef.current, []);
  const setCoopRoomState = useCallback(
    (roomCode: string | null, participants: CoopParticipant[]) => {
      setCoopRoomCode(roomCode);
      setCoopParticipants(participants);
    },
    []
  );

  const isCoopSessionActive = useCallback(
    () => Boolean(realtimeRoom.activeRoomCode || coopRoomCodeRef.current),
    [realtimeRoom, coopRoomCodeRef]
  );

  const emitCoopPaint = useCallback(
    (
      action: 'FILL' | 'UNFILL',
      regionIds: number[],
      paintedColors?: Record<number, number>
    ) => {
      emitCoopPaintToRoom(realtimeRoom, auth, action, regionIds, paintedColors);
    },
    [realtimeRoom, auth]
  );

  const emitCoopUnfill = useCallback(
    (regionIds: number[]) => {
      emitCoopUnfillToRoom(realtimeRoom, auth, regionIds);
    },
    [realtimeRoom, auth]
  );

  // Subscribe to Realtime Co-op Room events (Collaborator Paints, Welcome Convergence, Presence)
  useEffect(() => {
    const unsubParticipants = realtimeRoom.onParticipantsChanged((peers) => {
      setCoopParticipants(peers);
      setCoopRoomCode(realtimeRoom.activeRoomCode);
    });

    const unsubPaint = realtimeRoom.onPaintEvent((event) => {
      const cur = liveCoopRef.current;
      const transition = applyCoopPaintEvent({
        event,
        puzzle: cur.puzzle,
        currentPuzzle: puzzleRef.current,
        regionById: regionByIdRef.current,
        worldById: cur.puzzle === puzzleRef.current ? unifiedWorldByIdRef.current : null,
        filledRegionIds: cur.filledRegionIds,
        paintedRegionColors: cur.paintedRegionColors,
      });
      if (!transition) return;

      for (const ripple of transition.ripples) {
        coopRippleBuffer.spawn(ripple.x, ripple.y, ripple.colorHex);
      }
      if (!transition.changed || !cur.puzzle) return;

      const orderedList = Array.from(transition.nextFilled);
      const paintedObj = Object.fromEntries(transition.nextPainted);
      liveCoopRef.current = {
        ...cur,
        filledRegionIds: transition.nextFilled,
        paintedRegionColors: transition.nextPainted,
      };
      setFilledRegionIds(transition.nextFilled);
      setPaintedRegionColors(transition.nextPainted);

      if (cur.activeSnapshotId) {
        persistCoopSnapshotProgress({
          activeSnapshotId: cur.activeSnapshotId,
          puzzle: cur.puzzle,
          orderedList,
          paintedObj,
          activeColorId: cur.activeColorId,
          isFreeColorMode: cur.isFreeColorMode,
          viewport: viewportRef.current,
          setSnapshots,
        });
      }
    });

    const unsubUnfill = realtimeRoom.onUnfillEvent((event) => {
      const cur = liveCoopRef.current;
      const transition = applyCoopUnfillEvent({
        event,
        localPeerId: auth.getCurrentIdentity().playerId,
        puzzle: cur.puzzle,
        currentPuzzle: puzzleRef.current,
        regionById: regionByIdRef.current,
        worldById: cur.puzzle === puzzleRef.current ? unifiedWorldByIdRef.current : null,
        filledRegionIds: cur.filledRegionIds,
        paintedRegionColors: cur.paintedRegionColors,
        activeColorId: cur.activeColorId,
      });
      if (!transition || !cur.puzzle) return;

      if (transition.ripple) {
        coopRippleBuffer.spawn(
          transition.ripple.x,
          transition.ripple.y,
          transition.ripple.colorHex
        );
      }

      liveCoopRef.current = {
        ...cur,
        filledRegionIds: transition.nextFilled,
        paintedRegionColors: transition.nextPainted,
        activeColorId: transition.nextActiveColorId,
      };
      if (transition.nextActiveColorId !== cur.activeColorId) {
        setActiveColorId(transition.nextActiveColorId);
      }

      const orderedList = Array.from(transition.nextFilled);
      const paintedObj = Object.fromEntries(transition.nextPainted);
      setFilledRegionIds(transition.nextFilled);
      setPaintedRegionColors(transition.nextPainted);

      if (cur.activeSnapshotId) {
        persistCoopSnapshotProgress({
          activeSnapshotId: cur.activeSnapshotId,
          puzzle: cur.puzzle,
          orderedList,
          paintedObj,
          activeColorId: transition.nextActiveColorId,
          isFreeColorMode: cur.isFreeColorMode,
          viewport: viewportRef.current,
          setSnapshots,
        });
      }
    });

    const unsubWelcome = realtimeRoom.onWelcomeState(async (seedToken) => {
      await handleCoopWelcomeTokenAction(seedToken, {
        liveCoopRef,
        viewportRef,
        loadSampleFromPrebakedOrGenerate: (...args) => loadSampleRef.current(...args),
        setFilledRegionIds,
        setPaintedRegionColors,
        setActiveColorId,
        setSnapshots,
      });
    });

    return () => {
      unsubParticipants();
      unsubPaint();
      unsubUnfill();
      unsubWelcome();
    };
  }, [
    realtimeRoom,
    auth,
    coopRippleBuffer,
    liveCoopRef,
    viewportRef,
    regionByIdRef,
    puzzleRef,
    unifiedWorldByIdRef,
    loadSampleRef,
    setFilledRegionIds,
    setPaintedRegionColors,
    setActiveColorId,
    setSnapshots,
  ]);

  // Keep active Co-op room welcome seed token fresh whenever local progress or active puzzle updates
  useEffect(() => {
    if (!coopRoomCode || !puzzle) {
      prevCoopSnapRef.current = null;
      prevCoopResetEpochRef.current = 0;
      return;
    }
    const currentEpoch = activeSave?.resetEpoch ?? 0;
    const switchedPuzzle = shouldBroadcastWelcomeOnSeedUpdate(
      prevCoopSnapRef.current,
      activeSnapshotId,
      prevCoopResetEpochRef.current,
      currentEpoch
    );
    prevCoopSnapRef.current = activeSnapshotId;
    prevCoopResetEpochRef.current = currentEpoch;

    const sampleUri = resolveSeedSampleUri(activeSave);
    void encodeProgressDeltaToken(
      buildCoopProgressDelta({
        sourceRef: sampleUri ? { kind: 'sample', uri: sampleUri } : undefined,
        filledRegionIds,
        paintedRegionColors,
        isFreeColorMode,
        resetEpoch: currentEpoch,
      })
    )
      .then((token) => {
        if (switchedPuzzle) {
          realtimeRoom.broadcastWelcomeState(token);
        } else {
          realtimeRoom.updateSeedToken(token);
        }
      })
      .catch((err) => {
        reportSwallowed('useCoopSession.seedTokenBroadcast', err);
      });
  }, [
    realtimeRoom,
    coopRoomCode,
    puzzle,
    activeSnapshotId,
    activeSave,
    filledRegionIds,
    paintedRegionColors,
    isFreeColorMode,
  ]);

  // Handle incoming Android App Links / runtime URL hash navigation
  useEffect(() => {
    const handleIncomingUrl = (rawUrl: string) => {
      void handleIncomingShareUrlAction(rawUrl, {
        realtimeRoom,
        auth,
        coopJoinSeqRef,
        onSetRoomState: setCoopRoomState,
        loadSampleFromPrebakedOrGenerate: (...args) => loadSampleRef.current(...args),
      }).catch((err) => {
        reportSwallowed('useCoopSession.incomingShareUrl', err);
      });
    };

    const unsubDeepLink = NativeBridge.onDeepLink((url) => {
      handleIncomingUrl(url);
    });
    if (typeof window === 'undefined') {
      return () => {
        unsubDeepLink();
      };
    }
    const onHashChange = () => {
      if (window.location.hash.includes('s=')) {
        handleIncomingUrl(window.location.href);
      }
    };
    window.addEventListener('hashchange', onHashChange);
    return () => {
      unsubDeepLink();
      window.removeEventListener('hashchange', onHashChange);
    };
  }, [realtimeRoom, auth, setCoopRoomState, loadSampleRef]);

  const activeSampleAssetPath = activeSave?.sampleAssetPath;
  const activeSourceRefKind = activeSave?.sourceRef?.kind;
  const activeSourceRefUri = activeSave?.sourceRef?.uri;
  const activeResetEpoch = activeSave?.resetEpoch ?? 0;

  const activeSourceRef = useMemo(
    () =>
      resolveActiveSourceRefFields(
        activeSampleAssetPath,
        activeSourceRefKind,
        activeSourceRefUri
      ),
    [activeSampleAssetPath, activeSourceRefKind, activeSourceRefUri]
  );

  const canShareActiveLink = Boolean(activeSourceRef);

  const buildActiveShareUrl = useCallback(
    async (roomOverride?: string | null): Promise<string | null> =>
      buildCoopShareUrl({
        puzzle,
        activeSourceRef,
        filledRegionIds,
        paintedRegionColors,
        isFreeColorMode,
        resetEpoch: activeResetEpoch > 0 ? activeResetEpoch : undefined,
        roomOverride,
      }),
    [
      puzzle,
      activeSourceRef,
      activeResetEpoch,
      filledRegionIds,
      paintedRegionColors,
      isFreeColorMode,
    ]
  );

  const handleShareProgressLink = useCallback(async (): Promise<string | null> => {
    if (!canShareActiveLink) return null;
    const url = await buildActiveShareUrl(null);
    if (!url) return null;
    await NativeBridge.shareTextLink(`${activeTitle} — Capy Progress`, url);
    NativeBridge.haptic('tick', hapticsEnabled);
    markTutorialActionTried('saves_export');
    return url;
  }, [
    canShareActiveLink,
    buildActiveShareUrl,
    activeTitle,
    hapticsEnabled,
    markTutorialActionTried,
  ]);

  const handleHostCoopRoom = useCallback(async (): Promise<string | null> => {
    return hostCoopRoomAction({
      realtimeRoom,
      auth,
      coopJoinSeqRef,
      onSetRoomState: setCoopRoomState,
      hapticsEnabled,
      activeSourceRef,
      filledRegionIds,
      paintedRegionColors,
      isFreeColorMode,
      resetEpoch: activeResetEpoch,
    });
  }, [
    realtimeRoom,
    auth,
    setCoopRoomState,
    hapticsEnabled,
    activeSourceRef,
    filledRegionIds,
    paintedRegionColors,
    isFreeColorMode,
    activeResetEpoch,
  ]);

  const handleJoinCoopRoom = useCallback(
    async (rawCode: string): Promise<boolean> => {
      return joinCoopRoomAction(rawCode, {
        realtimeRoom,
        auth,
        coopJoinSeqRef,
        onSetRoomState: setCoopRoomState,
        hapticsEnabled,
      });
    },
    [realtimeRoom, auth, setCoopRoomState, hapticsEnabled]
  );

  const handleLeaveCoopRoom = useCallback(() => {
    leaveCoopRoomAction({
      realtimeRoom,
      coopJoinSeqRef,
      onSetRoomState: setCoopRoomState,
    });
  }, [realtimeRoom, setCoopRoomState]);

  const handleCopyCoopInviteLink = useCallback(async (): Promise<string | null> => {
    if (!coopRoomCode) return null;
    const url = await buildActiveShareUrl(coopRoomCode);
    if (!url) return null;
    await NativeBridge.shareTextLink(`Join my Capy Co-op Room (${coopRoomCode})`, url);
    NativeBridge.haptic('tick', hapticsEnabled);
    return url;
  }, [coopRoomCode, buildActiveShareUrl, hapticsEnabled]);

  return {
    coopRippleBuffer,
    coopRoomCode,
    coopRoomCodeRef,
    coopParticipants,
    nextCoopJoinSeq,
    getCoopJoinSeq,
    setCoopRoomState,
    isCoopSessionActive,
    emitCoopPaint,
    emitCoopUnfill,
    activeSourceRef,
    canShareActiveLink,
    buildActiveShareUrl,
    handleShareProgressLink,
    handleHostCoopRoom,
    handleJoinCoopRoom,
    handleLeaveCoopRoom,
    handleCopyCoopInviteLink,
  };
}
