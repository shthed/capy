import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');

function makeTestPuzzle(overrides = {}) {
  const palette = [
    { id: 1, hex: '#EF4444', r: 239, g: 68, b: 68, isLight: false, argb: 0xffef4444 },
    { id: 2, hex: '#3B82F6', r: 59, g: 130, b: 246, isLight: false, argb: 0xff3b82f6 },
    { id: 3, hex: '#22C55E', r: 34, g: 197, b: 94, isLight: false, argb: 0xff22c55e },
  ];
  const regions = [
    {
      id: 101,
      colorId: 1,
      centroidX: 50,
      centroidY: 60,
      minX: 0,
      minY: 0,
      maxX: 100,
      maxY: 100,
      area: 10000,
    },
    {
      id: 102,
      colorId: 2,
      centroidX: 250,
      centroidY: 160,
      minX: 200,
      minY: 100,
      maxX: 300,
      maxY: 200,
      area: 10000,
    },
    {
      id: 103,
      colorId: 3,
      centroidX: 450,
      centroidY: 360,
      minX: 400,
      minY: 300,
      maxX: 500,
      maxY: 400,
      area: 10000,
    },
  ];
  return {
    width: 1000,
    height: 1000,
    palette,
    regions,
    isFreeColor: false,
    ...overrides,
  };
}

function makeMockAuth(playerId = 'local-peer-1') {
  return {
    getCurrentIdentity: () => ({
      playerId,
      displayName: 'CapyTester',
      avatarColorHex: '#FF9900',
      provider: 'local_guest',
      isSignedIn: false,
    }),
  };
}

function makeMockRealtimeRoom(initialRoomCode = null) {
  let activeRoomCode = initialRoomCode;
  let participants = [];
  const paintEvents = [];
  const unfillEvents = [];
  const welcomeTokens = [];
  const seedTokens = [];
  const joinCalls = [];
  let leaveCalls = 0;

  return {
    get activeRoomCode() {
      return activeRoomCode;
    },
    setActiveRoomCode(code) {
      activeRoomCode = code;
    },
    paintEvents,
    unfillEvents,
    welcomeTokens,
    seedTokens,
    joinCalls,
    get leaveCalls() {
      return leaveCalls;
    },
    async joinRoom(roomCode, participant, initialSeedToken) {
      joinCalls.push({ roomCode, participant, initialSeedToken });
      activeRoomCode = roomCode;
      participants = [participant];
    },
    leaveRoom() {
      leaveCalls += 1;
      activeRoomCode = null;
      participants = [];
    },
    broadcastPaintEvent(ev) {
      paintEvents.push(ev);
    },
    broadcastUnfillEvent(ev) {
      unfillEvents.push(ev);
    },
    broadcastWelcomeState(tok) {
      welcomeTokens.push(tok);
    },
    updateSeedToken(tok) {
      seedTokens.push(tok);
    },
    getParticipants() {
      return [...participants];
    },
    onPaintEvent: () => () => {},
    onUnfillEvent: () => () => {},
    onWelcomeState: () => () => {},
    onParticipantsChanged: () => () => {},
  };
}

