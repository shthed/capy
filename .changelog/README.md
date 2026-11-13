# Changelog Fragments (`.changelog/`)

Lane A developer pull requests drop a tiny single-fragment Markdown file here instead of editing [`CHANGELOG.md`](../CHANGELOG.md) or bumping [`web/package.json`](../web/package.json) directly, preventing merge and version-number conflicts across parallel feature branches.

## Fragment Format

Create `.changelog/<short-slug>.md` with YAML frontmatter followed by a single-line plain-English summary:

```markdown
---
bump: patch
epic: EPIC-2
task: TASK-2.5
---
Describe the player-facing change or fix in one concise line
```

### Frontmatter Fields

- **`bump`** *(required)*: `patch`, `minor`, or `major`.
- **`pr`** *(optional)*: Explicit PR number integer when known ahead of time; otherwise resolved from `--pr-map` or Git commit history at compile time.
- **`epic`** *(optional)*: Epic tag (`EPIC-1` through `EPIC-5`) for release-note grouping or audit clarity.
- **`task`** *(optional)*: Active [`TODO.md`](../TODO.md) heading identifier (for example `TASK-2.5` or `BUG-4`) to delete automatically once compiled.

## Compiling Fragments

From `web/`, run the compiler:

- **Beta compile** (bumps `web/package.json`, `app/build.gradle.kts` fallback version if static, prepends `### <ver> - <YYYY-MM-DD> (Beta)` to [`CHANGELOG.md`](../CHANGELOG.md), removes `(Beta)` from prior headings, removes finished `task` sections from [`TODO.md`](../TODO.md), and deletes consumed fragments):
  `npm run changelog:compile`
- **Production promotion** (`npm run changelog:compile -- --promote`): compiles any pending fragments, strips prior `(Production)` and `(Beta)` markers, and tags the top matching release heading with `(Production, Beta)`.

See [`PROJECT.md`](../PROJECT.md) and [`DEV.md`](../DEV.md) for full release and sanity-gate rules.
