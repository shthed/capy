# Coloring Screen & Controls Requirements

## 1. Scope and Overview
- Feature: Coloring gameplay screen for numbered color-by-art artworks and immediate controls.
- Platforms: iOS, Android, desktop web (responsive design). Native idioms per platform allowed; gameplay parity required.
- Personas: casual adult relaxers, kids with supervision, completionists, accessibility-focused users.
- Dependencies: artwork asset pipeline (line art + cell index), user profile service, hint economy, telemetry consent service, ad mediation SDK (rewarded), persistence layer, settings module.

## 2. Experience Goals
1. Frictionless coloring with responsive tap feedback (<16 ms perceived latency).
2. Delightful completion moment that rewards perseverance.
3. Accessible to low-vision and color-blind users via patterns and high contrast.
4. Maintain player momentum with unobtrusive monetization.
5. Recoverable sessions: never lose progress because of crashes or interruptions.

## 3. Screen Layout Specifications
- Viewport displays single artwork (vector or high-res bitmap). Default is fit-to-width with all controls visible.
- Pan & Zoom: two-finger pan and pinch between 10% and 800% scale. Double-tap toggles between fit-to-width and 200% zoom. When zooming, numbers scale smoothly; hide below 50% zoom replaced with heatmap dots.
- Top Bar:
  - **Back** (top-left). Pops to gallery; confirmation modal if unsaved progress.
  - **Title** center (artwork name). Optional progress subtitle.
  - **Menu** (top-right). Opens settings sheet (sound, notifications, remove ads, account, help).
- Overlay Controls (top-right floating stack): Hint, Eyedropper, Select-next, Settings. Spacing 12 dp; drop shadow 20%.
- Progress Ring (top-left overlay). Shows % complete, updates within 50 ms of paint event.
- Canvas uses tile rendering with 2× MSAA edges. Filled cells use flat color fill, optional pattern overlay if colorblind mode on.
- Palette Dock (bottom, full-width, 96 dp tall). Horizontal scroll list of swatches sorted ascending by color number.
  - Swatch anatomy: 56×56 dp tap target, color chip, number label, remaining counter badge.
  - Active swatch highlights with 4 dp accent border, accessible contrast ratio ≥ 3:1.
  - Grey out swatch when remaining = 0; optionally auto-advance to next incomplete swatch.
- Hint Counter: optional badge on Hint icon showing available hints.
- Tiny target finder button appears once any color has ≤10 remaining cells.

## 4. Interaction Requirements
### 4.1 Tap-to-Fill
- Hit-test finger location against cell index. Only fill if cell matches selected color and unfilled.
- Play 120 ms “pop” scale animation and soft haptic (if enabled) on success.
- On mismatch, flash red outline for ≤400 ms and vibrate (light). Log `tap_miss` event.

### 4.2 Drag Fill
- Touch-down enters drag mode when pointer moves >6 dp.
- Samples cell center along gesture path; fill contiguous matching cells.
- Non-matching cells remain unaffected.
- End-of-stroke groups filled cells into single undoable action.

### 4.3 Palette Interaction
- Tap to select swatch. VoiceOver announces “Color {n}, remaining {m}.”
- Long-press opens detail sheet: color name, hex value, remaining count, “find cells” toggle, preview of pattern if patterns enabled.
- Palette search input (magnifier icon) allows numeric entry to jump to swatch. Dismissible keyboard overlay.

### 4.4 Zoom & Pan
- Pinch zoom respects focus under fingers; double-tap toggles zoom states.
- Two-finger pan active when not painting; on stylus devices, stylus paints while two fingers pan.
- Provide inertial pan with friction 0.95 per frame.

### 4.5 Hints & Discovery
- Hint button: consumes hint credit, else prompts to watch ad or purchase pack.
- Effect: highlight up to 3 smallest remaining cells for active color within viewport; if none, auto-pan smoothly (<500 ms) to nearest cells.
- Highlight pulses at 3 Hz for 3 seconds; accessible alt uses outline instead of flashing when Reduce Motion on.

### 4.6 Selection Helpers
- Eyedropper picks color from filled cell if color not complete.
- Select-next cycles colors sorted by fewest remaining cells >0.
- Tiny target finder zooms to area containing micro-cells (<10 px²).

### 4.7 Undo/Redo
- Maintain single-level undo, optional redo. Undo last gesture (tap or drag) unless beyond last 10 autosave batches.
- Undo feedback: reverse animation, update counters, log `undo` event.

## 5. State & Persistence
- Autosave triggers after every 200 painted cells or 1 s debounce. Save includes: active color, viewport (pan/zoom), fill bitset, palette states.
- On resume, restore to previous viewport and color selection.
- Handle corrupt save by rolling back to last good autosave and informing user.
- Offline mode: cache all required assets before entering screen. Display offline banner if connectivity lost but assets available.

## 6. Completion Flow
1. Upon last cell fill, disable painting input.
2. Run 1 s reveal animation (unless Reduce Motion). With animation off, fade-in final artwork instantly.
3. Show completion modal with actions: Save to gallery, Share (OS share sheet), Replay animation, Continue (return to gallery).
4. Log `art_complete` event with metrics (duration, hints used, undo count).
5. Trigger celebratory audio (if sound enabled) and confetti (if allowed by settings).

