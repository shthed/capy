# Merge Conflict Report: Zoom Guard Branch vs Main

## Overview
Merging the `Resolve zoom guard merge conflict logic` changeset into `main` trips a
conflict in `index.html`. Both branches touched the zoom suppression logic inside
`installBrowserZoomGuards`, so Git cannot automatically reconcile the differing
control flow.

## Conflict Location
The conflict centers on the wheel shortcut handler where the branch caches the
interactive and stage checks before cancelling the event, while `main` keeps the
checks inline. GitHub shows the following opposing hunks:

```diff
<<<<<<< ours
-            if (isInteractiveElementForZoomGuard(event.target)) return;
-            if (isGameSurface(event.target)) return;
-            event.preventDefault();
=======
+            const isInteractive = isInteractiveElementForZoomGuard(event.target);
+            event.preventDefault();
+            if (isInteractive || isGameSurface(event.target)) {
+              return;
+            }
>>>>>>> main
```

A similar disagreement appears in the keyboard shortcut guard: the branch reuses
the cached `isInteractive` check, whereas `main` repeats the inline helper.

## Branch Behaviour
In the branch, both wheel and keyboard handlers compute the interactive status
once and bail out early only when the target is part of the canvas. This ensures
the browser never receives a preventDefault from palette controls while still
allowing the stage to zoom.

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
`main` prefers the inline helper checks, preserving its existing execution order.
It prevents the default action only when neither helper returns true and leaves
the keyboard handler with duplicate lookups.

## Resolution Suggestion
Choose a single execution order for both branches. Either lift the helper result
into a cached boolean (branch approach) or keep the inline checks (main approach)
but match their guard order in both handlers. Once the handlers share the same
structure, the conflict will disappear.