export async function runCoopSessionHookTests(vite) {
  console.log('   -> Co-op Session hook unit tests (Issue #585 Sub-Slice 4)...');

  const coopMod = await vite.ssrLoadModule('/src/hooks/useCoopSession.ts');
  const codecMod = await vite.ssrLoadModule('/src/services/CapyCodec.ts');
  const providerCtxMod = await vite.ssrLoadModule('/src/context/ProviderContext.tsx');
  const typesMod = await vite.ssrLoadModule('/src/types/index.ts');

  const {
    resolveActiveSourceRef,
    resolveSeedSampleUri,
    shouldBroadcastWelcomeOnSeedUpdate,
    buildCoopProgressDelta,
    applyCoopPaintEvent,
    applyCoopUnfillEvent,
    applyCoopWelcomeMerge,
    emitCoopPaintToRoom,
    emitCoopUnfillToRoom,
    buildCoopShareUrl,
    hostCoopRoomAction,
    joinCoopRoomAction,
    leaveCoopRoomAction,
    handleIncomingShareUrlAction,
    handleCoopWelcomeTokenAction,
    useCoopSession,
  } = coopMod;

  const { encodeProgressDeltaToken } = codecMod;
  const { ProviderContextProvider } = providerCtxMod;
  const { SAMPLE_GALLERY } = typesMod;

  const puzzle = makeTestPuzzle();
  const regionById = new Map(puzzle.regions.map((r) => [r.id, r]));
  const sample0 = SAMPLE_GALLERY[0];
  const sample1 = SAMPLE_GALLERY[1] || SAMPLE_GALLERY[0];

  // 1. resolveActiveSourceRef & resolveSeedSampleUri
  assert.deepEqual(resolveActiveSourceRef({ sampleAssetPath: sample0.assetPath }), {
    kind: 'sample',
    uri: sample0.assetPath,
  });
  assert.deepEqual(
    resolveActiveSourceRef({
      sourceRef: { kind: 'sample', uri: sample0.assetPath },
    }),
    { kind: 'sample', uri: sample0.assetPath }
  );
  assert.deepEqual(
    resolveActiveSourceRef({
      sourceRef: { kind: 'catalog', uri: 'catalog-capy-1' },
    }),
    { kind: 'catalog', uri: 'catalog-capy-1' }
  );
  assert.equal(resolveActiveSourceRef({ sampleAssetPath: '../etc/passwd' }), undefined);
  assert.equal(resolveActiveSourceRef(undefined), undefined);

  assert.equal(resolveSeedSampleUri({ sampleAssetPath: sample0.assetPath }), sample0.assetPath);
  assert.equal(
    resolveSeedSampleUri({ sourceRef: { kind: 'sample', uri: sample0.assetPath } }),
    sample0.assetPath
  );
  assert.equal(
    resolveSeedSampleUri({ sourceRef: { kind: 'catalog', uri: 'cat-1' } }),
    undefined
  );
  assert.equal(resolveSeedSampleUri({ sampleAssetPath: 'https://evil.example/x.png' }), undefined);

  // 2. Seed-token change detection
  assert.equal(shouldBroadcastWelcomeOnSeedUpdate(null, 'snap-1', 0, 0), false);
  assert.equal(shouldBroadcastWelcomeOnSeedUpdate('snap-1', 'snap-1', 0, 0), false);
  assert.equal(shouldBroadcastWelcomeOnSeedUpdate('snap-1', 'snap-2', 0, 0), true);
  assert.equal(shouldBroadcastWelcomeOnSeedUpdate('snap-1', 'snap-1', 1, 2), true);
  assert.equal(shouldBroadcastWelcomeOnSeedUpdate('snap-1', 'snap-1', 2, 2), false);
  assert.equal(shouldBroadcastWelcomeOnSeedUpdate(null, 'snap-1', 0, 1), true);

  // 3. applyCoopPaintEvent (FILL standard, FILL free-color, invalid region, UNFILL)
  assert.equal(
    applyCoopPaintEvent({
      event: {
        eventId: 'e1',
        roomCode: 'ROOM42',
        playerId: 'peer-2',
        displayName: 'Peer',
        avatarColorHex: '#00AAFF',
        action: 'FILL',
        regionIds: [101],
        timestamp: 1000,
      },
      puzzle: null,
      filledRegionIds: new Set(),
      paintedRegionColors: new Map(),
    }),
    null
  );

  const fillStd = applyCoopPaintEvent({
    event: {
      eventId: 'e2',
      roomCode: 'ROOM42',
      playerId: 'peer-2',
      displayName: 'Peer',
      avatarColorHex: '#00AAFF',
      action: 'FILL',
      regionIds: [101, 999],
      timestamp: 1000,
    },
    puzzle,
    currentPuzzle: puzzle,
    regionById,
    filledRegionIds: new Set(),
    paintedRegionColors: new Map(),
  });
  assert.ok(fillStd);
  assert.equal(fillStd.changed, true);
  assert.deepEqual(Array.from(fillStd.nextFilled), [101]);
  assert.equal(fillStd.ripples.length, 1);
  assert.deepEqual(fillStd.ripples[0], { x: 50, y: 60, colorHex: '#00AAFF' });

  const fillFree = applyCoopPaintEvent({
    event: {
      eventId: 'e3',
      roomCode: 'ROOM42',
      playerId: 'peer-2',
      displayName: 'Peer',
      avatarColorHex: '#AA00FF',
      action: 'FILL',
      regionIds: [101],
      paintedColors: { 101: 3 },
      timestamp: 1001,
    },
    puzzle,
    currentPuzzle: puzzle,
    regionById,
    filledRegionIds: new Set([101]),
    paintedRegionColors: new Map([[101, 1]]),
  });
  assert.ok(fillFree);
  assert.equal(fillFree.changed, true);
  assert.equal(fillFree.nextPainted.get(101), 3);
  assert.equal(fillFree.ripples.length, 1);

  const unfillViaPaint = applyCoopPaintEvent({
    event: {
      eventId: 'e4',
      roomCode: 'ROOM42',
      playerId: 'peer-2',
      displayName: 'Peer',
      avatarColorHex: '#AA00FF',
      action: 'UNFILL',
      regionIds: [101, 102],
      timestamp: 1002,
    },
    puzzle,
    filledRegionIds: new Set([101]),
    paintedRegionColors: new Map([[101, 3]]),
  });
  assert.ok(unfillViaPaint);
  assert.equal(unfillViaPaint.changed, true);
  assert.equal(unfillViaPaint.nextFilled.size, 0);
  assert.equal(unfillViaPaint.nextPainted.size, 0);

  // 4. applyCoopUnfillEvent (self-echo ignore, legacy regionId, completion color recovery + ripple)
  const selfEcho = applyCoopUnfillEvent({
    event: {
      eventId: 'u1',
      roomCode: 'ROOM42',
      senderId: 'local-peer-1',
      playerId: 'local-peer-1',
      displayName: 'Me',
      avatarColorHex: '#FF9900',
      regionIds: [101],
      timestamp: 2000,
    },
    localPeerId: 'local-peer-1',
    puzzle,
    filledRegionIds: new Set([101]),
    paintedRegionColors: new Map(),
    activeColorId: 1,
  });
  assert.equal(selfEcho, null, 'self-echo unfill must be ignored');

  const remoteUnfill = applyCoopUnfillEvent({
    event: {
      eventId: 'u2',
      roomCode: 'ROOM42',
      senderId: 'peer-2',
      playerId: 'peer-2',
      displayName: 'Peer',
      avatarColorHex: '#123456',
      regionId: 102,
      regionIds: [],
      timestamp: 2001,
    },
    localPeerId: 'local-peer-1',
    puzzle,
    currentPuzzle: puzzle,
    regionById,
    filledRegionIds: new Set([101, 102, 103]),
    paintedRegionColors: new Map([[102, 2]]),
    activeColorId: 1,
  });
  assert.ok(remoteUnfill);
  assert.equal(remoteUnfill.changed, true);
  assert.equal(remoteUnfill.nextFilled.has(102), false);
  assert.equal(remoteUnfill.nextPainted.has(102), false);
  assert.equal(remoteUnfill.nextActiveColorId, 2, 'completed puzzle unfill should select unfilled color');
  assert.deepEqual(remoteUnfill.ripple, { x: 250, y: 160, colorHex: '#123456' });

  // 5. applyCoopWelcomeMerge CRDT merge + resetEpoch dominance
  // 5a. Equal epoch: merges local + remote, ignores unknown IDs, advances activeColorId when color 1 completes
  const equalMerge = applyCoopWelcomeMerge({
    delta: {
      version: 2,
      filledRegionIds: [101, 999],
      paintedRegionColors: { 101: 1, 999: 2 },
      resetEpoch: 1,
      updatedAt: 5000,
    },
    puzzle,
    activeSave: { resetEpoch: 1 },
    filledRegionIds: new Set([102]),
    paintedRegionColors: new Map(),
    isFreeColorMode: false,
    activeColorId: 1,
    paletteSort: 'NUMBER',
    now: 5000,
  });
  assert.equal(equalMerge.stateChanged, true);
  assert.equal(equalMerge.epochAdvanced, false);
  assert.equal(equalMerge.mergedEpoch, 1);
  assert.deepEqual(Array.from(equalMerge.nextFilled).sort((a, b) => a - b), [101, 102]);
  assert.equal(equalMerge.nextPainted.has(999), false);
  assert.equal(equalMerge.shouldUpdateActiveColor, true);
  assert.equal(equalMerge.nextActiveColorId, 3);

  // 5b. Remote newer resetEpoch dominates and resets local filled regions
  const remoteNewer = applyCoopWelcomeMerge({
    delta: {
      version: 2,
      filledRegionIds: [103],
      resetEpoch: 3,
      updatedAt: 6000,
    },
    puzzle,
    activeSave: { resetEpoch: 1 },
    filledRegionIds: new Set([101, 102]),
    paintedRegionColors: new Map([[101, 1]]),
    isFreeColorMode: false,
    activeColorId: 1,
    paletteSort: 'NUMBER',
    now: 6000,
  });
  assert.equal(remoteNewer.stateChanged, true);
  assert.equal(remoteNewer.epochAdvanced, true);
  assert.equal(remoteNewer.mergedEpoch, 3);
  assert.deepEqual(Array.from(remoteNewer.nextFilled), [103]);
  assert.equal(remoteNewer.nextPainted.size, 0);

  // 5c. Local newer resetEpoch preserved against stale remote epoch
  const localNewer = applyCoopWelcomeMerge({
    delta: {
      version: 2,
      filledRegionIds: [101, 102, 103],
      resetEpoch: 1,
      updatedAt: 999999,
    },
    puzzle,
    activeSave: { resetEpoch: 4 },
    filledRegionIds: new Set([102]),
    paintedRegionColors: new Map(),
    isFreeColorMode: false,
    activeColorId: 1,
    paletteSort: 'NUMBER',
    now: 7000,
  });
  assert.equal(localNewer.epochAdvanced, false);
  assert.equal(localNewer.mergedEpoch, 4);
  assert.deepEqual(Array.from(localNewer.nextFilled), [102]);
  assert.equal(localNewer.stateChanged, false);

  // 5d. handleCoopWelcomeTokenAction: cross-sample switch & malformed token safety
  const loadedSamples = [];
  const crossSampleToken = await encodeProgressDeltaToken({
    version: 2,
    sourceRef: { kind: 'sample', uri: sample1.assetPath },
    filledRegionIds: [101, 102],
    resetEpoch: 2,
    updatedAt: 8000,
  });
  const liveCoopRef = {
    current: {
      puzzle,
      activeSnapshotId: null,
      activeSave: {
        id: 'snap-0',
        title: sample0.title,
        sampleAssetPath: sample0.assetPath,
        resetEpoch: 1,
      },
      activeTitle: sample0.title,
      filledRegionIds: new Set(),
      paintedRegionColors: new Map(),
      isFreeColorMode: false,
      activeColorId: 1,
      settings: { paletteSort: 'NUMBER' },
    },
  };
  await handleCoopWelcomeTokenAction(crossSampleToken, {
    liveCoopRef,
    viewportRef: { current: { zoomScale: 1, panOffsetX: 0, panOffsetY: 0 } },
    loadSampleFromPrebakedOrGenerate: async (sample, filled, _painted, _free, _cfg, epoch) => {
      loadedSamples.push({ sampleId: sample.id, filled, epoch });
    },
    setFilledRegionIds: () => {},
    setPaintedRegionColors: () => {},
    setActiveColorId: () => {},
    setSnapshots: () => {},
  });
  if (sample1.assetPath !== sample0.assetPath) {
    assert.equal(loadedSamples.length, 1);
    assert.equal(loadedSamples[0].sampleId, sample1.id);
    assert.deepEqual(loadedSamples[0].filled, [101, 102]);
    assert.equal(loadedSamples[0].epoch, 2);
  }

  // Malformed welcome token must not throw
  await handleCoopWelcomeTokenAction('not-a-valid-token!!!', {
    liveCoopRef,
    viewportRef: { current: { zoomScale: 1, panOffsetX: 0, panOffsetY: 0 } },
    loadSampleFromPrebakedOrGenerate: async () => {},
    setFilledRegionIds: () => {},
    setPaintedRegionColors: () => {},
    setActiveColorId: () => {},
    setSnapshots: () => {},
  });

  // 6. emitCoopPaintToRoom & emitCoopUnfillToRoom
  const room = makeMockRealtimeRoom(null);
  const auth = makeMockAuth('player-abc');
  assert.equal(emitCoopPaintToRoom(room, auth, 'FILL', [101]), false);
  assert.equal(emitCoopUnfillToRoom(room, auth, [101]), 0);

  room.setActiveRoomCode('CAPY99');
  assert.equal(emitCoopPaintToRoom(room, auth, 'FILL', []), false);
  assert.equal(emitCoopPaintToRoom(room, auth, 'FILL', [101, 102], { 101: 2 }), true);
  assert.equal(room.paintEvents.length, 1);
  assert.equal(room.paintEvents[0].roomCode, 'CAPY99');
  assert.equal(room.paintEvents[0].playerId, 'player-abc');
  assert.deepEqual(room.paintEvents[0].regionIds, [101, 102]);
  assert.deepEqual(room.paintEvents[0].paintedColors, { 101: 2 });

  const batchCount = emitCoopUnfillToRoom(room, auth, [1, 2, 3, 4, 5], 2);
  assert.equal(batchCount, 3);
  assert.equal(room.unfillEvents.length, 3);
  assert.deepEqual(room.unfillEvents[0].regionIds, [1, 2]);
  assert.equal(room.unfillEvents[0].regionId, 1);
  assert.deepEqual(room.unfillEvents[2].regionIds, [5]);
  assert.equal(room.unfillEvents[2].regionId, 5);

  // 7. Host / Join / Leave lifecycle & share URL construction
  const nullShareUrl = await buildCoopShareUrl({
    puzzle: null,
    filledRegionIds: new Set(),
    paintedRegionColors: new Map(),
    isFreeColorMode: false,
  });
  assert.equal(nullShareUrl, null);

  const shareUrl = await buildCoopShareUrl({
    puzzle,
    activeSourceRef: { kind: 'sample', uri: sample0.assetPath },
    filledRegionIds: new Set([101]),
    paintedRegionColors: new Map([[101, 1]]),
    isFreeColorMode: true,
    resetEpoch: 2,
    roomOverride: 'CAPY99',
  });
  assert.ok(shareUrl && shareUrl.includes('room=CAPY99') && shareUrl.includes('#s='));

  const joinSeqRef = { current: 0 };
  const roomStateLog = [];
  const hapticLog = [];
  const lifecycleRoom = makeMockRealtimeRoom(null);

  const hostedCode = await hostCoopRoomAction({
    realtimeRoom: lifecycleRoom,
    auth,
    coopJoinSeqRef: joinSeqRef,
    onSetRoomState: (code, peers) => roomStateLog.push({ code, peerCount: peers.length }),
    hapticsEnabled: true,
    haptic: (style, enabled) => hapticLog.push({ style, enabled }),
    activeSourceRef: { kind: 'sample', uri: sample0.assetPath },
    filledRegionIds: new Set([101]),
    paintedRegionColors: new Map(),
    isFreeColorMode: false,
    resetEpoch: 1,
    generateCode: () => 'HOST22',
  });
  assert.equal(hostedCode, 'HOST22');
  assert.equal(lifecycleRoom.joinCalls.length, 1);
  assert.ok(lifecycleRoom.joinCalls[0].initialSeedToken);
  assert.deepEqual(roomStateLog.at(-1), { code: 'HOST22', peerCount: 1 });
  assert.deepEqual(hapticLog.at(-1), { style: 'success', enabled: true });

  // Join invalid room code fails cleanly
  assert.equal(
    await joinCoopRoomAction('ab', {
      realtimeRoom: lifecycleRoom,
      auth,
      coopJoinSeqRef: joinSeqRef,
      onSetRoomState: () => {},
      hapticsEnabled: false,
      haptic: () => {},
    }),
    false
  );

  // Join valid room code normalizes & updates state
  const joinedOk = await joinCoopRoomAction('  join44 ', {
    realtimeRoom: lifecycleRoom,
    auth,
    coopJoinSeqRef: joinSeqRef,
    onSetRoomState: (code, peers) => roomStateLog.push({ code, peerCount: peers.length }),
    hapticsEnabled: false,
    haptic: (style, enabled) => hapticLog.push({ style, enabled }),
  });
  assert.equal(joinedOk, true);
  assert.equal(lifecycleRoom.activeRoomCode, 'JOIN44');
  assert.deepEqual(roomStateLog.at(-1), { code: 'JOIN44', peerCount: 1 });

  // Leave room increments joinSeq, clears room state, clears share hash
  let clearedHashArg = 'UNSET';
  const seqBeforeLeave = joinSeqRef.current;
  leaveCoopRoomAction({
    realtimeRoom: lifecycleRoom,
    coopJoinSeqRef: joinSeqRef,
    onSetRoomState: (code, peers) => roomStateLog.push({ code, peerCount: peers.length }),
    clearShareHash: (code) => {
      clearedHashArg = code;
    },
  });
  assert.equal(joinSeqRef.current, seqBeforeLeave + 1);
  assert.equal(lifecycleRoom.activeRoomCode, null);
  assert.deepEqual(roomStateLog.at(-1), { code: null, peerCount: 0 });
  assert.equal(clearedHashArg, null);

  // Incoming share URL joins room and loads matched sample
  const incomingLoaded = [];
  const incomingClearCalls = [];
  await handleIncomingShareUrlAction(shareUrl, {
    realtimeRoom: lifecycleRoom,
    auth,
    coopJoinSeqRef: joinSeqRef,
    onSetRoomState: (code, peers) => roomStateLog.push({ code, peerCount: peers.length }),
    loadSampleFromPrebakedOrGenerate: async (sample, filled, _painted, free, _cfg, epoch) => {
      incomingLoaded.push({ id: sample.id, filled, free, epoch });
    },
    clearShareHash: (code) => incomingClearCalls.push(code),
  });
  assert.equal(lifecycleRoom.activeRoomCode, 'CAPY99');
  assert.equal(incomingLoaded.length, 1);
  assert.equal(incomingLoaded[0].id, sample0.id);
  assert.deepEqual(incomingLoaded[0].filled, [101]);
  assert.equal(incomingLoaded[0].free, true);
  assert.equal(incomingLoaded[0].epoch, 2);
  assert.equal(incomingClearCalls[0], 'CAPY99');

  // buildCoopProgressDelta sanity
  const builtDelta = buildCoopProgressDelta({
    sourceRef: { kind: 'sample', uri: sample0.assetPath },
    filledRegionIds: new Set([101]),
    paintedRegionColors: new Map([[101, 2]]),
    isFreeColorMode: true,
    resetEpoch: 3,
    updatedAt: 12345,
  });
  assert.deepEqual(builtDelta, {
    version: 2,
    sourceRef: { kind: 'sample', uri: sample0.assetPath },
    filledRegionIds: [101],
    paintedRegionColors: { 101: 2 },
    isFreeColor: true,
    resetEpoch: 3,
    updatedAt: 12345,
  });

  // 8. SSR smoke render of useCoopSession inside ProviderContextProvider
  let hookSnapshot = null;
  function TestHarness() {
    const res = useCoopSession({
      puzzle,
      activeSnapshotId: 'snap-ssr',
      activeSave: {
        id: 'snap-ssr',
        title: sample0.title,
        sampleAssetPath: sample0.assetPath,
        resetEpoch: 0,
      },
      activeTitle: sample0.title,
      filledRegionIds: new Set([101]),
      paintedRegionColors: new Map(),
      isFreeColorMode: false,
      hapticsEnabled: true,
      liveCoopRef,
      viewportRef: { current: { zoomScale: 1, panOffsetX: 0, panOffsetY: 0 } },
      regionByIdRef: { current: regionById },
      loadSampleFromPrebakedOrGenerate: async () => {},
      markTutorialActionTried: () => {},
      setFilledRegionIds: () => {},
      setPaintedRegionColors: () => {},
      setActiveColorId: () => {},
      setSnapshots: () => {},
    });
    hookSnapshot = {
      hasRippleBuffer: typeof res.coopRippleBuffer?.spawn === 'function',
      canShareActiveLink: res.canShareActiveLink,
      hasEmitPaint: typeof res.emitCoopPaint === 'function',
      hasEmitUnfill: typeof res.emitCoopUnfill === 'function',
      hasHost: typeof res.handleHostCoopRoom === 'function',
      hasJoin: typeof res.handleJoinCoopRoom === 'function',
      hasLeave: typeof res.handleLeaveCoopRoom === 'function',
      hasInvite: typeof res.handleCopyCoopInviteLink === 'function',
    };
    return React.createElement('div', null, res.canShareActiveLink ? 'shareable' : 'local');
  }
  const ssrHtml = renderToStaticMarkup(
    React.createElement(
      ProviderContextProvider,
      {
        value: {
          auth,
          realtimeRoom: makeMockRealtimeRoom(null),
          cloudSave: {},
          catalog: {},
        },
      },
      React.createElement(TestHarness)
    )
  );
  assert.equal(ssrHtml, '<div>shareable</div>');
  assert.deepEqual(hookSnapshot, {
    hasRippleBuffer: true,
    canShareActiveLink: true,
    hasEmitPaint: true,
    hasEmitUnfill: true,
    hasHost: true,
    hasJoin: true,
    hasLeave: true,
    hasInvite: true,
  });

  // 9. Static source guardrails
  const hookSrc = fs.readFileSync(
    path.join(projectRoot, 'src/hooks/useCoopSession.ts'),
    'utf8'
  );
  const appSrc = fs.readFileSync(path.join(projectRoot, 'src/App.tsx'), 'utf8');

  assert.equal(
    /\blocalStorage\b/.test(hookSrc),
    false,
    'useCoopSession.ts must not access localStorage directly'
  );
  assert.equal(
    /\bProviderRegistry\b/.test(hookSrc),
    false,
    'useCoopSession.ts must use ProviderContext hooks instead of ProviderRegistry global'
  );
  assert.ok(
    hookSrc.includes('useRealtimeRoomProvider') && hookSrc.includes('useAuthProvider'),
    'useCoopSession.ts must wire useRealtimeRoomProvider and useAuthProvider'
  );
  assert.ok(
    hookSrc.includes('reportSwallowed'),
    'useCoopSession.ts must report swallowed errors via reportSwallowed'
  );
  assert.equal(
    /catch\s*\{/.test(hookSrc),
    false,
    'useCoopSession.ts must not contain silent parameterless catch blocks'
  );
  assert.ok(
    appSrc.includes('useCoopSession'),
    'App.tsx must consume useCoopSession'
  );
  assert.equal(
    /ProviderRegistry\.realtimeRoom/.test(appSrc),
    false,
    'App.tsx must not access ProviderRegistry.realtimeRoom directly after extraction'
  );

  console.log('      PASS: Co-op Session hook unit tests verified.');
}