## 7. Hint Economy & Monetization Hooks
- Hint count persists per user; free daily hints configurable.
- If no hints left, present rewarded ad dialog: “Watch ad to earn hint” with cancel option.
- Ads never appear while user actively painting. Only after completion or when user explicitly opts for rewarded ad.
- “Remove Ads” purchase accessible via settings; owning it suppresses interstitials and offers discounted hint bundles.

## 8. Accessibility Requirements
- Touch targets ≥44×44 dp. Palette and buttons support keyboard focus (tab order left-to-right).
- Screen reader: describe canvas context (“Artwork: {title}, {percent}% complete.”). Cells focus via directional pad highlight with bounding outline.
- High-contrast mode increases outline stroke width by 1.5× and darkens number text (#1A1A1A at 80% opacity minimum).
- Colorblind patterns toggle overlays pattern per color (stripe, dot, crosshatch). Patterns stored with palette metadata.
- Voice control commands: “Select color {n},” “Use hint,” “Undo,” “Show remaining cells.”
- Respect OS Reduce Motion and Reduce Transparency settings; degrade animations accordingly.

## 9. Performance & Quality Targets
- Cold load ≤1.5 s on mid-range 2019 hardware (A12, Snapdragon 730).
- Input-to-fill latency ≤16 ms at 60 Hz, ≤33 ms at 30 Hz. Drag fill maintains >30 fps up to 500k cells.
- Memory cap: ≤200 MB for canvas tiles at 1080p; implement tile streaming at high zoom to avoid spikes.
- Battery guard: when device temp >40°C, throttle optional animations and reduce confetti particle count by 50%.
- Frame drop monitoring: sample 1% of sessions capturing frame timing histogram (telemetry gated by consent).

## 10. Error Handling
- Missing asset → display modal: “Download failed. Retry / Exit.” Keep user on screen when retrying.
- Save conflict (multi-device) → choose most recent timestamp; offer merge if both partial (fill union) with warning.
- Network loss during rewarded ad → show toast “Ad unavailable. Try again later.”
- Hint highlight but no cells available → disable button and toast “All cells complete.”
- Undo stack overflow → show toast “Nothing to undo.”

## 11. Telemetry Events (opt-in)
- `session_start`, `session_end`
- `color_select`, `cell_fill`, `drag_fill`
- `hint_use` (payload: source {free, rewarded_ad, purchase})
- `color_complete` (payload: color_id, remaining_time)
- `art_complete` (payload: duration, hints_used, undo_count)
- `undo`, `redo`, `autosave`
- `tap_miss`
- Frame timing sample event for performance analysis.

## 12. QA Acceptance Criteria
| ID  | Scenario                               | Expected Result                                             |
|-----|----------------------------------------|-------------------------------------------------------------|
| T1  | Tap correct unfilled cell              | Cell fills instantly with animation and counter decrements. |
| T2  | Tap incorrect cell                     | Red outline + haptic warning, no fill.                      |
| T3  | Drag across 50 matching cells          | All matching cells fill, none outside path.                 |
| T4  | Drag crosses non-matching boundaries   | Boundary cells remain untouched.                            |
| T5  | Use hint with available credit         | Up to 3 cells highlight, counter decreases.                 |
| T6  | Use hint without credits               | Rewarded ad / purchase prompt appears.                      |
| T7  | Complete color                         | Confetti (unless disabled), auto-advance if enabled.        |
| T8  | Complete artwork                       | Reveal animation, completion modal, progress locked.        |
| T9  | Force quit mid-session                 | On relaunch, state restored (viewport, active color, fills).|
| T10 | Undo last action                       | Filled cells revert, counters increment accordingly.        |
| T11 | Reduce Motion enabled                  | Animations skipped or replaced with fades.                  |
| T12 | Screen reader navigation               | Announces controls and remaining counts correctly.          |
| T13 | Accessibility patterns on              | Patterns render clearly atop colors.                        |
| T14 | Palette search                         | Entering number focuses swatch even if off-screen.          |

## 13. Security & Privacy
- No PII collected during painting. Telemetry requires explicit opt-in.
- All network calls over HTTPS. No writes during gameplay aside from optional telemetry flushes.
- Rewarded ad SDK isolated; ensure compliance with COPPA/ GDPR for underage profiles.
- Handle parental gate before purchases if account flagged as child.

## 14. Localization & Content
- All strings externalized with placeholders. Numbers remain Arabic numerals.
- Support RTL layouts (mirror palette order, controls swap sides while respecting handedness setting).
- Font sizes scale with dynamic type; enforce minimum 10 sp at 100% zoom for numbers.

## 15. Open Questions
1. Should Select-next respect manual color order customization? (Default assumption: yes.)
2. Confirm maximum number of concurrent hint highlights per user segment.
3. Determine whether undo count should be limited per session or monetizable.
4. Define fallback when device lacks haptic engine (use sound only?).
5. Clarify offline behavior for rewarded ads (likely disable and show message).

## 16. Appendices
- Suggested data structures:
  - `CellIndex`: quadtree or run-length encoding per color id.
  - `FillState`: bitset segmented by color, chunked 256-cell blocks for memory efficiency.
  - `PaletteItem`: `{id:int, rgba:uint32, remaining:int, patterned:bool, name:string}`.
  - `Viewport`: `{scale:float, panX:int, panY:int}` persisted per artwork.
- Logging schema version 1.0. Include timestamps in UTC, device model, OS version (anonymized ID only if consented).

