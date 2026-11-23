/**
 * [Unit 02] SemVer parity, <2s sanity.mjs gate, CHANGELOG contract, release channels & Epic naming.
 * [Unit 14] .github/scripts/compile-changelog.mjs release note extraction & release.yml wiring.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  runSanityChecks,
  validateChangelogChannelOrder,
  validateEpicNaming,
  /* capy-dev-only:start */
  validateNoLegacyPrRubric,
  validatePrReadinessChecklist,
  validatePrReadinessSpec,
  /* capy-dev-only:end */
  validateRootGuideIndex,
} from '../../sanity.mjs';

export async function runSanityChangelogTests({ vite, projectRoot, webPkgJson, logUnitStart, logUnitPass }) {
    logUnitStart('Testing SemVer parity, <2s sanity.mjs gate, CHANGELOG contract & release channels...');
    const sanityRes = runSanityChecks({ repoRoot: path.resolve(projectRoot, '..') });
    assert.equal(sanityRes.elapsedMs < 2000, true, `sanity.mjs must run in < 2s (${sanityRes.elapsedMs}ms)`);
    const versionMod = await vite.ssrLoadModule('/src/version.ts');
    const semverParts = versionMod.parseSemVer(versionMod.APP_VERSION);
    assert.equal(
      versionMod.APP_VERSION_CODE,
      semverParts.major * 10000 + semverParts.minor * 100 + semverParts.patch,
      'APP_VERSION_CODE must equal MAJOR * 10000 + MINOR * 100 + PATCH'
    );
    const changelogPath = path.resolve(projectRoot, '..', 'CHANGELOG.md');
    assert.equal(fs.existsSync(changelogPath), true, 'CHANGELOG.md must exist at repository root');
    const changelogText = fs.readFileSync(changelogPath, 'utf8');
    assert.equal(
      changelogText.startsWith('### '),
      true,
      'CHANGELOG.md must start directly on line 1 with a compact ### version heading (no preamble)'
    );
    assert.equal(
      /^#{1,2}\s+/m.test(changelogText),
      false,
      'CHANGELOG.md must not contain oversized # or ## headings'
    );
    const majorMinor = `${semverParts.major}.${semverParts.minor}`;
    const currentVersionHeadingRe = new RegExp(
      `^### (?:${versionMod.APP_VERSION.replace(/\./g, '\\.')}|${majorMinor.replace(/\./g, '\\.')}) - \\d{4}-\\d{2}-\\d{2} \\((?:Alpha|Beta|Production|Production, Beta)\\)$`,
      'm'
    );
    assert.equal(
      currentVersionHeadingRe.test(changelogText),
      true,
      `CHANGELOG.md must contain a compact ### release heading with active channel marker for ${versionMod.APP_VERSION} or ${majorMinor}`
    );
    const changelogHeadings = changelogText.split('\n').filter((line) => line.startsWith('#'));
    let productionHeadingCount = 0;
    let betaHeadingCount = 0;
    let alphaHeadingCount = 0;
    for (const heading of changelogHeadings) {
      assert.equal(
        /^### \d+\.\d+(?:\.\d+)? - \d{4}-\d{2}-\d{2}(?: \((?:Alpha|Beta|Production|Production, Beta)\))?$/.test(
          heading
        ),
        true,
        `Each CHANGELOG.md heading must be concise "### X.Y[.Z] - YYYY-MM-DD [(Alpha|Beta|Production|Production, Beta)]": ${heading}`
      );
      if (/\((?:Production|Production, Beta)\)$/.test(heading)) productionHeadingCount += 1;
      if (/\((?:Beta|Production, Beta)\)$/.test(heading)) betaHeadingCount += 1;
      if (/\(Alpha\)$/.test(heading)) alphaHeadingCount += 1;
    }
    assert.equal(
      productionHeadingCount,
      1,
      `CHANGELOG.md must mark exactly 1 active Production release heading, got ${productionHeadingCount}`
    );
    assert.equal(
      betaHeadingCount <= 1,
      true,
      `CHANGELOG.md must mark at most 1 active Beta release heading, got ${betaHeadingCount}`
    );
    assert.equal(
      alphaHeadingCount <= 1,
      true,
      `CHANGELOG.md must mark at most 1 active Alpha release heading, got ${alphaHeadingCount}`
    );
    assert.equal(
      changelogText.includes('### 0.1.0 - '),
      true,
      'CHANGELOG.md must include retrospective 0.1.0--0.9.x release history'
    );

    // Release channel path/origin/query resolution checks
    const stableCh = versionMod.resolveReleaseChannel('/capy/', 'https://shthed.github.io', '');
    assert.equal(stableCh.channel, 'stable');
    assert.equal(stableCh.badgeLabel, null);
    assert.equal(stableCh.prNumber, null);
    assert.equal(stableCh.stableWebUrl, 'https://shthed.github.io/capy/');
    assert.equal(stableCh.betaWebUrl, 'https://shthed.github.io/capy/beta/');
    assert.equal(stableCh.betaApkUrl, 'https://shthed.github.io/capy/beta/capy.apk');
    assert.equal(stableCh.showChannelSwitcher, true);

    const betaCh = versionMod.resolveReleaseChannel('/capy/beta/', 'https://shthed.github.io', '');
    assert.equal(betaCh.channel, 'beta');
    assert.equal(betaCh.badgeLabel, 'BETA');
    assert.equal(betaCh.prNumber, null);
    assert.equal(betaCh.showChannelSwitcher, true);

    const alphaCh = versionMod.resolveReleaseChannel(
      '/capy/alpha/481/',
      'https://shthed.github.io',
      ''
    );
    assert.equal(alphaCh.channel, 'alpha');
    assert.equal(alphaCh.badgeLabel, 'ALPHA #481');
    assert.equal(alphaCh.prNumber, 481);
    assert.equal(alphaCh.showChannelSwitcher, true);

    const alphaBranchCh = versionMod.resolveReleaseChannel(
      '/capy/alpha/feature-x/',
      'https://shthed.github.io',
      ''
    );
    assert.equal(alphaBranchCh.channel, 'alpha');
    assert.equal(alphaBranchCh.badgeLabel, 'ALPHA');
    assert.equal(alphaBranchCh.prNumber, null);
    assert.equal(alphaBranchCh.showChannelSwitcher, true);

    const legacyPrCh = versionMod.resolveReleaseChannel(
      '/capy/PR/481/',
      'https://shthed.github.io',
      ''
    );
    assert.equal(legacyPrCh.channel, 'alpha');
    assert.equal(legacyPrCh.badgeLabel, 'ALPHA #481');
    assert.equal(legacyPrCh.prNumber, 481);

    const legacyPullCh = versionMod.resolveReleaseChannel(
      '/capy/pull/481/',
      'https://shthed.github.io',
      ''
    );
    assert.equal(legacyPullCh.channel, 'alpha');
    assert.equal(legacyPullCh.badgeLabel, 'ALPHA #481');
    assert.equal(legacyPullCh.prNumber, 481);

    const devCh = versionMod.resolveReleaseChannel('/', 'http://localhost:3000', '');
    assert.equal(devCh.channel, 'dev');
    assert.equal(devCh.badgeLabel, null);
    assert.equal(devCh.showChannelSwitcher, true);

    const customDomCh = versionMod.resolveReleaseChannel('/', 'https://capypaint.com', '');
    assert.equal(customDomCh.channel, 'stable');
    assert.equal(customDomCh.badgeLabel, null);
    assert.equal(customDomCh.stableWebUrl, 'https://capypaint.com/');
    assert.equal(customDomCh.showChannelSwitcher, false);

    const wwwDomCh = versionMod.resolveReleaseChannel('/', 'https://www.capypaint.com', '');
    assert.equal(wwwDomCh.channel, 'stable');
    assert.equal(wwwDomCh.showChannelSwitcher, false);

    const androidDomCh = versionMod.resolveReleaseChannel(
      '/assets/www/index.html',
      'https://appassets.androidplatform.net',
      ''
    );
    assert.equal(androidDomCh.channel, 'stable');
    assert.equal(androidDomCh.showChannelSwitcher, false);

    const customDomForcedBeta = versionMod.resolveReleaseChannel(
      '/',
      'https://capypaint.com',
      '?capy_channel=beta'
    );
    assert.equal(customDomForcedBeta.channel, 'beta');
    assert.equal(customDomForcedBeta.showChannelSwitcher, true);

    const queryBetaCh = versionMod.resolveReleaseChannel(
      '/',
      'http://localhost:3000',
      '?capy_channel=beta'
    );
    assert.equal(queryBetaCh.channel, 'beta');
    assert.equal(queryBetaCh.badgeLabel, 'BETA');

    const queryAlphaCh = versionMod.resolveReleaseChannel(
      '/',
      'http://localhost:3000',
      '?capy_channel=alpha&pr=481'
    );
    assert.equal(queryAlphaCh.channel, 'alpha');
    assert.equal(queryAlphaCh.badgeLabel, 'ALPHA #481');
    assert.equal(queryAlphaCh.prNumber, 481);

    const typesMod = await vite.ssrLoadModule('/src/types/index.ts');
    assert.equal(typesMod.computeProgressPercentage(0, 0), 0);
    assert.equal(typesMod.computeProgressPercentage(0, 100), 0);
    assert.equal(typesMod.computeProgressPercentage(50, 100), 50);
    assert.equal(typesMod.computeProgressPercentage(996, 1000), 99);
    assert.equal(typesMod.computeProgressPercentage(999, 1000), 99);
    assert.equal(typesMod.computeProgressPercentage(1000, 1000), 100);
    assert.equal(typesMod.computeProgressPercentage(-5, 100), 0);
    assert.equal(typesMod.computeProgressPercentage(105, 100), 100);
    assert.equal(typesMod.computeProgressPercentage(10, -5), 0);
    assert.equal(typesMod.computeProgressPercentage(10, Number.NaN), 0);
    assert.equal(typesMod.computeProgressPercentage(Number.NaN, 100), 0);

    assert.equal(
      /^[ \t]+-\s+/m.test(changelogText),
      false,
      'CHANGELOG.md must not contain nested sub-bullets'
    );
    const changelogBullets = changelogText.split('\n').filter((line) => line.startsWith('- '));
    assert.equal(
      changelogBullets.length >= 398,
      true,
      `Expected >= 398 single-line PR bullets in CHANGELOG.md, got ${changelogBullets.length}`
    );
    let changelogBulletRe = /^- (?:\[#\d+\]\(\.\.\/\.\.\/pull\/\d+\)|#\d+)\s+\S/;
    /* capy-dev-only:start */
    changelogBulletRe = /^- \[#\d+\]\(\.\.\/\.\.\/pull\/\d+\)\s+\S/;
    /* capy-dev-only:end */
    for (const bullet of changelogBullets) {
      assert.equal(
        changelogBulletRe.test(bullet),
        true,
        `Each CHANGELOG.md bullet must start with a valid PR reference: ${bullet}`
      );
    }

    // 5b. Chronological changelog, Epic naming, dynamic guide indexing, and CI cleanup script unit checks
    const validBetaChangelog = [
      '### 3.0.3 - 2026-11-13 (Beta)',
      '',
      '- Beta item #493',
      '',
      '### 3.0.2 - 2026-11-13',
      '',
      '- Prior beta item #490',
      '',
      '### 3.0.1 - 2026-11-12 (Production)',
      '',
      '- Prod item #488',
      '',
      '### 2.7 - 2026-11-12',
      '',
      '- Older item #484',
      '',
      '### 0.1.0 - 2026-10-01',
      '',
      '- Initial #1',
    ].join('\n');
    const betaOrderRes = validateChangelogChannelOrder(validBetaChangelog, '3.0.3', {
      enforceChannelOrder: true,
    });
    assert.equal(betaOrderRes.alphaIdx, -1);
    assert.equal(betaOrderRes.betaIdx, 0);
    assert.equal(betaOrderRes.prodIdx, 2);

    const validAlphaBetaProd = [
      '### 3.1.0 - 2026-11-14 (Alpha)',
      '- Alpha #500',
      '### 3.0.3 - 2026-11-13 (Beta)',
      '- Beta #493',
      '### 3.0.1 - 2026-11-12 (Production)',
      '- Prod #488',
      '### 0.1.0 - 2026-10-01',
      '- Init #1',
    ].join('\n');
    const abpRes = validateChangelogChannelOrder(validAlphaBetaProd, '3.1.0', {
      enforceChannelOrder: true,
    });
    assert.equal(abpRes.alphaIdx, 0);
    assert.equal(abpRes.betaIdx, 1);
    assert.equal(abpRes.prodIdx, 2);

    const validCombinedProdBeta = [
      '### 3.0.1 - 2026-11-12 (Production, Beta)',
      '- Combined #488',
      '### 2.7 - 2026-11-11',
      '- Old #484',
    ].join('\n');
    const combinedRes = validateChangelogChannelOrder(validCombinedProdBeta, '3.0.1', {
      enforceChannelOrder: true,
    });
    assert.equal(combinedRes.betaIdx, 0);
    assert.equal(combinedRes.prodIdx, 0);

    const validProdOnly = [
      '### 3.0.1 - 2026-11-12 (Production)',
      '- Prod #488',
      '### 2.7 - 2026-11-11',
      '- Old #484',
    ].join('\n');
    assert.equal(
      validateChangelogChannelOrder(validProdOnly, '3.0.1', { enforceChannelOrder: true }).prodIdx,
      0
    );

    // Minor rollup heading (3.0) matches patch version 3.0.4
    const validMinorRollup = [
      '### 3.0 - 2026-11-13 (Beta)',
      '- Rollup #493',
      '### 2.5 - 2026-11-11 (Production)',
      '- Prod #483',
    ].join('\n');
    assert.equal(
      validateChangelogChannelOrder(validMinorRollup, '3.0.4', { enforceChannelOrder: true }).betaIdx,
      0
    );

    const crlfChangelogRes = validateChangelogChannelOrder(
      validBetaChangelog.replace(/\n/g, '\r\n'),
      '3.0.3',
      { enforceChannelOrder: true }
    );
    assert.equal(crlfChangelogRes.betaIdx, 0);
    assert.equal(crlfChangelogRes.prodIdx, 2);

    assert.throws(
      () =>
        validateChangelogChannelOrder(
          [
            '### 3.0 - 2026-11-13 (Beta)',
            '### 2.7 - 2026-11-12 (Alpha)',
            '### 2.5 - 2026-11-11 (Production)',
          ].join('\n'),
          '3.0.4',
          { enforceChannelOrder: true }
        ),
      /Alpha heading must appear first/
    );
    assert.throws(
      () =>
        validateChangelogChannelOrder(
          ['### 3.0 - 2026-11-13 (Production)', '### 2.7 - 2026-11-12 (Beta)'].join('\n'),
          '3.0.0',
          { enforceChannelOrder: true }
        ),
      /Beta heading must appear at or before Production/
    );
    assert.throws(
      () =>
        validateChangelogChannelOrder(
          [
            '### 3.0 - 2026-11-13 (Beta)',
            '### 2.8 - 2026-11-12 (Production)',
            '### 2.5 - 2026-11-11 (Beta)',
          ].join('\n'),
          '3.0.0',
          { enforceChannelOrder: true }
        ),
      /Expected <= 1 Beta heading|after Production/
    );
    assert.throws(
      () =>
        validateChangelogChannelOrder(
          [
            '### 3.0 - 2026-11-13 (Beta)',
            '### 2.8 - 2026-11-12 (Production)',
            '### 2.5 - 2026-11-11 (Alpha)',
          ].join('\n'),
          '3.0.0',
          { enforceChannelOrder: true }
        ),
      /Alpha heading must appear first|after Production/
    );
    assert.throws(
      () =>
        validateChangelogChannelOrder(
          ['### 3.0.1 - 2026-11-13 (Beta)', '### 3.0.2 - 2026-11-12 (Production)'].join('\n'),
          '3.0.1',
          { enforceChannelOrder: true }
        ),
      /strictly descending by version/
    );
    assert.throws(
      () =>
        validateChangelogChannelOrder(
          ['### 3.0 - 2026-11-13 (Beta)', '### 3.0.0 - 2026-11-12 (Production)'].join('\n'),
          '3.0.0',
          { enforceChannelOrder: true }
        ),
      /strictly descending by version/
    );
    assert.throws(
      () =>
        validateChangelogChannelOrder(
          ['### 3.0.2 - 2026-11-12 (Beta)', '### 3.0.1 - 2026-11-13 (Production)'].join('\n'),
          '3.0.2',
          { enforceChannelOrder: true }
        ),
      /non-increasing by date/
    );
    assert.throws(
      () =>
        validateChangelogChannelOrder(
          ['### 3.0.2 - 2026-11-13 (Beta)', '### 3.0.1 - 2026-11-12 (Production)'].join('\n'),
          '3.0.4',
          { enforceChannelOrder: true }
        ),
      /missing active channel heading for 3\.0\.4/
    );

    const validEpicUrl = 'https://github.com/' + 'capyboop/paint/issues/477';
    const validPrRef = '[' + '#482](' + 'https://github.com/' + 'capyboop/paint/pull/482)';
    validateEpicNaming(`See [EPIC-2](${validEpicUrl}), plain EPIC-2, and ${validPrRef}`, 'DEV.md');
    for (const badNum of ['476', '477', '480']) {
      assert.throws(
        () => validateEpicNaming(`Legacy #'${badNum}`.replace("'", ''), 'TODO.md'),
        /EPIC-N/
      );
    }
    const badIssueLink = '[' + '#481](' + 'https://github.com/' + 'capyboop/paint/issues/481)';
    assert.throws(() => validateEpicNaming(`Link ${badIssueLink}`, 'ROADMAP.md'), /EPIC-N/);
    const badRelIssueLink = '[' + '#500](' + '../../' + 'issues/500)';
    assert.throws(
      () => validateEpicNaming(badRelIssueLink, 'test.md'),
      /\[EPIC-N\]\(\.\.\/\.\.\/issues\/<num>\)/
    );
    const badCombinedEpic = '[EPIC-2 (' + '#477)](' + validEpicUrl + ')';
    assert.throws(() => validateEpicNaming(`Combined ${badCombinedEpic}`, 'GUIDE.md'), /EPIC-N/);
    const badUnlinkedCombinedEpic = '[EPIC-6 (#' + '481)]';
    assert.throws(() => validateEpicNaming(`Unlinked ${badUnlinkedCombinedEpic}`, 'ROADMAP.md'), /EPIC-N/);

    const tmpGuideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'capy-guide-index-'));
    try {
      const rootMdNames = [
        'README.md',
        'PROJECT.md',
        'DEV.md',
        'ROADMAP.md',
        'TODO.md',
        'WEB.md',
        'PUZZLE.md',
        'APP.md',
        'CLOUD.md',
        'TESTING.md',
        'CHANGELOG.md',
        'LICENSE.md',
      ];
      for (const name of rootMdNames) {
        fs.writeFileSync(path.join(tmpGuideDir, name), `# ${name}\n`, 'utf8');
      }
      const allLinks = rootMdNames.map((n) => `[${n}](./${n})`).join(' ');
      fs.writeFileSync(path.join(tmpGuideDir, 'README.md'), `# README\n${allLinks}\n`, 'utf8');
      fs.writeFileSync(path.join(tmpGuideDir, 'DEV.md'), `# DEV\n${allLinks}\n`, 'utf8');
      fs.writeFileSync(path.join(tmpGuideDir, 'PROJECT.md'), `# PROJECT\n${allLinks}\n`, 'utf8');
      const guideRes = validateRootGuideIndex(tmpGuideDir, { requireProjectMd: true });
      assert.equal(guideRes.hasProjectMd, true);
      assert.equal(guideRes.rootMdFiles.length, rootMdNames.length);

      fs.writeFileSync(
        path.join(tmpGuideDir, 'README.md'),
        `# README\n${allLinks.replace('./PROJECT.md', './OTHER.md')}\n`,
        'utf8'
      );
      assert.throws(
        () => validateRootGuideIndex(tmpGuideDir, { requireProjectMd: true }),
        /README\.md must link \.\/PROJECT\.md/
      );
      fs.writeFileSync(path.join(tmpGuideDir, 'README.md'), `# README\n${allLinks}\n`, 'utf8');

      fs.writeFileSync(
        path.join(tmpGuideDir, 'PROJECT.md'),
        `# PROJECT\n${allLinks.replace('./TESTING.md', './OTHER.md')}\n`,
        'utf8'
      );
      assert.throws(
        () => validateRootGuideIndex(tmpGuideDir, { requireProjectMd: true }),
        /PROJECT\.md must link \.\/TESTING\.md/
      );
      fs.writeFileSync(path.join(tmpGuideDir, 'PROJECT.md'), `# PROJECT\n${allLinks}\n`, 'utf8');

      fs.unlinkSync(path.join(tmpGuideDir, 'PROJECT.md'));
      assert.throws(
        () => validateRootGuideIndex(tmpGuideDir, { requireProjectMd: true }),
        /PROJECT\.md must exist/
      );
    } finally {
      fs.rmSync(tmpGuideDir, { recursive: true, force: true });
    }

    /* capy-dev-only:start */
    // Dev-only %-first PR Readiness Checklist & legacy rubric guards
    {
      const oneItem = validatePrReadinessChecklist(
        [
          '### PR Readiness Score: 100%',
          '',
          '<details>',
          '<summary>PR Readiness Checklist</summary>',
          '',
          '- **100%** **Docs Sync**: Verified.',
          '',
          '</details>',
        ].join('\n'),
        '1-item test'
      );
      assert.equal(oneItem.overallScore, 100);
      assert.equal(oneItem.itemCount, 1);
      assert.deepEqual(oneItem.itemScores, [100]);
      assert.equal(oneItem.summary, 'PR Readiness Checklist');

      const threeItems = validatePrReadinessChecklist(
        [
          '### PR Readiness Score: 95.5%',
          '',
          '<details>',
          '<summary>PR Readiness Checklist</summary>',
          '',
          '- [x] **100%** — **Functionality**: Verified.',
          '- **95.5%** — **Tests**: Verified.',
          '- 91% — **Docs**: Remaining follow-up noted.',
          '',
          '</details>',
        ].join('\n'),
        '3-item test'
      );
      assert.equal(threeItems.overallScore, 95.5);
      assert.equal(threeItems.itemCount, 3);
      assert.deepEqual(threeItems.itemScores, [100, 95.5, 91]);

      const sixItems = validatePrReadinessChecklist(
        [
          '### PR Readiness Score: 100%',
          '',
          '<details>',
          '<summary>PR Readiness Checklist</summary>',
          '',
          '- **100% Check 1**: Functionality verified.',
          '- **100% Check 2**: Automated tests passed.',
          '- **100% Check 3**: Zero-allocation invariants preserved.',
          '- **100% Check 4**: Mobile viewport verified.',
          '- **100% Check 5**: Docs synced.',
          '- **100% Check 6**: CI green.',
          '',
          '</details>',
        ].join('\n'),
        '6-item test'
      );
      assert.equal(sixItems.overallScore, 100);
      assert.equal(sixItems.itemCount, 6);

      const eightItemsFullPr = validatePrReadinessChecklist(
        [
          '## Summary',
          '',
          '- Improved color layout with Tailwind bg-amber-400/20 accents and clean checks.',
          '',
          '- **Beta**: https://capypaint.com/beta/',
          '- **Related PRs**: [#20](https://github.com/capyboop/paint/pull/20) [#100](https://github.com/capyboop/paint/pull/100)',
          '',
          '### PR Readiness Score: 99% (threshold >= 95%)',
          '',
          '<details>',
          '<summary>PR Readiness Checklist</summary>',
          '',
          '- **100%** — **Functionality & Edge Cases**: Verified.',
          '- **100%** — **Automated Tests**: Verified.',
          '- **100%** — **Performance & Golden Invariants**: Verified.',
          '- **100%** — **Accessibility & Mobile Layout**: Verified.',
          '- **100%** — **Android / Bridge Parity**: Verified.',
          '- **100%** — **Cloud Sync / Worker Safety**: Verified.',
          '- **95%** — **Docs & Changelog Sync**: Minor wording follow-up (-1%).',
          '- **100%** — **CI, Mergeability & Preview Verification**: Verified.',
          '',
          '</details>',
          '',
          'Ready with -1% docs polish follow-up.',
          '- [ ] Polish final release note wording in TODO follow-up.',
        ].join('\n'),
        '8-item PR body'
      );
      assert.equal(eightItemsFullPr.overallScore, 99);
      assert.equal(eightItemsFullPr.itemCount, 8);

      const prosePercentRes = validatePrReadinessChecklist(
        [
          '### PR Readiness Score: 97.5%',
          'All 100% of unit tests pass.',
          '',
          '<details>',
          '<summary>PR Readiness Checklist</summary>',
          '',
          '- **100%** — **Tests**: All unit checks pass.',
          '',
          '</details>',
        ].join('\n'),
        'prose 100% before details'
      );
      assert.equal(prosePercentRes.overallScore, 97.5);
      assert.equal(prosePercentRes.itemCount, 1);
      assert.deepEqual(prosePercentRes.itemScores, [100]);

      const thresholdProseRes = validatePrReadinessChecklist(
        [
          '### PR Readiness Score: 97.5%',
          'Threshold: 95% minimum; dropped 2.5% for docs follow-up.',
          '',
          '<details>',
          '<summary>PR Readiness Checklist</summary>',
          '',
          '- **97.5%** — **Docs**: Follow-up noted.',
          '',
          '</details>',
        ].join('\n'),
        'threshold prose before details'
      );
      assert.equal(thresholdProseRes.overallScore, 97.5);
      assert.equal(thresholdProseRes.itemCount, 1);
      assert.deepEqual(thresholdProseRes.itemScores, [97.5]);

      const fallbackProseRes = validatePrReadinessChecklist(
        [
          '### PR Readiness Score',
          'Overall: 96%',
          '',
          '<details>',
          '<summary>PR Readiness Checklist</summary>',
          '',
          '- **96%** — **Tests**: Verified.',
          '',
          '</details>',
        ].join('\n'),
        'fallback overall score below heading'
      );
      assert.equal(fallbackProseRes.overallScore, 96);
      assert.equal(fallbackProseRes.itemCount, 1);

      const minParenRes = validatePrReadinessChecklist(
        [
          '### PR Readiness Score: 97.5% (min 95%)',
          '',
          '<details>',
          '<summary>PR Readiness Checklist</summary>',
          '',
          '- **100%** — **Checks**: Passed.',
          '',
          '</details>',
        ].join('\n'),
        'min 95% parenthetical on heading'
      );
      assert.equal(minParenRes.overallScore, 97.5);

      const unicodeGteRes = validatePrReadinessChecklist(
        [
          '### PR Readiness Score: 97.5% (≥ 95%)',
          '',
          '<details>',
          '<summary>PR Readiness Checklist</summary>',
          '',
          '- **100%** — **Checks**: Passed.',
          '',
          '</details>',
        ].join('\n'),
        'unicode >= 95% threshold after heading score'
      );
      assert.equal(unicodeGteRes.overallScore, 97.5);

      const unicodeGteBeforeRes = validatePrReadinessChecklist(
        [
          '### PR Readiness Score (≥ 95%): 97.5%',
          '',
          '<details>',
          '<summary>PR Readiness Checklist</summary>',
          '',
          '- **100%** — **Checks**: Passed.',
          '',
          '</details>',
        ].join('\n'),
        'unicode >= 95% threshold before heading score'
      );
      assert.equal(unicodeGteBeforeRes.overallScore, 97.5);

      const trailingBoldNoteRes = validatePrReadinessChecklist(
        [
          '### PR Readiness Score: 99%',
          '',
          '<details>',
          '<summary>PR Readiness Checklist</summary>',
          '',
          '- **99%** — **Verification**: Passed.',
          '',
          '</details>',
          '',
          '**PR Readiness Note**: All done.',
        ].join('\n'),
        'trailing bold PR Readiness note'
      );
      assert.equal(trailingBoldNoteRes.overallScore, 99);
      assert.equal(trailingBoldNoteRes.itemCount, 1);
      assert.deepEqual(trailingBoldNoteRes.itemScores, [99]);

      const trailingHeadingRes = validatePrReadinessChecklist(
        [
          '### PR Readiness Score: 98%',
          '',
          '<details>',
          '<summary>PR Readiness Checklist</summary>',
          '',
          '- **98%** — **Checks**: Passed.',
          '',
          '</details>',
          '',
          '### PR Readiness Follow-Up',
          'None.',
        ].join('\n'),
        'trailing PR Readiness heading'
      );
      assert.equal(trailingHeadingRes.overallScore, 98);
      assert.equal(trailingHeadingRes.itemCount, 1);

      const multilineCommentRes = validatePrReadinessChecklist(
        [
          '### PR Readiness Score: 100%',
          '',
          '<details>',
          '<summary>PR Readiness Checklist</summary>',
          '',
          '<!--',
          '  note',
          '-->',
          '- **100%** — **Checks**: Passed.',
          '',
          '</details>',
        ].join('\n'),
        'multiline HTML comment inside details'
      );
      assert.equal(multilineCommentRes.overallScore, 100);
      assert.equal(multilineCommentRes.itemCount, 1);
      assert.deepEqual(multilineCommentRes.itemScores, [100]);

      const detailsOpenRes = validatePrReadinessChecklist(
        [
          '### PR Readiness Score: 100%',
          '',
          '<details open><summary>PR Readiness Checklist</summary>',
          '',
          '- **100%** — **Checks**: Passed.',
          '',
          '</details>',
        ].join('\n'),
        'details open attribute'
      );
      assert.equal(detailsOpenRes.overallScore, 100);
      assert.equal(detailsOpenRes.itemCount, 1);
      assert.equal(detailsOpenRes.summary, 'PR Readiness Checklist');

      const nestedBoldBacktickRes = validatePrReadinessChecklist(
        [
          '### PR Readiness Score: 100%',
          '',
          '<details>',
          '<summary>PR Readiness Checklist</summary>',
          '',
          '- **`100%`** — **Tests**: Passed.',
          '',
          '</details>',
        ].join('\n'),
        'nested bold and backtick percentage'
      );
      assert.equal(nestedBoldBacktickRes.overallScore, 100);
      assert.equal(nestedBoldBacktickRes.itemCount, 1);
      assert.deepEqual(nestedBoldBacktickRes.itemScores, [100]);

      const sectionBulletRes = validatePrReadinessChecklist(
        [
          '### PR Readiness Score: 100%',
          '',
          '- 5 points to note in this release:',
          '',
          '<details>',
          '<summary>PR Readiness Checklist</summary>',
          '',
          '- **100%** — **Checks**: Passed.',
          '',
          '</details>',
        ].join('\n'),
        'unordered bullet inside PR Readiness section'
      );
      assert.equal(sectionBulletRes.overallScore, 100);
      assert.equal(sectionBulletRes.itemCount, 1);

      const makeInvalidSection = (bodyLines) =>
        ['### PR Readiness Score: 98%', '', '<details>', '<summary>PR Readiness Checklist</summary>', '', ...bodyLines, '', '</details>'].join('\n');

      for (const badText of [
        '### 5-Pillar PR Readiness Score: 100%\n\n<details>\n<summary>Checklist</summary>\n\n- **100%** — **Check**: Ok.\n\n</details>',
        '### 5 Pillar PR Readiness Score: 100%\n\n<details>\n<summary>Checklist</summary>\n\n- **100%** — **Check**: Ok.\n\n</details>',
        makeInvalidSection(['- **95/100** — **Check**: Legacy fraction.']),
        makeInvalidSection(['- **95 / 100** — **Check**: Legacy spaced fraction.']),
        makeInvalidSection(['- **20/20** — **Check**: Legacy category fraction.']),
        makeInvalidSection(['- **20 / 20** — **Check**: Legacy spaced category fraction.']),
        makeInvalidSection(['- **100%** — **Check (20 pts)**: Legacy pts.']),
        makeInvalidSection(['- **100%** — **Check (5 x 20)**: Legacy math.']),
        makeInvalidSection(['- **100%** — **Pillar 1**: Legacy pillar number.']),
        makeInvalidSection(['- **100%** — **Readiness Rubric**: Legacy rubric word.']),
        makeInvalidSection(['- **Functionality**: 100%']),
        makeInvalidSection(['1. Tests: 100%']),
        makeInvalidSection([]),
        makeInvalidSection(['- **105%** — **Bounds**: Out of range.']),
        '### PR Readiness Score: 105%\n\n<details>\n<summary>Checklist</summary>\n\n- **100%** — **Check**: Ok.\n\n</details>',
        '### PR Readiness Score: 100%\n\n- **100%** — **Check**: Missing details block.',
        '### 5-Pillars PR Readiness Score: 100%\n\n<details>\n<summary>Checklist</summary>\n\n- **100%** — **Check**: Ok.\n\n</details>',
        '### PR Readiness Score: >= 95%\n\n<details>\n<summary>Checklist</summary>\n\n- **100%** — **Check**: Ok.\n\n</details>',
        '### PR Readiness Score: ≥ 95%\n\n<details>\n<summary>Checklist</summary>\n\n- **100%** — **Check**: Ok.\n\n</details>',
        makeInvalidSection(['<!--', '  comment only', '-->']),
        makeInvalidSection(['- **100%**']),
        makeInvalidSection(['- 100%']),
        makeInvalidSection(['- [x] **100%**']),
        makeInvalidSection(['- **100%**:']),
        makeInvalidSection(['- **95%** — **Docs**: -5 points deduction.']),
        makeInvalidSection(['- **95%** — **Docs**: Deduction (- 5 points).']),
        makeInvalidSection(['- **95%** — **Docs**: Explain `-N point` delta.']),
        makeInvalidSection(['- **100%** — **Check**: 5-Pillars framework.']),
        makeInvalidSection(['- **100%** — **Check**: 20-point scale.']),
        makeInvalidSection(['- **100%** — **Check**: Worth **20** pts.']),
        [
          '### PR Readiness Score: 100%',
          '',
          '<!-- unclosed comment hides remaining markdown',
          '<details>',
          '<summary>PR Readiness Checklist</summary>',
          '',
          '- **100%** — **Check**: Hidden by unclosed comment.',
          '',
          '</details>',
        ].join('\n'),
        [
          '### PR Readiness Score: 100%',
          '',
          '<!-- closed comment -->',
          '<!-- unclosed trailing comment',
          '<details>',
          '<summary>PR Readiness Checklist</summary>',
          '',
          '- **100%** — **Check**: Hidden by second unclosed comment.',
          '',
          '</details>',
        ].join('\n'),
      ]) {
        assert.throws(() => validatePrReadinessChecklist(badText, 'negative fixture'));
      }

      // False-positive guards for legitimate URLs, Tailwind classes, dates, percentages, and Markdown bullets
      validateNoLegacyPrRubric(
        [
          '### Overview',
          '- 5 points to note in this release:',
          '  - 3 points on readability and accessibility.',
          '* 2 points for rollout timing.',
          'Review these 5 points before merging.',
          'Score: 98% (-2% docs, -5% follow-up).',
          'See https://github.com/capyboop/paint/pull/20 and https://github.com/capyboop/paint/pull/100',
          'Classes bg-amber-400/20 width="100%" ~15--20% 0.5x--20x 1/20th date 2026/01/20 100% offline per_page: 100',
        ].join('\n'),
        'false-positive-guard.md'
      );

      for (const badLegacyText of [
        'Deduction: -5 points for docs.',
        '- -5 points deducted for docs.',
        '* -5 points deducted for docs.',
        'Penalty (- 5 points) applied.',
        'Score adjusted by - 5 points after review.',
        'Describe gaps using `-N point` delta syntax.',
        'Use 5-Pillars scoring.',
        'Maximum 20-point scale.',
        'Worth **20** pts per category.',
        'Award `20` points per check.',
      ]) {
        assert.throws(
          () => validateNoLegacyPrRubric(badLegacyText, 'legacy-negative.md'),
          /Forbidden legacy/
        );
      }

      // Spec validation with requireProjectMd: false (main-branch mode)
      const tmpMainSpecDir = fs.mkdtempSync(path.join(os.tmpdir(), 'capy-readiness-main-'));
      try {
        fs.mkdirSync(path.join(tmpMainSpecDir, 'docs/ai'), { recursive: true });
        fs.writeFileSync(
          path.join(tmpMainSpecDir, 'AGENTS.md'),
          '# AGENTS\nReport >= 95% PR Readiness in <details> with % at the start of each line and as many or as few scope-relevant items as needed.\n',
          'utf8'
        );
        fs.writeFileSync(
          path.join(tmpMainSpecDir, 'docs/ai/pr-readiness.md'),
          '# PR Readiness\nPR Readiness Checklist 100% inside <details> with % at the start of each line and as many or as few scope-relevant items as needed.\n',
          'utf8'
        );
        fs.writeFileSync(path.join(tmpMainSpecDir, 'DEV.md'), '# DEV\nEngineering guide.\n', 'utf8');
        fs.writeFileSync(path.join(tmpMainSpecDir, 'TESTING.md'), '# TESTING\nAll checks.\n', 'utf8');
        fs.writeFileSync(path.join(tmpMainSpecDir, 'README.md'), '# README\n100% offline.\n', 'utf8');
        assert.throws(
          () => validatePrReadinessSpec(tmpMainSpecDir, { requireProjectMd: false }),
          /AGENTS\.md must specify 100% PR Readiness threshold/
        );

        fs.writeFileSync(
          path.join(tmpMainSpecDir, 'AGENTS.md'),
          '# AGENTS\nReport 100% PR Readiness in <details> with % at the start of each line and as many or as few scope-relevant items as needed.\n',
          'utf8'
        );
        assert.equal(validatePrReadinessSpec(tmpMainSpecDir, { requireProjectMd: false }).scannedFiles.length, 5);
      } finally {
        fs.rmSync(tmpMainSpecDir, { recursive: true, force: true });
      }
    }

    const tmpStrictRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'capy-sanity-strict-'));
    try {
      fs.mkdirSync(path.join(tmpStrictRepo, 'web/src'), { recursive: true });
      fs.mkdirSync(path.join(tmpStrictRepo, 'app'), { recursive: true });
      fs.mkdirSync(path.join(tmpStrictRepo, 'docs/ai'), { recursive: true });
      fs.writeFileSync(
        path.join(tmpStrictRepo, 'web/package.json'),
        JSON.stringify({ name: 'capy-paint', version: '3.0.4' }, null, 2),
        'utf8'
      );
      fs.writeFileSync(
        path.join(tmpStrictRepo, 'web/src/version.ts'),
        'export const code = major * 10000 + minor * 100 + patch;\n',
        'utf8'
      );
      fs.writeFileSync(
        path.join(tmpStrictRepo, 'app/build.gradle.kts'),
        'val capyVersionCode = (verMajor * 10000) + (verMinor * 100) + verPatch\n',
        'utf8'
      );
      const strictRootMds = [
        'README.md',
        'PROJECT.md',
        'DEV.md',
        'AGENTS.md',
        'ROADMAP.md',
        'TODO.md',
        'WEB.md',
        'PUZZLE.md',
        'APP.md',
        'CLOUD.md',
        'TESTING.md',
        'CHANGELOG.md',
        'LICENSE.md',
      ];
      const strictAllLinks = strictRootMds.map((n) => `[${n}](./${n})`).join(' ');
      const strictAgentsDoc = `# AGENTS.md\n${strictAllLinks}\nReport 100% PR Readiness Score inside <details> with % at the start of each line and as many or as few scope-relevant items as needed.\n`;
      const strictPrReadinessDoc = `# PR Readiness\nPR Readiness Checklist 100% inside <details> with % at the start of each line and as many or as few scope-relevant items as needed.\n`;
      const strictProjectDoc = `# PROJECT.md\n${strictAllLinks}\n`;
      const strictDevDoc = `# DEV.md\n${strictAllLinks}\n`;
      fs.writeFileSync(path.join(tmpStrictRepo, 'docs/ai/pr-readiness.md'), strictPrReadinessDoc, 'utf8');
      for (const name of strictRootMds) {
        if (name === 'CHANGELOG.md') continue;
        const content =
          name === 'AGENTS.md'
            ? strictAgentsDoc
            : `# ${name}\n${strictAllLinks}\n`;
        fs.writeFileSync(path.join(tmpStrictRepo, name), content, 'utf8');
      }
      const makeStrictChangelog = ({
        headings = ['### 3.0.4 - 2026-11-13 (Beta)', '### 3.0.1 - 2026-11-12 (Production)', '### 0.1.0 - 2026-10-01'],
        bulletCount = 398,
        firstBulletPrefix = '[#493](../../pull/493)',
      } = {}) => {
        const lines = [headings[0], '', `- ${firstBulletPrefix} Top change`, ''];
        for (let i = 1; i < headings.length; i++) {
          lines.push(headings[i], '');
          if (i === headings.length - 1) {
            for (let b = 1; b < bulletCount; b++) {
              lines.push(`- [#${b}](../../pull/${b}) Historical change ${b}`);
            }
          } else {
            lines.push(`- [#${i}](../../pull/${i}) Channel release`, '');
          }
        }
        return `${lines.join('\n')}\n`;
      };
      const strictChangelogPath = path.join(tmpStrictRepo, 'CHANGELOG.md');
      fs.writeFileSync(strictChangelogPath, makeStrictChangelog(), 'utf8');

      const strictRes = runSanityChecks({
        repoRoot: tmpStrictRepo,
        requireProjectMd: true,
        enforceChannelOrder: true,
        enforceEpicNaming: true,
        enforcePrReadinessSpec: true,
      });
      assert.equal(strictRes.version, '3.0.4');
      assert.equal(strictRes.markdownFilesChecked, 14);

      // 1. Missing ./PROJECT.md from README.md
      fs.writeFileSync(
        path.join(tmpStrictRepo, 'README.md'),
        `# README\n${strictAllLinks.replace('./PROJECT.md', './DEV.md')}\n`,
        'utf8'
      );
      assert.throws(
        () =>
          runSanityChecks({
            repoRoot: tmpStrictRepo,
            requireProjectMd: true,
            enforceChannelOrder: true,
            enforceEpicNaming: true,
            enforcePrReadinessSpec: true,
          }),
        /README\.md must link \.\/PROJECT\.md/
      );
      fs.writeFileSync(path.join(tmpStrictRepo, 'README.md'), `# README\n${strictAllLinks}\n`, 'utf8');

      // 2. Missing ./TESTING.md from PROJECT.md
      fs.writeFileSync(
        path.join(tmpStrictRepo, 'PROJECT.md'),
        `# PROJECT\n${strictAllLinks.replace('./TESTING.md', './DEV.md')}\n`,
        'utf8'
      );
      assert.throws(
        () =>
          runSanityChecks({
            repoRoot: tmpStrictRepo,
            requireProjectMd: true,
            enforceChannelOrder: true,
            enforceEpicNaming: true,
            enforcePrReadinessSpec: true,
          }),
        /PROJECT\.md must link \.\/TESTING\.md/
      );

      // 3. Guide link hidden inside HTML capy-dev-only block must fail public indexing check
      fs.writeFileSync(
        path.join(tmpStrictRepo, 'PROJECT.md'),
        `# PROJECT\n${strictAllLinks.replace('[TESTING.md](./TESTING.md)', '')}\n<!-- capy-dev-only:start -->\n[TESTING.md](./TESTING.md)\n<!-- capy-dev-only:end -->\n`,
        'utf8'
      );
      assert.throws(
        () =>
          runSanityChecks({
            repoRoot: tmpStrictRepo,
            requireProjectMd: true,
            enforceChannelOrder: true,
            enforceEpicNaming: true,
            enforcePrReadinessSpec: true,
          }),
        /PROJECT\.md must link \.\/TESTING\.md/
      );

      // 4. Legacy Epic issue ref fails when enforceEpicNaming: true
      fs.writeFileSync(
        path.join(tmpStrictRepo, 'PROJECT.md'),
        `${strictProjectDoc}See #` + '477\n',
        'utf8'
      );
      assert.throws(
        () =>
          runSanityChecks({
            repoRoot: tmpStrictRepo,
            requireProjectMd: true,
            enforceChannelOrder: true,
            enforceEpicNaming: true,
            enforcePrReadinessSpec: true,
          }),
        /EPIC-N/
      );
      fs.writeFileSync(path.join(tmpStrictRepo, 'PROJECT.md'), strictProjectDoc, 'utf8');

      // 5. Bare #490 bullet fails clickable PR link check
      fs.writeFileSync(
        strictChangelogPath,
        makeStrictChangelog({ firstBulletPrefix: '#490' }),
        'utf8'
      );
      assert.throws(
        () =>
          runSanityChecks({
            repoRoot: tmpStrictRepo,
            requireProjectMd: true,
            enforceChannelOrder: true,
            enforceEpicNaming: true,
            enforcePrReadinessSpec: true,
          }),
        /Invalid CHANGELOG bullet prefix/
      );

      // 6. Inverted Alpha after Beta fails enforceChannelOrder
      fs.writeFileSync(
        strictChangelogPath,
        makeStrictChangelog({
          headings: [
            '### 3.0.4 - 2026-11-13 (Beta)',
            '### 2.7 - 2026-11-12 (Alpha)',
            '### 2.5 - 2026-11-11 (Production)',
            '### 0.1.0 - 2026-10-01',
          ],
        }),
        'utf8'
      );
      assert.throws(
        () =>
          runSanityChecks({
            repoRoot: tmpStrictRepo,
            requireProjectMd: true,
            enforceChannelOrder: true,
            enforceEpicNaming: true,
            enforcePrReadinessSpec: true,
          }),
        /Alpha heading must appear first/
      );
      fs.writeFileSync(strictChangelogPath, makeStrictChangelog(), 'utf8');

      // 6b. CRLF line endings in CHANGELOG.md normalize cleanly
      fs.writeFileSync(strictChangelogPath, makeStrictChangelog().replace(/\n/g, '\r\n'), 'utf8');
      const strictCrlfRes = runSanityChecks({
        repoRoot: tmpStrictRepo,
        requireProjectMd: true,
        enforceChannelOrder: true,
        enforceEpicNaming: true,
        enforcePrReadinessSpec: true,
      });
      assert.equal(strictCrlfRes.version, '3.0.4');
      fs.writeFileSync(strictChangelogPath, makeStrictChangelog(), 'utf8');

      // 7. Legacy PR rubric tokens fail across governance docs and .github workflows
      for (const [relTarget, baseDoc, badSnippet] of [
        ['PROJECT.md', strictProjectDoc, 'Use 5-Pillar scoring.\n'],
        ['AGENTS.md', strictAgentsDoc, 'Score 95 / 100.\n'],
        ['DEV.md', strictDevDoc, 'Check 20/20 items.\n'],
        ['TESTING.md', `# TESTING.md\n${strictAllLinks}\n`, 'Award 20 pts per category.\n'],
        ['README.md', `# README.md\n${strictAllLinks}\n`, 'See the PR Rubric.\n'],
        ['PROJECT.md', strictProjectDoc, 'Use 5-Pillars scoring.\n'],
        ['DEV.md', strictDevDoc, 'Use a 20-point scale.\n'],
        ['TESTING.md', `# TESTING.md\n${strictAllLinks}\n`, 'Worth **20** pts per item.\n'],
        ['README.md', `# README.md\n${strictAllLinks}\n`, 'Apply (- 5 points) penalty.\n'],
        ['AGENTS.md', strictAgentsDoc, 'Avoid `-N point` phrasing.\n'],
      ]) {
        fs.writeFileSync(path.join(tmpStrictRepo, relTarget), `${baseDoc}${badSnippet}`, 'utf8');
        assert.throws(
          () =>
            runSanityChecks({
              repoRoot: tmpStrictRepo,
              requireProjectMd: true,
              enforceChannelOrder: true,
              enforceEpicNaming: true,
              enforcePrReadinessSpec: true,
            }),
          /Forbidden legacy/
        );
        fs.writeFileSync(path.join(tmpStrictRepo, relTarget), baseDoc, 'utf8');
      }
      fs.mkdirSync(path.join(tmpStrictRepo, '.github/workflows'), { recursive: true });
      for (const badWorkflow of [
        'name: CI\n# Check 5-Pillar 95/100\n',
        'name: CI\n# Check 5-Pillars (**20** pts)\n',
      ]) {
        fs.writeFileSync(path.join(tmpStrictRepo, '.github/workflows/ci.yml'), badWorkflow, 'utf8');
        assert.throws(
          () =>
            runSanityChecks({
              repoRoot: tmpStrictRepo,
              requireProjectMd: true,
              enforceChannelOrder: true,
              enforceEpicNaming: true,
              enforcePrReadinessSpec: true,
            }),
          /Forbidden legacy/
        );
      }
      fs.rmSync(path.join(tmpStrictRepo, '.github'), { recursive: true, force: true });

      // 8. Missing flexible-count or %-start spec fails when enforcePrReadinessSpec: true
      fs.writeFileSync(
        path.join(tmpStrictRepo, 'docs/ai/pr-readiness.md'),
        '# PR Readiness\nPR Readiness Checklist 100% inside <details> with % at the start of each line.\n',
        'utf8'
      );
      assert.throws(
        () =>
          runSanityChecks({
            repoRoot: tmpStrictRepo,
            requireProjectMd: true,
            enforceChannelOrder: true,
            enforceEpicNaming: true,
            enforcePrReadinessSpec: true,
          }),
        /docs\/ai\/pr-readiness\.md must allow variable/
      );
      fs.writeFileSync(path.join(tmpStrictRepo, 'docs/ai/pr-readiness.md'), strictPrReadinessDoc, 'utf8');

      fs.writeFileSync(
        path.join(tmpStrictRepo, 'AGENTS.md'),
        `# AGENTS.md\n${strictAllLinks}\nReport 100% PR Readiness Score inside <details> with as many items as needed.\n`,
        'utf8'
      );
      assert.throws(
        () =>
          runSanityChecks({
            repoRoot: tmpStrictRepo,
            requireProjectMd: true,
            enforceChannelOrder: true,
            enforceEpicNaming: true,
            enforcePrReadinessSpec: true,
          }),
        /AGENTS\.md must specify putting % at the start/
      );
      fs.writeFileSync(path.join(tmpStrictRepo, 'AGENTS.md'), strictAgentsDoc, 'utf8');

      // 9. CHANGELOG /pull/20 and /pull/100 URLs plus README width="100%" pass runSanityChecks
      fs.writeFileSync(
        path.join(tmpStrictRepo, 'README.md'),
        `# README.md\n${strictAllLinks}\n<img width="100%" alt="demo" />\n`,
        'utf8'
      );
      fs.writeFileSync(
        strictChangelogPath,
        makeStrictChangelog({
          firstBulletPrefix: '[#100](../../pull/100)',
        }).replace(
          '[#20](../../pull/20) Historical change 20',
          '[#20](../../pull/20) Rebuild interface'
        ),
        'utf8'
      );
      const urlGuardRes = runSanityChecks({
        repoRoot: tmpStrictRepo,
        requireProjectMd: true,
        enforceChannelOrder: true,
        enforceEpicNaming: true,
        enforcePrReadinessSpec: true,
      });
      assert.equal(urlGuardRes.version, '3.0.4');
      fs.writeFileSync(path.join(tmpStrictRepo, 'README.md'), `# README.md\n${strictAllLinks}\n`, 'utf8');
      fs.writeFileSync(strictChangelogPath, makeStrictChangelog(), 'utf8');

      // 9b. Unordered Markdown bullet "- 5 points to watch:" in a governance doc passes runSanityChecks
      fs.writeFileSync(
        path.join(tmpStrictRepo, 'DEV.md'),
        `${strictDevDoc}\n### Notes\n- 5 points to watch:\n  - 3 points on layout stability.\n`,
        'utf8'
      );
      const bulletGuardRes = runSanityChecks({
        repoRoot: tmpStrictRepo,
        requireProjectMd: true,
        enforceChannelOrder: true,
        enforceEpicNaming: true,
        enforcePrReadinessSpec: true,
      });
      assert.equal(bulletGuardRes.version, '3.0.4');
      fs.writeFileSync(path.join(tmpStrictRepo, 'DEV.md'), strictDevDoc, 'utf8');

      // 9c. Public issue tracker & privacy policy guard passes clean files and rejects shthed regressions
      fs.mkdirSync(path.join(tmpStrictRepo, 'web/src/components'), { recursive: true });
      fs.mkdirSync(path.join(tmpStrictRepo, 'web/public'), { recursive: true });
      fs.mkdirSync(path.join(tmpStrictRepo, '.github/ISSUE_TEMPLATE'), { recursive: true });
      const cleanSettingsTag =
        '<a href="https://github.com/capyboop/paint/issues/new/choose" data-testid="about-report-issue-link">Report</a>';
      const cleanPrivacyHtml =
        '<html><body><a href="https://github.com/capyboop/paint/issues">Issues</a></body></html>';
      const cleanIssueConfig = 'contact_links:\n  - url: https://capypaint.com/\n';
      const settingsPath = path.join(tmpStrictRepo, 'web/src/components/SettingsModal.tsx');
      const privacyPath = path.join(tmpStrictRepo, 'web/public/privacy-policy.html');
      const issueConfigPath = path.join(tmpStrictRepo, '.github/ISSUE_TEMPLATE/config.yml');
      const bugTemplatePath = path.join(tmpStrictRepo, '.github/ISSUE_TEMPLATE/bug_report.yml');
      fs.writeFileSync(settingsPath, cleanSettingsTag, 'utf8');
      fs.writeFileSync(privacyPath, cleanPrivacyHtml, 'utf8');
      fs.writeFileSync(issueConfigPath, cleanIssueConfig, 'utf8');
      fs.writeFileSync(bugTemplatePath, 'name: Bug Report\n', 'utf8');
      const trackerPassRes = runSanityChecks({
        repoRoot: tmpStrictRepo,
        requireProjectMd: true,
        enforceChannelOrder: true,
        enforceEpicNaming: true,
        enforcePrReadinessSpec: true,
      });
      assert.equal(trackerPassRes.version, '3.0.4');

      fs.writeFileSync(
        settingsPath,
        '<a href="https://github.com/shthed/capy/issues/new/choose" data-testid="about-report-issue-link">Report</a>',
        'utf8'
      );
      assert.throws(
        () => runSanityChecks({ repoRoot: tmpStrictRepo, requireProjectMd: true }),
        /about-report-issue-link/
      );
      fs.writeFileSync(settingsPath, cleanSettingsTag, 'utf8');

      fs.writeFileSync(
        settingsPath,
        '<a onClick={() => console.log(1)} href="https://github.com/capyboop/paint/issues/new/choose" data-testid="about-report-issue-link">Report</a>',
        'utf8'
      );
      runSanityChecks({ repoRoot: tmpStrictRepo, requireProjectMd: true });
      fs.writeFileSync(
        settingsPath,
        '<a href="https://github.com/capyboop/paint/issuesevil" data-testid="about-report-issue-link">Report</a>',
        'utf8'
      );
      assert.throws(
        () => runSanityChecks({ repoRoot: tmpStrictRepo, requireProjectMd: true }),
        /about-report-issue-link/
      );
      fs.writeFileSync(settingsPath, cleanSettingsTag, 'utf8');

      const aboutTabPath = path.join(tmpStrictRepo, 'web/src/components/settings/AboutTab.tsx');
      fs.mkdirSync(path.dirname(aboutTabPath), { recursive: true });
      fs.writeFileSync(
        aboutTabPath,
        '<a href="https://github.com/shthed/capy/issues/new/choose" data-testid="about-report-issue-link">Report</a>',
        'utf8'
      );
      assert.throws(
        () => runSanityChecks({ repoRoot: tmpStrictRepo, requireProjectMd: true }),
        /about-report-issue-link/
      );
      fs.writeFileSync(aboutTabPath, cleanSettingsTag, 'utf8');
      runSanityChecks({ repoRoot: tmpStrictRepo, requireProjectMd: true });
      fs.rmSync(aboutTabPath);

      fs.writeFileSync(
        privacyPath,
        '<html><body><a href="https://github.com/shthed/capy/issues">Issues</a></body></html>',
        'utf8'
      );
      assert.throws(
        () => runSanityChecks({ repoRoot: tmpStrictRepo, requireProjectMd: true }),
        /privacy-policy\.html/
      );
      fs.writeFileSync(
        privacyPath,
        '<html><body><a href="https://github.com/capyboop/paint/issues">Issues</a><a href="https://github.com/capyboop/paintevil">Evil</a></body></html>',
        'utf8'
      );
      assert.throws(
        () => runSanityChecks({ repoRoot: tmpStrictRepo, requireProjectMd: true }),
        /privacy-policy\.html must not link outside capyboop\/paint/
      );
      fs.writeFileSync(privacyPath, cleanPrivacyHtml, 'utf8');

      fs.writeFileSync(bugTemplatePath, 'name: Bug\nabout: https://github.com/shthed/capy\n', 'utf8');
      assert.throws(
        () => runSanityChecks({ repoRoot: tmpStrictRepo, requireProjectMd: true }),
        /ISSUE_TEMPLATE\/bug_report\.yml/
      );
      fs.writeFileSync(
        bugTemplatePath,
        'name: Bug\nabout: https://github.com/capyboop/paintevil\n',
        'utf8'
      );
      assert.throws(
        () => runSanityChecks({ repoRoot: tmpStrictRepo, requireProjectMd: true }),
        /ISSUE_TEMPLATE\/bug_report\.yml must not link outside capyboop\/paint/
      );
      fs.writeFileSync(bugTemplatePath, 'name: Bug Report\n', 'utf8');

      // 10. Missing PROJECT.md fails requireProjectMd: true
      fs.unlinkSync(path.join(tmpStrictRepo, 'PROJECT.md'));
      assert.throws(
        () =>
          runSanityChecks({
            repoRoot: tmpStrictRepo,
            requireProjectMd: true,
            enforceChannelOrder: true,
            enforceEpicNaming: true,
            enforcePrReadinessSpec: true,
          }),
        /PROJECT\.md must exist/
      );
    } finally {
      fs.rmSync(tmpStrictRepo, { recursive: true, force: true });
    }
    /* capy-dev-only:end */
    logUnitPass('SemVer parity, <2s sanity.mjs gate, CHANGELOG contract, and Epic naming checks verified.');
}

