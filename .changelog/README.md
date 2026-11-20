# Changelog Fragments (`.changelog/`)

Feature and bugfix pull requests targeting `beta` should drop a tiny single-fragment Markdown file here instead of editing [`CHANGELOG.md`](../CHANGELOG.md) or bumping [`web/package.json`](../web/package.json) on every PR. This prevents merge and version-number conflicts across parallel branches and keeps version releases batched to roughly one release per day (or per `beta -> main` promotion) instead of one version per PR.

## Fragment Format

Create `.changelog/<short-slug>.md` with YAML frontmatter followed by a single-line plain-English summary (**1--2 concise sentences max**, no nested bullets or trailing PR links):

```markdown
---
bump: patch
epic: EPIC-2
task: BUG-4
---
Describe the player-facing change or fix in one or two concise sentences.
```

### Frontmatter Fields

- **`bump`** *(required)*: `patch`, `minor`, or `major`.
- **`pr`** *(optional)*: Explicit PR number integer when known ahead of time; otherwise resolved from `--pr-map` or Git commit history at compile time.
- **`epic`** *(optional)*: Epic tag (`EPIC-1` through `EPIC-5`) for release-note grouping or audit clarity.
- **`task`** *(optional)*: Active [`TODO.md`](../TODO.md) heading identifier (for example `BUG-4` or `TASK-3.1b`) to delete automatically once compiled.

## Compiling Fragments

Batch accumulated fragments roughly **once per day** or when promoting `beta -> main` from `web/`:

- **Daily / Beta compile** (`npm run changelog:compile`): bumps `web/package.json` (and `app/build.gradle.kts` fallback version if static) once for the batch, prepends `### <ver> - <YYYY-MM-DD> (Beta)` to [`CHANGELOG.md`](../CHANGELOG.md) with leading clickable PR links (`- [#NNN](...) <1--2 sentence summary>`), removes `(Beta)` from prior headings, removes finished `task` sections from [`TODO.md`](../TODO.md), and deletes consumed fragments.
- **Production promotion** (`npm run changelog:compile -- --promote`): compiles any pending fragments, strips prior `(Production)` and `(Beta)` markers, and tags the top matching release heading with `(Production, Beta)`.

See [`PROJECT.md`](../PROJECT.md) and [`DEV.md`](../DEV.md) for full release and sanity-gate rules.
