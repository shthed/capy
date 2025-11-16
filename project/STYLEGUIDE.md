# Capy CSS Style Guide

Capy’s runtime styles live in `styles.css` at the repository root. The only
inline CSS remaining in `index.html` is the preboot `:root` block that seeds
UI scale and viewport padding before first paint; everything else must stay in
`styles.css` to keep load order predictable for deployments and previews.

## File layout and load order

- **Single stylesheet.** Ship layout, theme tokens, and component styles from
  `styles.css`. Add new rules here instead of creating extra stylesheets so
  branch deployments only need to track a single CSS asset.
- **Preboot variables stay lean.** Keep `index.html`’s inline `:root` block
  limited to `--ui-scale-*` plus `--app-*` and rail padding variables. Any new
  tokens should move directly into `styles.css` unless they must be computed in
  the blocking head script.
- **Attribute-driven variants.** Prefer `data-theme`, `data-orientation`, and
  `data-compact-commands` selectors (already set before first paint) instead of
  injecting new inline styles at runtime.

## Tokens, naming, and structure

- **Custom properties first.** Introduce shared values as CSS variables (for
  example `--theme-sheet-border` or `--command-rail-top`) and reuse them across
  selectors. Co-locate new variables near related ones in `:root` or the
  `body[data-theme="light"]` override block.
- **Scoped selectors.** Keep selectors rooted on existing IDs and classes (for
  example `#commandRail`, `.menu-button`, `#modalSheet`) instead of element
  tags. This reduces the risk of accidental overrides inside the single-page
  shell.
- **Responsive rules.** Align media queries with the current breakpoints in
  `styles.css` (`max-width: 960px` for compact layouts, `max-width: 720px` for
  small viewports, etc.). Mirror the same custom properties inside media blocks
  when new components depend on screen size.
- **State classes.** Reuse the existing state hooks (`.hidden`, `.active`,
  `.disabled`, `.compact-commands`) and extend them when adding new UI states
  instead of introducing inline style toggles.

## Maintenance checklist

1. **Keep deployments in sync.** When adding new runtime assets (images,
   fonts, additional stylesheets), update `.github/workflows/deploy-branch.yml`
   so branch previews copy them alongside `index.html`, `styles.css`,
   `render.js`, `puzzle-generation.js`, and `capy.json`.
2. **Watch for flash-of-unstyled content.** If a change relies on new variables
   to size or position elements, confirm the preboot inline block remains
   sufficient to avoid layout jumps before `styles.css` loads.
3. **Test both themes.** Validate additions against `body[data-theme="dark"]`
   and `body[data-theme="light"]`, especially when adjusting text or border
   contrast.
4. **Prefer CSS over JS for layout tweaks.** Use classes and data attributes
   the runtime already toggles rather than mutating inline style strings.
5. **Document new tokens.** Add any notable variable additions or layout rules
   to `project/TECH.md` so future contributors know where to hook in.

## Local workflow tips

- Serve the repo root with `npm run dev` from `project/` and tweak `styles.css`
  directly; no bundler or preprocessor runs in this project.
- Use modern CSS features (custom properties, `color-scheme`, `accent-color`)
  where supported, but keep fallbacks for critical sizing or positioning values
  in the root variable set.
- Keep selectors readable and group related rules together (command rail,
  palette dock, modal sheets, viewport/canvas, utility classes) to reduce churn
  in large diffs.
