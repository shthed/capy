import { useEffect } from 'react';
import { useLatest } from './useLatest';
import {
  runSessionRestorePipeline,
  type SessionRestoreCallbacks,
  type SessionRestoreDeps,
} from '../services/sessionRestorePipeline';

export interface UseSessionRestoreOptions {
  callbacks: SessionRestoreCallbacks;
  deps?: Partial<SessionRestoreDeps>;
}

/**
 * Thin React hook that runs the 4-phase app-launch session restore pipeline once
 * on mount, wiring `AbortController` cleanup on unmount and `useLatest` stability.
 */
export function useSessionRestore({ callbacks, deps }: UseSessionRestoreOptions): void {
  const callbacksRef = useLatest(callbacks);
  const depsRef = useLatest(deps);

  useEffect(() => {
    const controller = new AbortController();
    const latestCallbacks: SessionRestoreCallbacks = {
      getSettings: () => callbacksRef.current.getSettings(),
      getTransitionSeq: () => callbacksRef.current.getTransitionSeq(),
      nextCoopJoinSeq: () => callbacksRef.current.nextCoopJoinSeq(),
      getCoopJoinSeq: () => callbacksRef.current.getCoopJoinSeq(),
      getActiveBlobUrl: () => callbacksRef.current.getActiveBlobUrl(),
      setActiveBlobUrl: (url) => callbacksRef.current.setActiveBlobUrl(url),
      resolveSnapshotImageSrc: (snap) => callbacksRef.current.resolveSnapshotImageSrc(snap),
      loadArtworkFromImage: (...args) => callbacksRef.current.loadArtworkFromImage(...args),
      clearPendingViewportSave: () => callbacksRef.current.clearPendingViewportSave(),
      onApplyViewport: (view) => callbacksRef.current.onApplyViewport(view),
      onSetSnapshots: (next) => callbacksRef.current.onSetSnapshots(next),
      onSetPaintedRegionColors: (painted) => callbacksRef.current.onSetPaintedRegionColors(painted),
      onSetSettings: (updater) => callbacksRef.current.onSetSettings(updater),
      onUpdateSettings: (updater) => callbacksRef.current.onUpdateSettings(updater),
      onSetSourceImage: (img) => callbacksRef.current.onSetSourceImage(img),
      onSetPuzzle: (puzzle) => callbacksRef.current.onSetPuzzle(puzzle),
      onSetActiveSnapshotId: (id) => callbacksRef.current.onSetActiveSnapshotId(id),
      onSetActiveColorId: (id) => callbacksRef.current.onSetActiveColorId(id),
      onUpdateLiveCoop: (patch) => callbacksRef.current.onUpdateLiveCoop(patch),
      onSetFilledRegionIds: (filled) => callbacksRef.current.onSetFilledRegionIds(filled),
      onSyncUndoStack: (entries) => callbacksRef.current.onSyncUndoStack(entries),
      onSyncRedoStack: (entries) => callbacksRef.current.onSyncRedoStack(entries),
      onSetHintRegionId: (id) => callbacksRef.current.onSetHintRegionId(id),
      onResetActivePuzzleSessionStats: (id, isComplete) =>
        callbacksRef.current.onResetActivePuzzleSessionStats(id, isComplete),
      onSetIsLoading: (loading) => callbacksRef.current.onSetIsLoading(loading),
      onStartReplay: (orderedIds, isPostLoad) =>
        callbacksRef.current.onStartReplay(orderedIds, isPostLoad),
      onSetShowTutorial: (show) => callbacksRef.current.onSetShowTutorial(show),
      onSetCoopRoomState: (roomCode, participants) =>
        callbacksRef.current.onSetCoopRoomState(roomCode, participants),
    };

    void runSessionRestorePipeline({
      signal: controller.signal,
      callbacks: latestCallbacks,
      deps: depsRef.current,
    });

    return () => {
      controller.abort();
    };
  }, [callbacksRef, depsRef]);
}
