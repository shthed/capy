# Changelog Fragments (`.changelog/`)

Feature and bugfix pull requests targeting `beta` (or `main` on public forks) should drop a tiny single-fragment Markdown file here instead of editing [`CHANGELOG.md`](../CHANGELOG.md) or bumping [`web/package.json`](../web/package.json) on every PR. This prevents merge and version-number conflicts across parallel branches and keeps version releases batched to roughly one release per day (or per `beta -> main` promotion) instead of one version per PR.

## Fragment Format

Create `.changelog/<short-slug>.md` with YAML frontmatter followed by a single-line plain-English summary in imperative mood (**1--2 concise sentences max, `<= 320` characters**, no nested bullets, trailing period, or PR links):

```markdown
---
bump: patch
---
Describe the player-facing change or fix in one or two concise sentences
```

### Frontmatter Fields

- **`bump`** *(required)*: `patch`, `minor`, or `major`.
- **`pr`** *(optional)*: Explicit PR number integer when known ahead of time; otherwise resolved from `--pr-map` or Git commit history at compile time.

## Compiling Fragments

Batch accumulated fragments roughly **once per day** or when promoting `beta -> main` from `web/`:

- **Daily / Beta compile** (`npm run changelog:compile`, implemented by [`web/scripts/compile-changelog.mjs`](../web/scripts/compile-changelog.mjs)): bumps `web/package.json` and `web/package-lock.json` once for the batch (Android `app/build.gradle.kts` reads `web/package.json` dynamically), prepends `### <ver> - <YYYY-MM-DD> (Beta)` to [`CHANGELOG.md`](../CHANGELOG.md) with leading relative PR links (`- [#NNN](../../pull/NNN) <1--2 sentence summary>`), removes `(Beta)` from prior headings, and deletes consumed fragments. Running `npm run changelog:compile` again on the **same `YYYY-MM-DD`** with `patch` fragments when the top heading already matches an unreleased `### <ver> - <YYYY-MM-DD> (Beta)` appends the new bullets directly into that heading without double-bumping the version (`minor`/`major` fragments or post-promotion `(Production, Beta)` headings always cut a new `(Beta)` version).
- **Production promotion** (`npm run changelog:compile -- --promote`): compiles any pending fragments, strips prior `(Production)` and `(Beta)` markers, and tags the top matching release heading with `(Production, Beta)`.
- **Release Notes Extractor** ([`.github/scripts/compile-changelog.mjs`](../.github/scripts/compile-changelog.mjs)): separate script invoked by [`.github/workflows/release.yml`](../.github/workflows/release.yml) on `v*.*.*` tags to extract the matching `CHANGELOG.md` section into GitHub Release notes.

`npm run test:sanity` validates `.changelog/` fragment syntax (`<= 320` chars, single line) and leading PR link formatting (`- [#NNN](../../pull/NNN)` or `- #NNN`). See [`PROJECT.md`](../PROJECT.md) and [`DEV.md`](../DEV.md) for full release and sanity-gate rules.
