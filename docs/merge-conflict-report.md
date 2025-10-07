# Merge Conflict Report: Zoom Guard Branch vs Main

## Overview
Merging the zoom guard updates into `main` previously raised a conflict in `index.html`.
Both branches adjusted the keyboard and wheel shortcut suppression inside
`installBrowserZoomGuards`, so Git could not reconcile the ordering differences on its
own.

## Conflict Location
The disagreement lived in the wheel shortcut handler. One side cached the interactive and
stage checks before calling `preventDefault`, while the other invoked the helpers inline.
A matching pattern appeared in the keyboard handler, where one side reused the cached
boolean and the other re-ran the helper check.

## Resolution
We now settle on a shared structure for both handlers:

- Cache `isInteractiveElementForZoomGuard(event.target)` once at the top.
- Return early for interactive UI controls.
- Let canvas targets fall through so the stage-specific handlers own zooming.
- Call `event.preventDefault()` only when the browser shortcut should be cancelled.

With both handlers following the same control flow, the merge conflict is resolved and the
browser zoom guards behave consistently across keyboard and wheel shortcuts.
