## Summary

<!-- Describe what this PR changes for players or contributors and why in 1-3 plain-English sentences. -->

## Related Issue

<!-- Link the related issue, e.g. Closes #123 or Refs #123 (if applicable). -->

## Type of Change

- [ ] Bug fix
- [ ] New feature or enhancement
- [ ] Documentation update
- [ ] Build, CI, or test improvement

## Testing Performed

Run from `web/` (or `npm run test:sanity` for docs-only changes):

- [ ] `npm run test:sanity`
- [ ] `npm run lint` (`tsc` + `oxlint`)
- [ ] `npm run build`
- [ ] `npm run test:unit` and `npm run test:e2e:smoke` (or full `npm test`)
- [ ] `./gradlew app:buildWeb app:testDebugUnitTest app:assembleDebug` (if Android `app/` changed)

## Checklist

- [ ] My changes follow [CONTRIBUTING.md](https://github.com/shthed/capy/blob/main/CONTRIBUTING.md) and are scoped to a single concern.
- [ ] I added a concise 1--2 sentence [.changelog/](https://github.com/shthed/capy/blob/main/.changelog/README.md) fragment if this is a feature or bugfix PR.
- [ ] I updated relevant documentation if user-facing behavior or setup changed.
- [ ] I agree to license my contributions under [LICENSE.md](https://github.com/shthed/capy/blob/main/LICENSE.md) (CC BY-NC-SA 4.0 and the Capybara Chill Preamble).
