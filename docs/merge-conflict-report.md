# Merge Conflict Report: Zoom Guard Branch vs Main

## Overview
Merging the `Resolve zoom guard merge conflict logic` changeset into `main` tripped
a conflict in `index.html`. Both branches touched the zoom suppression logic inside
`installBrowserZoomGuards`, so Git could not automatically reconcile the differing
control flow.

## Conflict Location
The conflict centered on the wheel shortcut handler where the branch cached the
interactive and stage checks before cancelling the event, while `main` kept the
checks inline. GitHub showed the following opposing hunks:

```diff
-            if (isInteractiveElementForZoomGuard(event.target)) return;
-            if (isGameSurface(event.target)) return;
-            event.preventDefault();
+            const isInteractive = isInteractiveElementForZoomGuard(event.target);
+            const isStageTarget = isGameSurface(event.target);
+            if (isInteractive || isStageTarget) {
+              return;
+            }
+            event.preventDefault();
```

A similar disagreement appeared in the keyboard shortcut guard: the branch reused
the cached `isInteractive` check, whereas `main` repeated the inline helper.

## Branch Behaviour
In the branch, both wheel and keyboard handlers compute the interactive status
once and bail out early when the target is part of the canvas or other interactive
chrome. This ensures the browser never receives a preventDefault from palette
controls while still allowing the stage to zoom.

```js
const isInteractive = isInteractiveElementForZoomGuard(event.target);
const isStageTarget = isGameSurface(event.target);
if (isInteractive || isStageTarget) {
  return;
}
event.preventDefault();
```

```js
const isInteractive = isInteractiveElementForZoomGuard(event.target);
if (isInteractive) return;
```

## Mainline Behaviour
`main` preferred the inline helper checks, preserving its existing execution order.
It prevented the default action only when neither helper returned true and left
the keyboard handler with duplicate lookups.

## Resolution
We adopted the branch behaviour for both handlers so their control flow now
matches, caching the helper result once and exiting early for interactive targets.
This keeps palette inputs responsive while avoiding accidental browser zooming on
the stage. With the handlers sharing the same structure, the merge conflict is
resolved.