export async function runReleaseChangelogTests({ projectRoot, webPkgJson, logUnitStart, logUnitPass }) {
    logUnitStart('Testing .github/scripts/compile-changelog.mjs release note extraction & release.yml wiring...');
    const { extractReleaseNotes, formatReleaseNotesMarkdown } = await import(
      '../../../../.github/scripts/compile-changelog.mjs'
    );
    const sampleChangelog = `### 3.0.7 - 2026-11-13 (Beta)

- [#495](../../pull/495) Fix Play Games fallback and DPR canvas scaling

### 3.0.6 - 2026-11-13

- [#489](../../pull/489) Prior release note

### 2.9 - 2026-11-10

- [#470](../../pull/470) Minor rollup note`;
    assert.equal(
      extractReleaseNotes(sampleChangelog, 'v3.0.7'),
      '- [#495](../../pull/495) Fix Play Games fallback and DPR canvas scaling'
    );
    assert.equal(
      extractReleaseNotes(sampleChangelog.replace(/\n/g, '\r\n'), 'v3.0.7-beta.1'),
      '- [#495](../../pull/495) Fix Play Games fallback and DPR canvas scaling'
    );
    assert.equal(
      extractReleaseNotes(sampleChangelog, 'v2.9.4'),
      '- [#470](../../pull/470) Minor rollup note'
    );
    assert.equal(extractReleaseNotes(sampleChangelog, 'v9.9.9'), '- Release v9.9.9');
    assert.throws(() => extractReleaseNotes(sampleChangelog, 'invalid-tag'));
    assert.equal(
      formatReleaseNotesMarkdown(sampleChangelog, 'v3.0.6'),
      '### What\'s New in `v3.0.6`\n\n- [#489](../../pull/489) Prior release note\n'
    );
    const tmpReleaseNotesOut = path.join(os.tmpdir(), 'capy-release-notes-test.md');
    try {
      execFileSync(process.execPath, [
        path.resolve(projectRoot, '../.github/scripts/compile-changelog.mjs'),
        '--tag',
        `v${webPkgJson.version}`,
        '--changelog',
        path.resolve(projectRoot, '../CHANGELOG.md'),
        '--out',
        tmpReleaseNotesOut,
      ]);
      const cliNotes = fs.readFileSync(tmpReleaseNotesOut, 'utf8');
      assert.equal(cliNotes.startsWith(`### What's New in \`v${webPkgJson.version}\`\n\n`), true);
    } finally {
      fs.rmSync(tmpReleaseNotesOut, { force: true });
    }
    const releaseWorkflowYaml = fs.readFileSync(
      path.resolve(projectRoot, '../.github/workflows/release.yml'),
      'utf8'
    );
    assert.equal(releaseWorkflowYaml.includes('compile-changelog.mjs'), true);
    assert.equal(releaseWorkflowYaml.includes('python3'), false);
    assert.equal(releaseWorkflowYaml.includes('CAPY_KEYSTORE_BASE64'), true);
    assert.equal(releaseWorkflowYaml.includes('GITHUB_STEP_SUMMARY'), true);
    assert.equal(releaseWorkflowYaml.includes("steps.signing.outputs.enabled == 'true'"), true);
    assert.equal(releaseWorkflowYaml.includes('workflow_dispatch'), true);

    // Verify .github/scripts/compile-changelog.mjs stops cleanly at ## headings
    const changelogWithSubheading = `### 3.0.7 - 2026-11-13 (Beta)

- [#495](../../pull/495) Top bullet

## Archive Section

- Should never bleed into v3.0.7 release notes`;
    assert.equal(
      extractReleaseNotes(changelogWithSubheading, 'v3.0.7'),
      '- [#495](../../pull/495) Top bullet'
    );
    logUnitPass('.github/scripts/compile-changelog.mjs & release.yml extraction verified.');
}
