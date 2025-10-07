# Capybara Springs Region Map

The Capybara Springs vignette pairs an orange-crowned capybara and its
dachshund companion in a twilight lagoon framed by mushrooms, reeds, and a
ribbon waterfall. The onboarding hint and Settings sheet expose Low/Medium/High
detail presets that re-run the generator with tuned palette counts and minimum
region sizes, but every preset ultimately resolves to the same underlying SVG
(`art/capybara-springs.svg`). That segmented source names each palette entry and
annotates every numbered cell so you can cross-reference gameplay captures,
exports, or QA transcripts with the original artwork.

## Detail presets at a glance

- **Low detail** – 18 colours, ≈26 regions. Keeps broad shoreline shapes intact so
  onboarding demos land quickly while still highlighting both characters.
- **Medium detail** – 26 colours, ≈42 regions. Preserves the capybara’s fur bands
  and lagoon reflections without overwhelming playtesters with tiny targets.
- **High detail** – 32 colours, ≈140 regions. Reveals mushroom caps, ripples, and
  background reeds for showcase captures or deep-dive QA passes.

Regardless of the preset, the region identifiers below remain stable. Exported
JSON and automation logs therefore map cleanly back to the SVG even as higher
detail runs subdivide the same silhouettes into more paintable regions.

## Palette overview

| # | Name | Hex | Notes |
| - | ---- | --- | ----- |
| 1 | Sunrise Sky | `#F6BF60` | Warm horizon bands that gradate from the waterfall mist into the morning light. |
| 2 | Amber Drift | `#F4994C` | The brighter sunrise streaks that sit just above the ridge line. |
| 3 | Violet Ridge | `#9A6BB3` | Distant hills silhouetted against the orange sky. |
| 4 | Forest Ridge | `#5D7A76` | Midground tree line framing the lagoon. |
| 5 | Lagoon Light | `#76C7D6` | Reflective surface of the upper lagoon with shimmering highlights. |
| 6 | Lagoon Depth | `#1C6F8C` | Deeper teal water layers closer to the camera. |
| 7 | Shore Left | `#4F7D5C` | Mossy foreground bank on the left side of the frame. |
| 8 | Shore Middle | `#6B9358` | Central shoreline cradle where the capybara rests. |
| 9 | Capy Body | `#7D5735` | Chestnut fur that wraps the capybara’s torso and shoulders. |
| 10 | Capy Head | `#5E3B24` | Deeper brown shading across the capybara’s face, ear, and snout. |
| 11 | Shore Right | `#3F5B3B` | Darkened right-bank vegetation fading toward the waterfall. |

## Region breakdown

| Region | Colour | Description |
| ------ | ------ | ----------- |
| c01 | Sunrise Sky | Uppermost sunrise arc sweeping from left to right, establishing the orange glow behind the waterfall. |
| c02 | Sunrise Sky | Second sunrise band that curves beneath c01, widening near the centre before tapering toward the right horizon. |
| c03 | Amber Drift | Left-side amber glow that bridges the sky into the ridgeline while hinting at distant mist. |
| c04 | Amber Drift | Right-side continuation of the amber band that lifts above the waterfall and echoes the rising sun. |
| c05 | Violet Ridge | Left-most ridge peaks catching lavender twilight at the horizon. |
| c06 | Violet Ridge | Central ridge mass sitting behind the capybara, subtly terraced to imply overlapping foothills. |
| c07 | Violet Ridge | Right ridge shelf anchoring the waterfall and framing the background capybaras. |
| c08 | Forest Ridge | Foreground tree canopy sweeping across the far-left shoreline with rounded pines and undergrowth. |
| c09 | Forest Ridge | Mid-lagoon treeline behind the main characters, softened to suggest morning haze. |
| c10 | Forest Ridge | Right-most stand of evergreens leading into the falls and distant capybara silhouettes. |
| c11 | Lagoon Light | First reflective water stripe where the sunrise meets the lagoon’s surface near the left shore. |
| c12 | Lagoon Light | Central highlight that mirrors the dog’s snout and the capybara’s shoulder. |
| c13 | Lagoon Light | Narrow right-hand reflection catching the waterfall’s spray. |
| c14 | Lagoon Light | Second tier of ripples drifting toward the viewer with a subtle cyan sheen. |
| c15 | Lagoon Light | Middle ripple directly beneath the capybara, foreshadowing the deeper teal troughs. |
| c16 | Lagoon Light | Final highlight across the far-right shallows before the water darkens. |
| c17 | Lagoon Depth | Upper teal layer marking the start of the deeper pool on the left bank. |
| c18 | Lagoon Depth | Companion band on the right that darkens toward the waterfall plunge. |
| c19 | Lagoon Depth | Lower teal plate gently curving toward the viewer beneath the capybara and dachshund. |
| c20 | Lagoon Depth | Deepest basin tracing the right-hand bank where the water gathers before spilling downstream. |
| c21 | Shore Left | Foreground moss and mushrooms on the left edge, including the scarlet caps beside the dog. |
| c22 | Shore Left | Left-bank slope rising toward the capybara’s back, sprinkled with grasses and dew. |
| c23 | Shore Middle | Central bank that the capybara reclines on—soft loam with a few reeds peeking around the companions. |
| c24 | Capy Body | Main torso mass of the orange-crowned capybara, wrapping from the back ridge down to the flank in warm fur. |
| c25 | Capy Head | Head, ear, and snout of the capybara including the orange perched citrus and friendly gaze toward the dachshund. |
| c26 | Shore Right | Dark right-bank foliage framing the waterfall and the watching capybaras in the distance. |

The detail presets do not change the SVG identifiers above, so exported JSON or
scripted sessions can always be reconciled with this reference regardless of how
many colours or regions the generator retains at runtime.
