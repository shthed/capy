---
bump: patch
---
Extracted undo/redo history management and animated replay playback from App.tsx into dedicated useUndoRedo and useReplayController hooks with pure transition and zero-allocation viewport-follow helpers plus fast unit tests
