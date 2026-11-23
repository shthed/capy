/**
 * [Unit 07, 09, 10, 11] (Dev-Only) rebrand-persona.mjs clean-room export, open-pr.yml,
 * deploy-branch.yml / publish-capyboop.yml, ai-review Gemini fallback & dependabot.yml.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseYaml } from './yamlParser.mjs';

export async function runRebrandPersonaTests({ projectRoot, logUnitStart, logUnitPass }) {
    logUnitStart('Testing rebrand-persona.mjs clean-room export, content transforms & zero-leak checks...');
    const {
      FORBIDDEN_PERSONA_REGEX,
      stripDevOnlyBlocks,
      transformPersonaContent,
      sanitizeCommitMessage,
      assertZeroSourcePersonaLeak,
      exportCleanPersonaStage,
    } = await import('../../rebrand-persona.mjs');
    const sampleDoc =
      'Repo https://github.com/shthed/capy (`shthed`) [#482](https://github.com/shthed/capy/pull/482) [#477](https://github.com/shthed/capy/issues/477) [Sprint 1](https://github.com/shthed/capy/milestone/2) preview https://shthed.github.io/capy/pull/1/';
    const transformedOnce = transformPersonaContent(sampleDoc);
    assert.equal(
      transformedOnce,
      'Repo https://github.com/capyboop/paint (`capyboop`) #482 #477 Sprint 1 preview https://capypaint.com/'
    );
    assert.equal(transformPersonaContent(transformedOnce), transformedOnce);
    const samplePrEpicDoc =
      'Preview https://shthed.github.io/capy/alpha/492/ and https://shthed.github.io/capy/PR/42/ [EPIC-2](https://github.com/shthed/capy/issues/477)';
    const transformedPrEpic = transformPersonaContent(samplePrEpicDoc);
    assert.equal(
      transformedPrEpic,
      'Preview https://capypaint.com/ and https://capypaint.com/ EPIC-2'
    );
    assert.equal(transformPersonaContent(transformedPrEpic), transformedPrEpic);
    assert.equal(
      transformPersonaContent('Shthed SHTHED shthed'),
      'Capyboop CAPYBOOP capyboop'
    );
    const publicIssuesDoc =
      '[#2](https://github.com/capyboop/paint/issues/2) [#5](https://github.com/capyboop/paint/issues/5?q=1) [#20](https://github.com/capyboop/paint/issues/20) [#481](https://github.com/capyboop/paint/issues/481) [#2](https://github.com/shthed/capy/issues/2)';
    const transformedIssuesDoc = transformPersonaContent(publicIssuesDoc);
    assert.equal(
      transformedIssuesDoc,
      '[#2](https://github.com/capyboop/paint/issues/2) [#5](https://github.com/capyboop/paint/issues/5?q=1) #20 #481 #2'
    );
    assert.equal(transformPersonaContent(transformedIssuesDoc), transformedIssuesDoc);
    const guideBarDoc =
      '**Related Guides**: [`README.md`](./README.md) | [`CAPYBOOP.md`](./CAPYBOOP.md) | [`AGENTS.md`](./AGENTS.md) | [`DEV.md`](./DEV.md) | [`AGENTS.md` Rule 11](./AGENTS.md#1-ai-golden-invariants)';
    const strippedGuideBar = transformPersonaContent(guideBarDoc);
    assert.equal(
      strippedGuideBar,
      '**Related Guides**: [`README.md`](./README.md) | [`DEV.md`](./DEV.md) | `AGENTS.md` Rule 11'
    );
    assert.equal(transformPersonaContent(strippedGuideBar), strippedGuideBar);
    assert.equal(FORBIDDEN_PERSONA_REGEX.test('sync-beta-from-main'), true);
    assert.equal(FORBIDDEN_PERSONA_REGEX.test('.github/dependabot.yml'), true);
    assert.equal(FORBIDDEN_PERSONA_REGEX.test('CAPYBOOP_SYNC_TOKEN'), true);
    assert.equal(FORBIDDEN_PERSONA_REGEX.test('381055+capy'), true);
    assert.equal(FORBIDDEN_PERSONA_REGEX.test('hairy_dog_trumpet'), true);
    assert.equal(FORBIDDEN_PERSONA_REGEX.test('dependabot[bot]'), false);
    const devOnlyStartTag = '<!-- capy-dev-' + 'only:start -->';
    const devOnlyEndTag = '<!-- capy-dev-' + 'only:end -->';
    const docWithOpenPrBlock = [
      'Public workflow guide.',
      devOnlyStartTag,
      '- **Bot PRs ([`open-pr.yml`](./.github/workflows/open-pr.yml))**: Uses `gh workflow run open-pr.yml`.',
      devOnlyEndTag,
      'Remaining public footer.',
    ].join('\n');
    const strippedOpenPrDoc = stripDevOnlyBlocks(docWithOpenPrBlock);
    assert.equal(strippedOpenPrDoc.includes('open-pr.yml'), false);
    assert.equal(strippedOpenPrDoc.includes('Public workflow guide.'), true);
    assert.equal(strippedOpenPrDoc.includes('Remaining public footer.'), true);
    assert.equal(
      transformPersonaContent(docWithOpenPrBlock).includes('open-pr.yml'),
      false
    );
    assert.equal(
      sanitizeCommitMessage('Add Cloudflare Worker for shthed/capy (#482)\n\nCo-authored-by: shthed'),
      'Add Cloudflare Worker for capyboop/paint'
    );
    const tmpLeakCheck = fs.mkdtempSync(path.join(os.tmpdir(), 'capy-leak-check-'));
    try {
      fs.writeFileSync(path.join(tmpLeakCheck, 'ok.yml'), 'if: actor != "dependabot[bot]"\n', 'utf8');
      assert.equal(assertZeroSourcePersonaLeak(tmpLeakCheck), 1);
      const symlinkCliPath = path.join(tmpLeakCheck, 'rebrand-link.mjs');
      fs.symlinkSync(path.resolve(projectRoot, 'scripts/rebrand-persona.mjs'), symlinkCliPath);
      const symlinkOut = execFileSync(process.execPath, [symlinkCliPath, '--verify-clean', tmpLeakCheck], {
        encoding: 'utf8',
      });
      assert.equal(symlinkOut.includes('Verified 1 clean files'), true);
      fs.writeFileSync(path.join(tmpLeakCheck, 'leak.md'), 'See sync-beta-from-main workflow\n', 'utf8');
      assert.throws(() => assertZeroSourcePersonaLeak(tmpLeakCheck), /Forbidden persona token/);
    } finally {
      fs.rmSync(tmpLeakCheck, { recursive: true, force: true });
    }
    const tmpCleanStage = fs.mkdtempSync(path.join(os.tmpdir(), 'capy-clean-stage-'));
    const stagedNodeModules = path.join(tmpCleanStage, 'web/node_modules');
    try {
      const stageStats = exportCleanPersonaStage({ stageDir: tmpCleanStage });
      assert.equal(stageStats.verifiedFiles > 50, true);
      assert.equal(fs.existsSync(path.join(tmpCleanStage, '.agents')), false);
      assert.equal(
        fs.existsSync(path.join(tmpCleanStage, '.github/workflows/publish-capyboop.yml')),
        false
      );
      assert.equal(
        fs.existsSync(path.join(tmpCleanStage, '.github/workflows/pr-review-gate.yml')),
        false
      );
      assert.equal(
        fs.existsSync(path.join(tmpCleanStage, '.github/workflows/open-pr.yml')),
        false
      );
      assert.equal(
        fs.existsSync(path.join(tmpCleanStage, '.github/workflows/sync-beta-from-main.yml')),
        false
      );
      assert.equal(fs.existsSync(path.join(tmpCleanStage, '.github/dependabot.yml')), false);
      assert.equal(
        fs.existsSync(path.join(tmpCleanStage, 'web/scripts/rebrand-persona.mjs')),
        false
      );
      const stagedReadme = fs.readFileSync(path.join(tmpCleanStage, 'README.md'), 'utf8');
      assert.equal(stagedReadme.includes('capyboop.github.io/capy/beta/'), false);
      assert.equal(stagedReadme.includes('https://github.com/capyboop/paint/releases'), true);
      assert.equal(fs.existsSync(path.join(tmpCleanStage, 'TODO.md')), false);
      const stagedRoadmap = fs.readFileSync(path.join(tmpCleanStage, 'ROADMAP.md'), 'utf8');
      assert.equal(stagedRoadmap.includes('CAPYBOOP_SYNC_TOKEN'), false);
      assert.equal(stagedRoadmap.includes('capyboop.github.io/capy/beta'), false);
      assert.equal(stagedRoadmap.includes('https://github.com/capyboop/paint/issues'), true);
      const stagedReleaseYaml = fs.readFileSync(
        path.join(tmpCleanStage, '.github/workflows/release.yml'),
        'utf8'
      );
      assert.equal(stagedReleaseYaml.includes('GITHUB_STEP_SUMMARY'), true);
      const stagedRedirects = fs.readFileSync(
        path.join(tmpCleanStage, 'web/public/_redirects'),
        'utf8'
      );
      assert.equal(
        stagedRedirects.includes('https://github.com/capyboop/paint/releases/latest/download/capy.apk'),
        true
      );
      assert.equal(fs.existsSync(path.join(tmpCleanStage, 'AGENTS.md')), false);
      assert.equal(fs.existsSync(path.join(tmpCleanStage, 'CAPYBOOP.md')), false);
      assert.equal(fs.existsSync(path.join(tmpCleanStage, 'docs/ai')), false);
      assert.equal(
        fs.existsSync(path.join(tmpCleanStage, '.github/workflows/open-issue.yml')),
        false
      );
      // Verify AI-dev leak rejection and product-AI preservation
      for (const badToken of [
        'open-issue.yml',
        'AGENTS.md',
        'CAPYBOOP.md',
        'docs/ai/pr-readiness.md',
        '.agents/environment.json',
        'Antigravity',
        'conversation://abc',
        'Gemini 4 Argon',
        'MAJOR_CAPABILITY_SERVER_SIDE_GEMINI_API',
        'Claude Opus',
        'codex/',
        'ChatGPT',
        'GitHub Copilot',
        'PR Readiness Score',
        'WHITEBOARD.md',
        '/grill-me',
        '/teamwork',
        '/goal',
        '/plan',
        'WHITEBOARD',
        '.agents',
        'PR_READINESS',
        'PrReadiness',
        'clean-room',
        'regenerate-puzzles',
        'automation/sprint-1',
        'AI Contributors',
        'bot-authored',
        'Owner directive',
        'review:ai-approved',
        'ai-agent',
        'capyboop/capy',
        'AI-dev',
        'AI review',
        'AI reviews',
        'AI approval',
        'AI Studio',
        'AI GitHub actions',
        'agent',
        'agents',
        'subagent',
        'AGENTS',
        'docs(agents)',
        'update-agents',
        'invoke_subagent',
        'ci(mirror)',
        'chore(mirror)',
        'public mirror',
        'mirror sync',
        'mirror retargeting',
        'full replay',
        'Open Bot Issue',
        'free bot',
        '1-click bot',
        'bot PR',
        'review-gate',
        'review gate',
        'gate readiness',
        'persona',
        'Issue #607',
        '.github/copilot-instructions.md',
        'capy.prompt.yml',
        'CLAUDE.md',
        'GEMINI.md',
      ]) {
        assert.equal(
          FORBIDDEN_PERSONA_REGEX.test(badToken),
          true,
          `FORBIDDEN_PERSONA_REGEX must reject "${badToken}"`
        );
      }
      for (const safeToken of [
        'AiArtworkProvider',
        'AiCreditLedger',
        'Starter free AI generation credits',
        'AI Credits',
        'EPIC-5',
        'project owner (capyboop)',
        'User-Agent: capy-paint',
        'github-actions[bot]',
        'personal',
        'personalized',
        'during replay',
      ]) {
        assert.equal(
          FORBIDDEN_PERSONA_REGEX.test(safeToken),
          false,
          `FORBIDDEN_PERSONA_REGEX must allow "${safeToken}"`
        );
      }
      assert.equal(
        transformPersonaContent('See [Guide](./docs/ai/workflow-and-models.md) | [DEV](./DEV.md)'),
        'See [DEV](./DEV.md)'
      );
      assert.equal(
        sanitizeCommitMessage('Update AGENTS.md, Gemini 4, codex/, and open-issue.yml (#607)'),
        'Update project docs, CI, feature/, and GitHub workflow'
      );
      for (const [rawMsg, expectedOut] of [
        ['Add /goal and /plan workflow support for AI Contributors', 'Add workflow and workflow workflow support for contributors'],
        ['Update WHITEBOARD and Project Owner directive for bot-authored PRs', 'Update status notes and Project project guideline for automated PRs'],
        ['Sync .agents directory and PR_READINESS check', 'Sync dev environment config directory and PR checklist check'],
        ['Fix automation/sprint-12 branch cleanup and clean-room regenerate-puzzles.yml', 'Fix feature/sprint-12 branch cleanup and public asset generation'],
        ['Scrub AI-dev & agent traces from public mirror (Issue #607) (#612)', 'Scrub internal dev & contributor traces from public repository'],
        ['docs(agents): align CAPYBOOP, AGENTS, DEV with free bot AI reviews', 'docs: align project docs, contributor, DEV with automated CI review'],
        ['ci(mirror): tag pushed commit during full replay and mirror sync', 'ci(release): tag pushed commit during release sync and release sync'],
        ['Add 1-click bot PR approval and Open Bot Issue for github-actions[bot]', 'Add one-click PR approval and issue automation for CI automation'],
        ['Compile #612 changelog and fix review-gate gate readiness persona check', 'Compile changelog and fix review workflow PR checks release check'],
        ['Add personalized theme and personal gallery with AiArtworkProvider', 'Add personalized theme and personal gallery with AiArtworkProvider'],
        ['ci: preserve valid review:ai-approved and reconcile labels after AI marker evaluation', 'ci: preserve valid CI-approved and reconcile labels after CI marker evaluation'],
        ['Speed up CI gate with async E2E/Android/Pages and strict 100% AI auto-merge', 'Speed up CI gate with async E2E/Android/Pages and strict 100% CI auto-merge'],
        ['Add Dual AI and Owner PR review gate, sub-2s sanity check, and clean-room tag sync', 'Add automated and Owner PR review workflow, sub-2s sanity check, and public tag sync'],
        ['ci(mirror): replay full clean-room commit history onto capyboop/paint', 'ci(release): sync public release history onto capyboop/paint'],
        ['Update CAPYBOOP, AGENTS and CAPYBOOP guide', 'Update project docs, contributor and project docs guide'],
        ['Allow bot PRs and AI approvals for public personas (#607)', 'Allow automated PRs and CI approvals for public releases'],
        ['Close #607 with readiness checklist in ci(gate)', 'Close cleanup with PR checklist in ci(checks)'],
        ['ci(mirror): scrub dev tokens in historical commit messages during replay', 'ci(release): normalize release commit history during sync'],
      ]) {
        const cleaned = sanitizeCommitMessage(rawMsg);
        assert.equal(cleaned, expectedOut);
        assert.equal(FORBIDDEN_PERSONA_REGEX.test(cleaned), false, `Sanitized output leaked: ${cleaned}`);
      }
      // Verify retired migrate_public_epics step is removed and fail-closed historical replay stays intact in publish-capyboop.yml
      const publishYmlText = fs.readFileSync(
        path.resolve(projectRoot, '../.github/workflows/publish-capyboop.yml'),
        'utf8'
      );
      assert.equal(
        publishYmlText.includes('migrate_public_epics'),
        false,
        'publish-capyboop.yml must not include the retired migrate_public_epics input or step'
      );
      assert.equal(
        publishYmlText.includes('timeout-minutes: 30'),
        true,
        'publish-capyboop.yml must allocate timeout-minutes: 30 for full historical replay'
      );
      assert.equal(
        publishYmlText.includes('historicalScrub: origSha !== headSha'),
        true,
        'publish-capyboop.yml must enable historicalScrub for historical commits while keeping HEAD strict'
      );
      assert.equal(
        publishYmlText.includes('} catch {'),
        false,
        'publish-capyboop.yml must not silently swallow exportCleanPersonaStage errors'
      );
      assert.equal(
        publishYmlText.includes('verify_clean_history_repo'),
        true,
        'publish-capyboop.yml must verify replayed history logs and blobs before pushing'
      );
      assert.equal(
        publishYmlText.includes('log --all -i -S'),
        true,
        'publish-capyboop.yml must scan historical blobs case-insensitively with log --all -i -S'
      );
      assert.equal(
        publishYmlText.includes("'docs/ai'") &&
          publishYmlText.includes("'web/scripts/rebrand-persona.mjs'") &&
          publishYmlText.includes("'.github/workflows/publish-capyboop.yml'"),
        true,
        'publish-capyboop.yml legacy_hits must include docs/ai, rebrand-persona.mjs, and publish-capyboop.yml'
      );
      assert.equal(
        publishYmlText.includes('REMOTE_TAGS="$(git -C "${TAG_REPO_DIR}" ls-remote --tags target)"') &&
          publishYmlText.includes('declare -A tag_sha=()') &&
          publishYmlText.includes(':refs/tags/${remote_tag}'),
        true,
        'publish-capyboop.yml must fail-closed on ls-remote and resolve peeled ^{} tags before pruning'
      );
      const scrubEpic = (text) =>
        transformPersonaContent(String(text || ''))
          .split(/\r?\n/)
          .map((line) => {
            if (!line.trim()) return '';
            const [, indent = '', rest = ''] = line.match(/^(\s*)(.*)$/) || [];
            return `${indent}${sanitizeCommitMessage(rest, { fallback: rest })}`;
          })
          .join('\n');
      const scrubbedEpic = scrubEpic(
        [
          '# EPIC-2',
          'Public line',
          '<!-- capy-dev-only:start -->',
          'Secret private roadmap note mentioning internal workflow',
          '<!-- capy-dev-only:end -->',
          '  - Indented sub-bullet',
          '    - Nested sub-bullet',
        ].join('\n')
      );
      assert.equal(scrubbedEpic.includes('Secret private roadmap note'), false);
      assert.equal(scrubbedEpic.includes('internal-only'), false);
      assert.equal(scrubbedEpic.includes('  - Indented sub-bullet'), true);
      assert.equal(scrubbedEpic.includes('    - Nested sub-bullet'), true);

      // Verify historicalScrub: true excludes legacy AI files, scrubs historical blobs, and preserves product-AI terms & UI copy
      const tmpHistFixture = fs.mkdtempSync(path.join(os.tmpdir(), 'capy-hist-fixture-'));
      const tmpHistStage = fs.mkdtempSync(path.join(os.tmpdir(), 'capy-hist-stage-'));
      try {
        fs.mkdirSync(path.join(tmpHistFixture, '.github'), { recursive: true });
        fs.mkdirSync(path.join(tmpHistFixture, 'web'), { recursive: true });
        fs.writeFileSync(path.join(tmpHistFixture, '.github/copilot-instructions.md'), 'Copilot rules\n', 'utf8');
        fs.writeFileSync(path.join(tmpHistFixture, 'capy.prompt.yml'), 'prompt: test\n', 'utf8');
        fs.writeFileSync(path.join(tmpHistFixture, 'CLAUDE.md'), 'Claude rules\n', 'utf8');
        fs.writeFileSync(path.join(tmpHistFixture, 'GEMINI.md'), 'Gemini rules\n', 'utf8');
        fs.writeFileSync(
          path.join(tmpHistFixture, 'web/metadata.json'),
          JSON.stringify(
            {
              name: 'Capy',
              majorCapabilities: ['MAJOR_CAPABILITY_SERVER_SIDE_GEMINI_API'],
            },
            null,
            2
          ),
          'utf8'
        );
        fs.writeFileSync(
          path.join(tmpHistFixture, 'README.md'),
          [
            '# Capy Paint',
            'Legacy Antigravity and AGENTS.md and PR Readiness and Gemini 3 and Codex and Claude and WHITEBOARD.md and conversation://abc and invoke_subagent.',
            'Keep personal and personalized settings, User-Agent, AiArtworkProvider, AiCreditLedger, AI Credits, and EPIC-5.',
            'Follow Painting During Replay and changelog entry #612 remain intact.',
          ].join('\n'),
          'utf8'
        );

        assert.throws(
          () => exportCleanPersonaStage({ repoRoot: tmpHistFixture, stageDir: tmpHistStage }),
          /Forbidden persona token/,
          'Default historicalScrub: false must fail closed on un-scrubbed tokens'
        );
        const histStats = exportCleanPersonaStage({
          repoRoot: tmpHistFixture,
          stageDir: tmpHistStage,
          historicalScrub: true,
        });
        assert.equal(histStats.verifiedFiles, 2);
        for (const excludedLegacy of [
          '.github/copilot-instructions.md',
          'capy.prompt.yml',
          'CLAUDE.md',
          'GEMINI.md',
        ]) {
          assert.equal(
            fs.existsSync(path.join(tmpHistStage, excludedLegacy)),
            false,
            `historicalScrub must exclude ${excludedLegacy}`
          );
        }
        const scrubbedMeta = JSON.parse(
          fs.readFileSync(path.join(tmpHistStage, 'web/metadata.json'), 'utf8')
        );
        assert.deepEqual(scrubbedMeta.majorCapabilities, []);
        const scrubbedHistReadme = fs.readFileSync(path.join(tmpHistStage, 'README.md'), 'utf8');
        assert.equal(FORBIDDEN_PERSONA_REGEX.test(scrubbedHistReadme), false);
        assert.equal(scrubbedHistReadme.includes('personal and personalized'), true);
        assert.equal(scrubbedHistReadme.includes('User-Agent'), true);
        assert.equal(scrubbedHistReadme.includes('AiArtworkProvider'), true);
        assert.equal(scrubbedHistReadme.includes('AiCreditLedger'), true);
        assert.equal(scrubbedHistReadme.includes('AI Credits'), true);
        assert.equal(scrubbedHistReadme.includes('EPIC-5'), true);
        assert.equal(scrubbedHistReadme.includes('Follow Painting During Replay'), true);
        assert.equal(scrubbedHistReadme.includes('#612'), true);
      } finally {
        fs.rmSync(tmpHistFixture, { recursive: true, force: true });
        fs.rmSync(tmpHistStage, { recursive: true, force: true });
      }

      // Verify assertZeroSourcePersonaLeak rejects forbidden relative file paths
      const badPathFile = path.join(tmpCleanStage, 'clean-room-leak.md');
      fs.writeFileSync(badPathFile, 'Harmless public text\n', 'utf8');
      try {
        assert.throws(
          () => assertZeroSourcePersonaLeak(tmpCleanStage),
          /Forbidden persona token "clean-room" leaked in path clean-room-leak\.md/
        );
      } finally {
        fs.rmSync(badPathFile, { force: true });
      }

      const tmpVerifyLog = path.join(tmpCleanStage, 'verify-log-clean.txt');
      const tmpVerifyLeak = path.join(tmpCleanStage, 'verify-log-leak.txt');
      const tmpVerifyBotLeak = path.join(tmpCleanStage, 'verify-log-bot-leak.txt');
      fs.writeFileSync(tmpVerifyLog, 'capyboop Update Capy Paint personalized AiArtworkProvider\x00', 'utf8');
      fs.writeFileSync(tmpVerifyLeak, 'capyboop Update AGENTS.md for Antigravity\x00', 'utf8');
      fs.writeFileSync(tmpVerifyBotLeak, 'capyboop Mandate github-actions[bot] for #612\x00', 'utf8');
      try {
        execFileSync(
          process.execPath,
          [path.resolve(projectRoot, 'scripts/rebrand-persona.mjs'), '--verify-log', tmpVerifyLog],
          { stdio: 'pipe' }
        );
        for (const leakFile of [tmpVerifyLeak, tmpVerifyBotLeak]) {
          let leakRc = 0;
          try {
            execFileSync(
              process.execPath,
              [path.resolve(projectRoot, 'scripts/rebrand-persona.mjs'), '--verify-log', leakFile],
              { stdio: 'pipe' }
            );
          } catch (err) {
            leakRc = Number(err.status || 1);
          }
          assert.equal(leakRc, 2, `--verify-log must exit 2 on forbidden token in ${path.basename(leakFile)}`);
        }
        for (const badVerifyArgs of [['--verify-log'], ['--verify-log', '--dry-run']]) {
          let missingArgRc = 0;
          try {
            execFileSync(
              process.execPath,
              [path.resolve(projectRoot, 'scripts/rebrand-persona.mjs'), ...badVerifyArgs],
              { stdio: 'pipe' }
            );
          } catch (err) {
            missingArgRc = Number(err.status || 0);
          }
          assert.equal(missingArgRc, 1, `--verify-log missing arg (${badVerifyArgs.join(' ')}) must exit 1`);
        }
      } finally {
        fs.rmSync(tmpVerifyLog, { force: true });
        fs.rmSync(tmpVerifyLeak, { force: true });
        fs.rmSync(tmpVerifyBotLeak, { force: true });
      }
      const stagedGitignore = fs.readFileSync(path.join(tmpCleanStage, '.gitignore'), 'utf8');
      assert.equal(stagedGitignore.includes('.agents/'), false);
      const stagedCleanupBranches = fs.readFileSync(
        path.join(tmpCleanStage, '.github/workflows/cleanup-branches.yml'),
        'utf8'
      );
      assert.equal(stagedCleanupBranches.includes('name: Cleanup stale branches'), true);
      assert.equal(stagedCleanupBranches.includes('codex/'), false);
      assert.equal(stagedCleanupBranches.includes('automation/'), false);
      const stagedMetadata = fs.readFileSync(path.join(tmpCleanStage, 'web/metadata.json'), 'utf8');
      assert.equal(stagedMetadata.includes('MAJOR_CAPABILITY_SERVER_SIDE_GEMINI_API'), false);
      const stagedProviders = fs.readFileSync(
        path.join(tmpCleanStage, 'web/src/services/providers/ProviderRegistry.ts'),
        'utf8'
      );
      assert.equal(stagedProviders.includes('AiArtworkProvider'), true);
      assert.equal(stagedProviders.includes('AiCreditLedger'), true);
      assert.equal(
        stagedRoadmap.includes('## Now') &&
          stagedRoadmap.includes('## Next') &&
          stagedRoadmap.includes('## Later'),
        true
      );

      // Verify cross-ref guardrail presence & regex behavior in open-pr.yml, open-issue.yml & pr-review-gate.yml
      const crossRefRe =
        /(?:https?:\/\/github\.com\/capyboop\/paint\/(?:issues|pull)\/\d+|(?<![A-Za-z0-9_.-])capyboop\/paint#\d+)/i;
      for (const wfRel of [
        '.github/workflows/open-pr.yml',
        '.github/workflows/open-issue.yml',
        '.github/workflows/pr-review-gate.yml',
      ]) {
        const wfSrc = fs.readFileSync(path.resolve(projectRoot, '..', wfRel), 'utf8');
        assert.equal(
          wfSrc.includes('FORBIDDEN_PUBLIC_CROSS_REF_RE'),
          true,
          `${wfRel} must enforce FORBIDDEN_PUBLIC_CROSS_REF_RE`
        );
      }
      const badCrossRefUrl = 'https://github.com/' + 'capyboop/paint/issues/3';
      const badCrossRefPr = 'https://github.com/' + 'capyboop/paint/pull/9';
      const badCrossRefShort = 'capyboop/' + 'paint#3';
      assert.equal(crossRefRe.test(`Fixes ${badCrossRefUrl}`), true);
      assert.equal(crossRefRe.test(`See ${badCrossRefPr}`), true);
      assert.equal(crossRefRe.test(`Refs ${badCrossRefShort}`), true);
      assert.equal(crossRefRe.test('See `capyboop/paint` public issue 3'), false);
      assert.equal(crossRefRe.test('https://github.com/capyboop/paint/issues'), false);

      for (const publicDoc of [
        'CONTRIBUTING.md',
        'SUPPORT.md',
        'SECURITY.md',
        '.github/PULL_REQUEST_TEMPLATE.md',
      ]) {
        assert.equal(
          fs.existsSync(path.join(tmpCleanStage, publicDoc)),
          true,
          `Clean export must retain ${publicDoc}`
        );
      }
      for (const tplFile of ['config.yml', 'bug_report.yml', 'feature_request.yml', 'puzzle_idea.yml']) {
        assert.equal(
          fs.existsSync(path.join(tmpCleanStage, `.github/ISSUE_TEMPLATE/${tplFile}`)),
          true,
          `Clean export must retain .github/ISSUE_TEMPLATE/${tplFile}`
        );
      }
      const stagedPrivacy = fs.readFileSync(
        path.join(tmpCleanStage, 'web/public/privacy-policy.html'),
        'utf8'
      );
      assert.equal(
        stagedPrivacy.includes('https://github.com/capyboop/paint/issues'),
        true,
        'privacy-policy.html must link to capyboop/paint/issues'
      );
      const stagedSanityMod = await import(
        pathToFileURL(path.join(tmpCleanStage, 'web/scripts/sanity.mjs')).href
      );
      const stagedSanity = stagedSanityMod.runSanityChecks({ repoRoot: tmpCleanStage });
      assert.equal(stagedSanity.elapsedMs < 2000, true);
      execFileSync(process.execPath, [path.join(tmpCleanStage, 'web/scripts/sanity.mjs')], {
        stdio: 'pipe',
      });
      execFileSync(process.execPath, ['--check', path.join(tmpCleanStage, 'web/scripts/test.mjs')], {
        stdio: 'pipe',
      });
      const collectMjsFiles = (dir) => {
        if (!fs.existsSync(dir)) return [];
        const out = [];
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          const full = path.join(dir, entry.name);
          if (entry.isDirectory()) out.push(...collectMjsFiles(full));
          else if (entry.isFile() && entry.name.endsWith('.mjs')) out.push(full);
        }
        return out;
      };
      const stagedTestModules = collectMjsFiles(path.join(tmpCleanStage, 'web/scripts/tests'));
      assert.ok(stagedTestModules.length >= 10, 'Expected modular test files in clean-room stage');
      for (const modPath of stagedTestModules) {
        execFileSync(process.execPath, ['--check', modPath], { stdio: 'pipe' });
      }
      const srcNodeModules = path.join(projectRoot, 'node_modules');
      if (fs.existsSync(srcNodeModules)) {
        fs.symlinkSync(srcNodeModules, stagedNodeModules, 'dir');
        execFileSync(process.execPath, ['scripts/test.mjs', '--unit'], {
          cwd: path.join(tmpCleanStage, 'web'),
          stdio: 'pipe',
        });
      }
    } finally {
      try {
        if (fs.lstatSync(stagedNodeModules).isSymbolicLink()) {
          fs.unlinkSync(stagedNodeModules);
        }
      } catch {
        // Ignore when symlink was not created
      }
      fs.rmSync(tmpCleanStage, { recursive: true, force: true });
    }
    logUnitPass('rebrand-persona.mjs clean-room export, zero-leak scan & staged sanity verified.');
}

export async function runCiDevWorkflowTests({ projectRoot, logUnitStart, logUnitPass, devShared }) {
    const {
      AsyncFunction,
      extractWorkflowScript,
      mainSyncSha,
      betaSyncSha,
      syncMergeSha,
      syncCommitsFixture,
      syncExactCompareFixture,
    } = devShared;

    logUnitStart('Testing open-pr.yml normalization, draft guard, labels & milestone lookup...');
    const runOpenPrScript = new AsyncFunction(
      'context',
      'github',
      'core',
      extractWorkflowScript('.github/workflows/open-pr.yml')
    );

    const runOpenPrCase = async (envInputs, { openPrs = [], milestones = [] } = {}) => {
      const prevEnv = {
        INPUT_HEAD: process.env.INPUT_HEAD,
        INPUT_BASE: process.env.INPUT_BASE,
        INPUT_TITLE: process.env.INPUT_TITLE,
        INPUT_BODY: process.env.INPUT_BODY,
        INPUT_DRAFT: process.env.INPUT_DRAFT,
        INPUT_LABELS: process.env.INPUT_LABELS,
        INPUT_MILESTONE: process.env.INPUT_MILESTONE,
      };
      for (const [key, val] of Object.entries(prevEnv)) {
        if (val === undefined) delete process.env[key];
      }
      Object.assign(process.env, envInputs);

      const calls = {
        listPrs: [],
        createPr: [],
        updatePr: [],
        addLabels: [],
        updateIssue: [],
      };
      const outputs = {};
      const warnings = [];
      const infos = [];
      const failed = [];
      const summaryBuffer = [];
      const coreMock = {
        setOutput: (k, v) => {
          outputs[k] = v;
        },
        warning: (m) => warnings.push(m),
        info: (m) => infos.push(m),
        setFailed: (m) => failed.push(m),
        summary: {
          addRaw: (text) => {
            summaryBuffer.push(text);
            return coreMock.summary;
          },
          write: async () => {},
        },
      };
      const githubMock = {
        paginate: async (fn, params) => (await fn(params)).data,
        rest: {
          pulls: {
            list: async (params) => {
              calls.listPrs.push(params);
              return { data: openPrs };
            },
            create: async (params) => {
              calls.createPr.push(params);
              return {
                data: {
                  number: 495,
                  html_url: 'https://github.com/shthed/capy/pull/495',
                  draft: params.draft,
                  user: { login: 'github-actions[bot]' },
                },
              };
            },
            update: async (params) => {
              calls.updatePr.push(params);
              const existing = openPrs[0];
              return {
                data: {
                  number: existing.number,
                  html_url: existing.html_url,
                  draft: existing.draft,
                  user: existing.user,
                },
              };
            },
          },
          issues: {
            listMilestones: async () => ({ data: milestones }),
            addLabels: async (params) => {
              calls.addLabels.push(params);
              return { data: [] };
            },
            update: async (params) => {
              calls.updateIssue.push(params);
              return { data: {} };
            },
          },
        },
      };
      try {
        await runOpenPrScript(
          { repo: { owner: 'shthed', repo: 'capy' } },
          githubMock,
          coreMock
        );
        return { calls, outputs, warnings, infos, failed, summary: summaryBuffer.join('') };
      } finally {
        for (const [key, val] of Object.entries(prevEnv)) {
          if (val === undefined) delete process.env[key];
          else process.env[key] = val;
        }
      }
    };

    const milestonesFixture = [
      { number: 2, title: 'Sprint 1: EPIC-2 v3.0.1 Critical Bugfixes' },
      { number: 3, title: 'Sprint 2: EPIC-3 Features' },
    ];

    // Create new bot PR with refs/heads/ + shthed: normalization, deduped labels, case-insensitive milestone title
    const openCreateRes = await runOpenPrCase(
      {
        INPUT_HEAD: '  refs/heads/shthed:feature/one-click  ',
        INPUT_BASE: 'beta',
        INPUT_TITLE: 'Add one-click PR approval',
        INPUT_BODY: 'Overview text',
        INPUT_DRAFT: 'true',
        INPUT_LABELS: 'ci, docs, ci, , testing',
        INPUT_MILESTONE: 'sprint 1: epic-2 v3.0.1 critical bugfixes',
      },
      { milestones: milestonesFixture }
    );
    assert.equal(openCreateRes.failed.length, 0);
    assert.equal(openCreateRes.calls.listPrs[0].head, 'shthed:feature/one-click');
    assert.equal(openCreateRes.calls.createPr.length, 1);
    assert.equal(openCreateRes.calls.createPr[0].head, 'feature/one-click');
    assert.equal(openCreateRes.calls.createPr[0].draft, true);
    assert.deepEqual(openCreateRes.calls.addLabels[0].labels, ['ci', 'docs', 'testing']);
    assert.equal(openCreateRes.calls.updateIssue[0].milestone, 2);
    assert.equal(openCreateRes.outputs.pr_number, '495');
    assert.equal(openCreateRes.outputs.action, 'created');
    assert.equal(openCreateRes.summary.includes('Bot PR #495 (created)'), true);

    // Idempotent update: omits draft, preserves existing body when INPUT_BODY is empty, resolves numeric milestone, warns on draft mismatch
    const openUpdateRes = await runOpenPrCase(
      {
        INPUT_HEAD: 'feature/one-click',
        INPUT_BASE: 'beta',
        INPUT_TITLE: 'Updated PR title',
        INPUT_BODY: '',
        INPUT_DRAFT: 'false',
        INPUT_LABELS: '',
        INPUT_MILESTONE: '2',
      },
      {
        openPrs: [
          {
            number: 495,
            html_url: 'https://github.com/shthed/capy/pull/495',
            draft: true,
            user: { login: 'github-actions[bot]' },
          },
        ],
        milestones: milestonesFixture,
      }
    );
    assert.equal(openUpdateRes.failed.length, 0);
    assert.equal(openUpdateRes.calls.createPr.length, 0);
    assert.equal(openUpdateRes.calls.updatePr.length, 1);
    assert.equal('draft' in openUpdateRes.calls.updatePr[0], false);
    assert.equal('body' in openUpdateRes.calls.updatePr[0], false);
    assert.equal(openUpdateRes.calls.addLabels.length, 0);
    assert.equal(openUpdateRes.calls.updateIssue[0].milestone, 2);
    assert.equal(openUpdateRes.outputs.action, 'updated');
    assert.equal(openUpdateRes.warnings.length, 1);

    // Reversed prefix order (owner:refs/heads/) normalizes cleanly
    const openReversedPrefixRes = await runOpenPrCase(
      {
        INPUT_HEAD: 'shthed:refs/heads/feature/x',
        INPUT_BASE: 'beta',
        INPUT_TITLE: 'Reversed prefix PR',
        INPUT_DRAFT: 'true',
      },
      { milestones: milestonesFixture }
    );
    assert.equal(openReversedPrefixRes.failed.length, 0);
    assert.equal(openReversedPrefixRes.calls.listPrs[0].head, 'shthed:feature/x');
    assert.equal(openReversedPrefixRes.calls.createPr.length, 1);
    assert.equal(openReversedPrefixRes.calls.createPr[0].head, 'feature/x');

    // Enforced draft=true on PR creation even when INPUT_DRAFT='false'
    const openForcedDraftRes = await runOpenPrCase(
      {
        INPUT_HEAD: 'feature/force-draft',
        INPUT_BASE: 'beta',
        INPUT_TITLE: 'Forced draft PR',
        INPUT_DRAFT: 'false',
      },
      { milestones: milestonesFixture }
    );
    assert.equal(openForcedDraftRes.failed.length, 0);
    assert.equal(openForcedDraftRes.calls.createPr.length, 1);
    assert.equal(openForcedDraftRes.calls.createPr[0].draft, true);
    assert.equal(openForcedDraftRes.warnings.length, 1);

    // Validation rejections: head === base, invalid draft, cross-owner head, extra colon, missing milestone before PR create
    const sameBranchFail = await runOpenPrCase({
      INPUT_HEAD: 'refs/heads/beta',
      INPUT_BASE: 'beta',
      INPUT_TITLE: 'Bad same branch',
      INPUT_DRAFT: 'true',
    });
    assert.equal(sameBranchFail.failed.length, 1);
    assert.equal(sameBranchFail.calls.createPr.length, 0);

    const badDraftFail = await runOpenPrCase({
      INPUT_HEAD: 'feature/x',
      INPUT_BASE: 'beta',
      INPUT_TITLE: 'Bad draft',
      INPUT_DRAFT: 'maybe',
    });
    assert.equal(badDraftFail.failed.length, 1);
    assert.equal(badDraftFail.calls.createPr.length, 0);

    const crossOwnerFail = await runOpenPrCase({
      INPUT_HEAD: 'otheruser:feature/x',
      INPUT_BASE: 'beta',
      INPUT_TITLE: 'Cross-owner PR',
      INPUT_DRAFT: 'true',
    });
    assert.equal(crossOwnerFail.failed.length, 1);
    assert.equal(crossOwnerFail.failed[0].includes('cross-owner'), true);
    assert.equal(crossOwnerFail.calls.createPr.length, 0);

    const extraColonFail = await runOpenPrCase({
      INPUT_HEAD: 'shthed:a:b',
      INPUT_BASE: 'beta',
      INPUT_TITLE: 'Extra colon head',
      INPUT_DRAFT: 'true',
    });
    assert.equal(extraColonFail.failed.length, 1);
    assert.equal(extraColonFail.calls.createPr.length, 0);

    const missingMilestoneFail = await runOpenPrCase(
      {
        INPUT_HEAD: 'feature/x',
        INPUT_BASE: 'beta',
        INPUT_TITLE: 'Unknown milestone',
        INPUT_DRAFT: 'true',
        INPUT_MILESTONE: 'Nonexistent Sprint 99',
      },
      { milestones: milestonesFixture }
    );
    assert.equal(missingMilestoneFail.failed.length, 1);
    assert.equal(missingMilestoneFail.calls.createPr.length, 0);
    logUnitPass('open-pr.yml branch normalization, draft enforcement & validation verified.');

    logUnitStart('Testing deploy-branch.yml routing, docs fast-path & publish-capyboop.yml clean sync...');
    const runDeployTargetScript = new AsyncFunction(
      'context',
      'github',
      'core',
      extractWorkflowScript('.github/workflows/deploy-branch.yml')
    );

    const runDeployTargetCase = async ({
      eventName = 'pull_request',
      sha = 'mergesha11111111111111111111111111111111',
      ref = 'refs/pull/499/merge',
      payload = {},
      changedFiles = [{ filename: 'web/src/App.tsx' }],
      prDetails = { mergeable: true },
      pullsList = [],
      commitsByRef = null,
      compareMap = null,
    } = {}) => {
      const prevBaseUrl = process.env.BASE_PREVIEW_URL;
      process.env.BASE_PREVIEW_URL = 'https://shthed.github.io/capy';
      const outputs = {};
      const warnings = [];
      const failed = [];
      const coreMock = {
        setOutput: (k, v) => {
          outputs[k] = v;
        },
        warning: (m) => warnings.push(m),
        setFailed: (m) => failed.push(m),
        summary: {
          addRaw: () => coreMock.summary,
          write: async () => {},
        },
      };
      const githubMock = {
        paginate: async (fn, params) => (await fn(params)).data,
        rest: {
          pulls: {
            list: async () => ({ data: pullsList }),
            listFiles: async () => ({ data: changedFiles }),
            get: async () => ({ data: prDetails }),
          },
          ...(commitsByRef || compareMap
            ? {
                repos: {
                  getCommit: async ({ ref: commitRef }) => ({
                    data: commitsByRef?.[commitRef] || {},
                  }),
                  compareCommitsWithBasehead: async ({ basehead }) => ({
                    data: compareMap?.[basehead] || { ahead_by: 1 },
                  }),
                },
              }
            : {}),
        },
      };
      const contextMock = {
        eventName,
        sha,
        ref,
        repo: { owner: 'shthed', repo: 'capy' },
        payload,
      };
      try {
        await runDeployTargetScript(contextMock, githubMock, coreMock);
        return { outputs, warnings, failed };
      } finally {
        if (prevBaseUrl === undefined) delete process.env.BASE_PREVIEW_URL;
        else process.env.BASE_PREVIEW_URL = prevBaseUrl;
      }
    };

    const deployDocsRes = await runDeployTargetCase({
      payload: {
        pull_request: {
          number: 499,
          head: { ref: 'docs/update', sha: 'headsha22222222222222222222222222222222' },
          mergeable: true,
        },
      },
      changedFiles: [{ filename: 'CHANGELOG.md' }, { filename: 'docs/guide.md' }],
    });
    assert.equal(deployDocsRes.failed.length, 0);
    assert.equal(deployDocsRes.outputs.is_docs_only, 'true');
    assert.equal(deployDocsRes.outputs.is_main_sync, 'false');
    assert.equal(deployDocsRes.outputs.skip, 'true');
    assert.equal(deployDocsRes.outputs.checkout_ref, 'mergesha11111111111111111111111111111111');

    const deployMergeableRes = await runDeployTargetCase({
      payload: {
        pull_request: {
          number: 499,
          head: { ref: 'feature/x', sha: 'headsha22222222222222222222222222222222' },
          mergeable: true,
        },
      },
    });
    assert.equal(deployMergeableRes.outputs.is_docs_only, 'false');
    assert.equal(deployMergeableRes.outputs.is_main_sync, 'false');
    assert.equal(deployMergeableRes.outputs.skip, 'false');
    assert.equal(deployMergeableRes.outputs.target_dir, 'alpha/499');
    assert.equal(deployMergeableRes.outputs.preview_url, 'https://shthed.github.io/capy/alpha/499/');
    assert.equal(deployMergeableRes.outputs.checkout_ref, 'mergesha11111111111111111111111111111111');

    const deployConflictingRes = await runDeployTargetCase({
      payload: {
        pull_request: {
          number: 499,
          head: { ref: 'feature/x', sha: 'headsha22222222222222222222222222222222' },
          mergeable: null,
        },
      },
      prDetails: { mergeable: false },
    });
    assert.equal(deployConflictingRes.outputs.checkout_ref, 'headsha22222222222222222222222222222222');

    const deployDispatchRes = await runDeployTargetCase({
      eventName: 'workflow_dispatch',
      ref: 'refs/heads/beta',
      payload: {
        inputs: { target_branch: 'feature/ci-dispatch', allow_without_pr: true },
      },
    });
    assert.equal(deployDispatchRes.outputs.branch, 'feature/ci-dispatch');
    assert.equal(deployDispatchRes.outputs.target_dir, 'alpha/feature-ci-dispatch');
    assert.equal(deployDispatchRes.outputs.checkout_ref, 'feature/ci-dispatch');
    assert.equal(deployDispatchRes.outputs.skip, 'false');

    // Verified sync/beta-from-main -> beta sets is_main_sync='true' only for exact fast-forward or single clean 2-parent --no-ff merge matching origin/main & checkout_ref
    const deploySyncCommitsFixture = {
      ...syncCommitsFixture,
      mergesha11111111111111111111111111111111: {
        sha: 'mergesha11111111111111111111111111111111',
        commit: { tree: { sha: 'tree-main-exact' } },
      },
      [mainSyncSha]: {
        sha: mainSyncSha,
        commit: { tree: { sha: 'tree-main-exact' } },
      },
    };
    const deployMainSyncExactRes = await runDeployTargetCase({
      payload: {
        pull_request: {
          number: 528,
          base: { ref: 'beta' },
          head: {
            ref: 'sync/beta-from-main',
            sha: syncMergeSha,
            repo: { full_name: 'shthed/capy' },
          },
          mergeable: true,
        },
      },
      changedFiles: [{ filename: 'web/src/App.tsx' }],
      commitsByRef: deploySyncCommitsFixture,
      compareMap: syncExactCompareFixture,
    });
    assert.equal(deployMainSyncExactRes.outputs.is_main_sync, 'true');
    assert.equal(deployMainSyncExactRes.outputs.skip, 'false');

    const deployMainSyncFastForwardRes = await runDeployTargetCase({
      sha: mainSyncSha,
      payload: {
        pull_request: {
          number: 528,
          base: { ref: 'beta' },
          head: {
            ref: 'sync/beta-from-main',
            sha: mainSyncSha,
            repo: { full_name: 'shthed/capy' },
          },
          mergeable: true,
        },
      },
      changedFiles: [{ filename: 'web/src/App.tsx' }],
      commitsByRef: deploySyncCommitsFixture,
      compareMap: {
        [`${mainSyncSha}...${mainSyncSha}`]: { ahead_by: 0, total_commits: 0 },
        [`${mainSyncSha}...${betaSyncSha}`]: { ahead_by: 0, total_commits: 0 },
      },
    });
    assert.equal(deployMainSyncFastForwardRes.outputs.is_main_sync, 'true');

    const deployMainSyncCheckoutTreeMismatchFailRes = await runDeployTargetCase({
      payload: {
        pull_request: {
          number: 528,
          base: { ref: 'beta' },
          head: {
            ref: 'sync/beta-from-main',
            sha: syncMergeSha,
            repo: { full_name: 'shthed/capy' },
          },
          mergeable: true,
        },
      },
      changedFiles: [{ filename: 'web/src/App.tsx' }],
      commitsByRef: {
        ...deploySyncCommitsFixture,
        mergesha11111111111111111111111111111111: {
          sha: 'mergesha11111111111111111111111111111111',
          commit: { tree: { sha: 'tree-evil-merge' } },
        },
      },
      compareMap: syncExactCompareFixture,
    });
    assert.equal(deployMainSyncCheckoutTreeMismatchFailRes.outputs.is_main_sync, 'false');

    const deployMainSyncNoop1ParentFailRes = await runDeployTargetCase({
      payload: {
        pull_request: {
          number: 528,
          base: { ref: 'beta' },
          head: {
            ref: 'sync/beta-from-main',
            sha: syncMergeSha,
            repo: { full_name: 'shthed/capy' },
          },
          mergeable: true,
        },
      },
      changedFiles: [{ filename: 'web/src/App.tsx' }],
      commitsByRef: deploySyncCommitsFixture,
      compareMap: {
        [`${syncMergeSha}...${mainSyncSha}`]: { ahead_by: 0, total_commits: 0 },
        [`${mainSyncSha}...${syncMergeSha}`]: {
          ahead_by: 1,
          total_commits: 1,
          files: [],
          commits: [{ sha: syncMergeSha, parents: [{ sha: betaSyncSha }] }],
        },
        [`${syncMergeSha}...${betaSyncSha}`]: { ahead_by: 0, total_commits: 0 },
        [`${mainSyncSha}...${betaSyncSha}`]: { ahead_by: 0, total_commits: 0 },
      },
    });
    assert.equal(deployMainSyncNoop1ParentFailRes.outputs.is_main_sync, 'false');

    const deployMainSyncMultiCommitFailRes = await runDeployTargetCase({
      payload: {
        pull_request: {
          number: 528,
          base: { ref: 'beta' },
          head: {
            ref: 'sync/beta-from-main',
            sha: syncMergeSha,
            repo: { full_name: 'shthed/capy' },
          },
          mergeable: true,
        },
      },
      changedFiles: [{ filename: 'web/src/App.tsx' }],
      commitsByRef: deploySyncCommitsFixture,
      compareMap: {
        [`${syncMergeSha}...${mainSyncSha}`]: { ahead_by: 0, total_commits: 0 },
        [`${mainSyncSha}...${syncMergeSha}`]: {
          ahead_by: 2,
          total_commits: 2,
          files: [],
          commits: [
            { sha: 'extrasync000000000000000000000000000000', parents: [{ sha: mainSyncSha }] },
            { sha: syncMergeSha, parents: [{ sha: betaSyncSha }, { sha: 'extrasync000000000000000000000000000000' }] },
          ],
        },
        [`${syncMergeSha}...${betaSyncSha}`]: { ahead_by: 0, total_commits: 0 },
        [`${mainSyncSha}...${betaSyncSha}`]: { ahead_by: 0, total_commits: 0 },
      },
    });
    assert.equal(deployMainSyncMultiCommitFailRes.outputs.is_main_sync, 'false');

    const deployMainSyncDivergedRes = await runDeployTargetCase({
      payload: {
        pull_request: {
          number: 528,
          base: { ref: 'beta' },
          head: {
            ref: 'sync/beta-from-main',
            sha: syncMergeSha,
            repo: { full_name: 'shthed/capy' },
          },
          mergeable: true,
        },
      },
      changedFiles: [{ filename: 'web/src/App.tsx' }],
      commitsByRef: deploySyncCommitsFixture,
      compareMap: {
        [`${syncMergeSha}...${mainSyncSha}`]: { ahead_by: 0, total_commits: 0 },
        [`${syncMergeSha}...${betaSyncSha}`]: { ahead_by: 0, total_commits: 0 },
        [`${mainSyncSha}...${betaSyncSha}`]: { ahead_by: 1 },
      },
    });
    assert.equal(deployMainSyncDivergedRes.outputs.is_main_sync, 'false');

    // Non-web-only PR (e.g. .github/workflows or app/ only) must output has_web_changes='false'
    const deployNonWebPrRes = await runDeployTargetCase({
      eventName: 'pull_request',
      ref: 'refs/pull/712/merge',
      sha: 'abc123',
      payload: {
        pull_request: {
          number: 712,
          draft: false,
          head: { ref: 'fix/workflow-only', sha: 'def456', repo: { full_name: 'shthed/capy' } },
          base: { ref: 'beta' },
          mergeable: true,
        },
      },
      changedFiles: [{ filename: '.github/workflows/regenerate-puzzles.yml' }, { filename: 'app/src/MainActivity.kt' }],
    });
    assert.equal(deployNonWebPrRes.outputs.is_docs_only, 'false');
    assert.equal(deployNonWebPrRes.outputs.has_web_changes, 'false');

    // Web-touching PR must output has_web_changes='true'
    const deployWebPrRes = await runDeployTargetCase({
      eventName: 'pull_request',
      ref: 'refs/pull/713/merge',
      sha: 'abc124',
      payload: {
        pull_request: {
          number: 713,
          draft: false,
          head: { ref: 'feature/web-fix', sha: 'def457', repo: { full_name: 'shthed/capy' } },
          base: { ref: 'beta' },
          mergeable: true,
        },
      },
      changedFiles: [{ filename: 'web/src/App.tsx' }],
    });
    assert.equal(deployWebPrRes.outputs.has_web_changes, 'true');

    // Non-web push to main (workflow-only) must output has_web_changes='false'
    const deployNonWebMainPushRes = await runDeployTargetCase({
      eventName: 'push',
      ref: 'refs/heads/main',
      sha: '2222222222222222222222222222222222222222',
      payload: {
        before: '1111111111111111111111111111111111111111',
      },
      compareMap: {
        '1111111111111111111111111111111111111111...2222222222222222222222222222222222222222': {
          files: [{ filename: '.github/workflows/deploy-branch.yml' }],
        },
      },
    });
    assert.equal(deployNonWebMainPushRes.outputs.has_web_changes, 'false');

    const deployYaml = fs.readFileSync(
      path.resolve(projectRoot, '../.github/workflows/deploy-branch.yml'),
      'utf8'
    );
    assert.equal(deployYaml.includes('github.event.inputs.target_branch'), true);
    assert.equal(deployYaml.includes('actions/cache@v6'), true);
    assert.equal(
      deployYaml.includes("github.base_ref == 'main' || (github.base_ref == 'beta' && needs.prepare.outputs.has_web_changes == 'true')"),
      true
    );
    assert.equal(deployYaml.includes("github.event.pull_request.user.login != 'dependabot[bot]'"), true);
    assert.equal(deployYaml.includes('steps.target.outputs.is_docs_only'), true);
    assert.equal(deployYaml.includes('steps.target.outputs.has_web_changes'), true);
    assert.equal(deployYaml.includes('needs.prepare.outputs.is_main_sync'), true);
    assert.equal(deployYaml.includes('node-modules-cache'), true);
    assert.equal(deployYaml.includes('android_build:'), true);
    assert.equal(deployYaml.includes('e2e_release_gate:'), true);
    assert.equal(deployYaml.includes('deploy_preview:'), true);
    assert.equal(deployYaml.includes('web-dist-'), true);
    assert.equal(deployYaml.includes('node scripts/test.mjs --unit'), true);
    assert.equal(deployYaml.includes('npm run test:e2e -- --workers=4'), true);
    assert.equal(deployYaml.includes('include-hidden-files: true'), true);
    assert.equal(deployYaml.includes('cp -a web/dist/. staging/web/'), true);
    assert.equal(deployYaml.includes('needs: [prepare, build, android_build]'), true);
    assert.equal(deployYaml.includes('needs: [prepare, build, android_build, e2e_release_gate]'), true);
    assert.equal(deployYaml.includes("needs.e2e_release_gate.result == 'success'"), true);
    assert.equal(
      /e2e_release_gate:[\s\S]*?VITE_GOOGLE_CLIENT_ID:\s*\$\{\{\s*vars\.VITE_GOOGLE_CLIENT_ID\s*\}\}/.test(
        deployYaml
      ),
      true
    );
    assert.equal(deployYaml.includes("--exclude 'alpha/'"), true);

    // Verify modular parallel E2E suite registry, smoke selection & lossless sharding
    const e2eRunnerMod = await import('../e2e/runner.mjs');
    assert.equal(e2eRunnerMod.E2E_SUITES.length, 11);
    assert.equal(
      e2eRunnerMod.E2E_SUITES.reduce((sum, s) => sum + s.stages, 0),
      28
    );
    const smokeSuites = e2eRunnerMod.selectE2eSuites({ smoke: true });
    assert.deepEqual(
      smokeSuites.map((s) => s.name),
      ['boot', 'gameplay']
    );
    const shard1 = e2eRunnerMod.selectE2eSuites({ shard: { index: 1, total: 2 } }).map((s) => s.name);
    const shard2 = e2eRunnerMod.selectE2eSuites({ shard: { index: 2, total: 2 } }).map((s) => s.name);
    assert.equal(shard1.length + shard2.length, e2eRunnerMod.E2E_SUITES.length);
    assert.equal(new Set([...shard1, ...shard2]).size, e2eRunnerMod.E2E_SUITES.length);
    assert.throws(() => e2eRunnerMod.selectE2eSuites({ suites: ['nonexistent-suite'] }), /Unknown E2E suite/);

    const publishCapyboopYaml = fs.readFileSync(
      path.resolve(projectRoot, '../.github/workflows/publish-capyboop.yml'),
      'utf8'
    );
    assert.equal(publishCapyboopYaml.includes('migrate_issues'), false);

    const cleanupClosedPrYaml = fs.readFileSync(
      path.resolve(projectRoot, '../.github/workflows/cleanup-closed-pr.yml'),
      'utf8'
    );
    assert.equal(cleanupClosedPrYaml.includes("github.actor != 'dependabot[bot]'"), true);
    assert.equal(cleanupClosedPrYaml.includes('timeout-minutes: 10'), true);

    const cleanupBranchesYaml = fs.readFileSync(
      path.resolve(projectRoot, '../.github/workflows/cleanup-branches.yml'),
      'utf8'
    );
    assert.equal(cleanupBranchesYaml.includes('dependabot/,sync/'), true);
    assert.equal(cleanupBranchesYaml.includes('BRANCH_CLEANUP_UNMERGED_MIN_AGE_DAYS'), true);
    assert.equal(cleanupBranchesYaml.includes('timeout-minutes: 10'), true);

    const syncBetaYaml = fs.readFileSync(
      path.resolve(projectRoot, '../.github/workflows/sync-beta-from-main.yml'),
      'utf8'
    );
    assert.equal(syncBetaYaml.includes('git merge-base --is-ancestor origin/main origin/beta'), true);
    assert.equal(syncBetaYaml.includes('git merge --no-ff origin/main'), true);
    assert.equal(syncBetaYaml.includes('github-token: ${{ secrets.CAPY_BOT_TOKEN || secrets.GITHUB_TOKEN }}'), true);
    assert.equal(syncBetaYaml.includes('pr-review-gate.yml'), true);
    assert.equal(syncBetaYaml.includes('draft: !hasPatToken'), true);
    assert.equal(syncBetaYaml.includes('WORKFLOW_DIFFS'), true);
    assert.equal(syncBetaYaml.includes('git push origin HEAD:refs/heads/beta'), true);
    assert.equal(syncBetaYaml.includes('beta ruleset 27162684'), true);
    assert.equal(syncBetaYaml.includes('deploy-branch.yml'), true);
    assert.equal(syncBetaYaml.includes('Sync beta with main conflict'), true);
    assert.equal(syncBetaYaml.includes('enablePullRequestAutoMerge'), true);
    assert.equal(syncBetaYaml.includes('actions: write'), true);
    assert.equal(syncBetaYaml.includes('name: Sync beta with main'), true);

    const prReviewGateYaml = fs.readFileSync(
      path.resolve(projectRoot, '../.github/workflows/pr-review-gate.yml'),
      'utf8'
    );
    assert.equal(
      /pull_request:\s*\r?\n\s*types:[\s\S]*?\n\s*-\s*edited\b[\s\S]*?pull_request_review:/.test(
        prReviewGateYaml
      ),
      true
    );
    assert.equal(prReviewGateYaml.includes('github.event.changes.base != null'), true);
    assert.equal(prReviewGateYaml.includes('github.event.changes.body != null'), true);
    assert.equal(prReviewGateYaml.includes('needs: [ai-review]'), true);
    assert.equal(prReviewGateYaml.includes('always()'), true);
    assert.equal(prReviewGateYaml.includes('GEMINI_API_KEY'), true);
    assert.equal(prReviewGateYaml.includes('gemini-3.8-flash'), true);
    assert.equal(prReviewGateYaml.includes('gemini-4-argon'), true);
    assert.equal(prReviewGateYaml.includes('ACTIONS_GITHUB_TOKEN'), true);
    assert.equal(prReviewGateYaml.includes('safeAddLabel'), true);
    assert.equal(prReviewGateYaml.includes('isVerifiedMainSync'), true);
    assert.equal(prReviewGateYaml.includes('strictAiReady'), true);
    assert.equal(prReviewGateYaml.includes('enablePullRequestAutoMerge'), true);
    assert.equal(prReviewGateYaml.includes('disablePullRequestAutoMerge'), true);
    assert.equal(prReviewGateYaml.includes('isStrictPrBodyValid'), true);
    assert.equal(prReviewGateYaml.includes('hasChecklistSub100OrUnchecked'), true);
    assert.equal(prReviewGateYaml.includes('<!-- capy-gate-status -->'), true);
    assert.equal(
      prReviewGateYaml.includes('["opened","synchronize","reopened","ready_for_review","converted_to_draft"]'),
      true
    );

    const parsedPrReviewGate = parseYaml(
      fs.readFileSync(path.resolve(projectRoot, '../.github/workflows/pr-review-gate.yml'), 'utf8'),
      'pr-review-gate.yml'
    );
    assert.equal(
      parsedPrReviewGate?.jobs?.['review-gate']?.steps?.[0]?.env?.ACTIONS_GITHUB_TOKEN,
      '${{ secrets.GITHUB_TOKEN }}'
    );
    const reviewGateIfExpr = parsedPrReviewGate?.jobs?.['review-gate']?.if;
    assert.equal(typeof reviewGateIfExpr, 'string');
    const reviewGateIfJs = reviewGateIfExpr.replace(
      /(?<![\w'"])github(?:\.[a-zA-Z0-9_]+)+/g,
      (match) => match.replaceAll('.', '?.')
    );
    const rawEvalReviewGateIf = new Function('github', 'contains', 'fromJSON', 'always', `return Boolean(${reviewGateIfJs});`);
    const evalReviewGateIf = (githubCtx, containsFn, fromJsonFn) =>
      rawEvalReviewGateIf(githubCtx, containsFn, fromJsonFn, () => true);
    const ghFromJson = (raw) => JSON.parse(raw);
    const ghContains = (haystack, needle) =>
      Array.isArray(haystack) ? haystack.includes(needle) : String(haystack).includes(String(needle));

    assert.equal(
      evalReviewGateIf(
        {
          repository: 'shthed/capy',
          event_name: 'pull_request',
          actor: 'shthed',
          event: { action: 'edited', changes: { body: { from: 'old' } } },
        },
        ghContains,
        ghFromJson
      ),
      true,
      'Human PR body edit must trigger review-gate'
    );
    assert.equal(
      evalReviewGateIf(
        {
          repository: 'shthed/capy',
          event_name: 'pull_request',
          actor: 'github-actions[bot]',
          event: { action: 'edited', changes: { body: { from: 'old' } } },
        },
        ghContains,
        ghFromJson
      ),
      false,
      'Bot PR body edit must remain excluded from review-gate'
    );
    assert.equal(
      evalReviewGateIf(
        {
          repository: 'shthed/capy',
          event_name: 'pull_request',
          actor: 'shthed',
          event: { action: 'edited', changes: { title: { from: 'old' } } },
        },
        ghContains,
        ghFromJson
      ),
      true,
      'Human PR title edit must trigger review-gate for cross-ref guardrail'
    );
    assert.equal(
      evalReviewGateIf(
        {
          repository: 'shthed/capy',
          event_name: 'pull_request',
          actor: 'shthed',
          event: { action: 'edited', changes: {} },
        },
        ghContains,
        ghFromJson
      ),
      false,
      'Human PR edit without base/body/title changes must not trigger review-gate'
    );
    assert.equal(
      evalReviewGateIf(
        {
          repository: 'shthed/capy',
          event_name: 'pull_request',
          actor: 'shthed',
          event: { action: 'edited', changes: { base: { ref: { from: 'beta' } } } },
        },
        ghContains,
        ghFromJson
      ),
      true,
      'Human PR base retarget edit must trigger review-gate'
    );
    assert.equal(
      evalReviewGateIf(
        {
          repository: 'shthed/capy',
          event_name: 'pull_request',
          actor: 'github-actions[bot]',
          event: { action: 'synchronize' },
        },
        ghContains,
        ghFromJson
      ),
      true,
      'Bot PR synchronize must still trigger review-gate'
    );
    assert.equal(
      evalReviewGateIf(
        {
          repository: 'shthed/capy',
          event_name: 'pull_request',
          actor: 'dependabot[bot]',
          event: { action: 'edited', changes: { body: { from: 'old' } } },
        },
        ghContains,
        ghFromJson
      ),
      false,
      'Dependabot PR body edit must remain excluded from review-gate'
    );

    const parsedPublishCapyboop = parseYaml(
      fs.readFileSync(path.resolve(projectRoot, '../.github/workflows/publish-capyboop.yml'), 'utf8'),
      'publish-capyboop.yml'
    );
    const publishStep = (parsedPublishCapyboop?.jobs?.publish?.steps || []).find((s) =>
      String(s?.name || '').includes('Commit as capyboop')
    );
    assert.ok(publishStep && typeof publishStep.run === 'string');
    const publishScript = publishStep.run;
    execFileSync(
      'bash',
      ['--norc', '--noprofile', '-n'],
      {
        input: publishScript.replace(/\$\{(?:version|commit_msg)\}/g, 'x'),
        encoding: 'utf8',
        env: { ...process.env, BASH_ENV: '', PS1: '' },
      }
    );
    assert.equal(
      /git\s+log[^\n]*\|\s*grep/i.test(publishScript),
      false,
      'publish-capyboop.yml must never pipe git log into grep under set -euo pipefail'
    );
    assert.equal(
      publishScript.includes('git log FETCH_HEAD --format="%an %ae %cn %ce %B%x00" > "${LOG_FILE}"'),
      true
    );
    assert.equal(publishScript.includes('--verify-log'), true);
    assert.equal(publishScript.includes('NEEDS_CLEAN_RESET'), true);
    assert.equal(publishScript.includes('GIT_ASKPASS'), true);
    assert.equal(publishScript.includes('chmod 700 "${ASKPASS_SCRIPT}"'), true);
    assert.equal(publishScript.includes('trap cleanup EXIT'), true);
    assert.equal(publishScript.includes('git config credential.helper ""'), true);
    assert.equal(
      /https:\/\/[^\s]*CAPYBOOP_SYNC_TOKEN[^\s]*@/.test(publishScript),
      false,
      'publish-capyboop.yml must not embed CAPYBOOP_SYNC_TOKEN inside git remote URL'
    );
    assert.equal(publishScript.includes('>/dev/null 2>&1'), false);
    assert.equal(publishScript.includes('MAIN_LS_RC'), true);
    assert.equal(publishScript.includes('TAG_LS_RC'), true);
    const publishOn = parsedPublishCapyboop?.on || parsedPublishCapyboop?.true;
    assert.equal(
      Array.isArray(publishOn?.push?.tags) && publishOn.push.tags.includes('v*.*.*'),
      true,
      'publish-capyboop.yml must trigger on v*.*.* tag pushes'
    );
    assert.equal(publishScript.includes('TAG_COMMIT'), true);
    assert.equal(publishScript.includes('HEAD_COMMIT'), true);
    const checkRefStep = (parsedPublishCapyboop?.jobs?.publish?.steps || []).find((s) => s?.id === 'check_ref');
    assert.ok(checkRefStep && String(checkRefStep.run || '').includes('refs/remotes/origin/main'));

    // Behavioral verification: temp-file grep -iaqzE detects leaked early commit across 80+ commits without SIGPIPE, and ls-remote differentiates 0 / 2 / fatal errors
    const tmpPublishRepoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'capy-publish-check-'));
    try {
      const bareRemoteDir = path.join(tmpPublishRepoDir, 'remote.git');
      const workRepoDir = path.join(tmpPublishRepoDir, 'work');
      const logOutPath = path.join(tmpPublishRepoDir, 'fetch_head.log');
      fs.mkdirSync(workRepoDir, { recursive: true });
      execFileSync('git', ['init', '--bare', bareRemoteDir], { stdio: 'pipe' });
      execFileSync('git', ['init', '-b', 'main'], { cwd: workRepoDir, stdio: 'pipe' });
      execFileSync('git', ['config', 'user.name', 'capyboop'], { cwd: workRepoDir, stdio: 'pipe' });
      execFileSync('git', ['config', 'user.email', 'capyboop@example.com'], {
        cwd: workRepoDir,
        stdio: 'pipe',
      });
      execFileSync('git', ['commit', '--allow-empty', '-m', 'Early commit with 381055+leak'], {
        cwd: workRepoDir,
        stdio: 'pipe',
      });
      for (let i = 0; i < 60; i++) {
        execFileSync('git', ['commit', '--allow-empty', '-m', `Clean commit ${i}`], {
          cwd: workRepoDir,
          stdio: 'pipe',
        });
      }
      execFileSync('git', ['remote', 'add', 'target', bareRemoteDir], { cwd: workRepoDir, stdio: 'pipe' });
      execFileSync('git', ['push', 'target', 'main'], { cwd: workRepoDir, stdio: 'pipe' });
      const scanRc = execFileSync(
        'bash',
        [
          '--norc',
          '--noprofile',
          '-euo',
          'pipefail',
          '-c',
          [
            `git -C "${workRepoDir}" log HEAD --format="%an %ae %cn %ce %B%x00" > "${logOutPath}"`,
            'GREP_RC=0',
            `grep -iaqzE "shthed|hairy[[:space:]_-]*dog[[:space:]_-]*trumpet|381055\\+|CAPYBOOP_SYNC_TOKEN" "${logOutPath}" || GREP_RC=$?`,
            'printf "%s" "$GREP_RC"',
          ].join('\n'),
        ],
        { encoding: 'utf8', env: { ...process.env, BASH_ENV: '', PS1: '' } }
      ).trim();
      assert.equal(scanRc, '0');

      const lsRemoteCodes = execFileSync(
        'bash',
        [
          '--norc',
          '--noprofile',
          '-euo',
          'pipefail',
          '-c',
          [
            'rc_hit=0',
            `git -C "${workRepoDir}" ls-remote --exit-code --heads target main >/dev/null || rc_hit=$?`,
            'rc_miss=0',
            `git -C "${workRepoDir}" ls-remote --exit-code --heads target missing-branch >/dev/null || rc_miss=$?`,
            'rc_err=0',
            `git -C "${workRepoDir}" ls-remote --exit-code --heads "${tmpPublishRepoDir}/does-not-exist.git" main >/dev/null 2>/dev/null || rc_err=$?`,
            'printf "%s:%s:%s" "$rc_hit" "$rc_miss" "$rc_err"',
          ].join('\n'),
        ],
        { encoding: 'utf8', env: { ...process.env, BASH_ENV: '', PS1: '' } }
      ).trim();
      const [rcHit, rcMiss, rcErr] = lsRemoteCodes.split(':').map(Number);
      assert.equal(rcHit, 0);
      assert.equal(rcMiss, 2);
      assert.equal(rcErr > 2, true, `Expected fatal ls-remote exit > 2, got ${rcErr}`);
    } finally {
      fs.rmSync(tmpPublishRepoDir, { recursive: true, force: true });
    }
    logUnitPass('deploy-branch.yml routing & publish-capyboop.yml clean-history guards verified.');

    logUnitStart('Testing ai-review Gemini fallback & dependabot.yml...');
    const aiReviewYamlLines = prReviewGateYaml.split(/\r?\n/);
    const aiJobIdx = aiReviewYamlLines.findIndex((line) => /^\s{2}ai-review:\s*$/.test(line));
    assert.notEqual(aiJobIdx, -1, 'Expected ai-review job in pr-review-gate.yml');
    const aiScriptIdx = aiReviewYamlLines.findIndex(
      (line, idx) => idx > aiJobIdx && /^\s*script:\s*\|\s*$/.test(line)
    );
    assert.notEqual(aiScriptIdx, -1, 'Expected script: | block in ai-review job');
    const aiHeaderIndent = aiReviewYamlLines[aiScriptIdx].match(/^(\s*)/)[1].length;
    let aiBodyIndent = null;
    const aiBodyLines = [];
    for (let i = aiScriptIdx + 1; i < aiReviewYamlLines.length; i++) {
      const line = aiReviewYamlLines[i];
      if (line.trim() === '') {
        aiBodyLines.push('');
        continue;
      }
      const indent = line.match(/^(\s*)/)[1].length;
      if (aiBodyIndent === null) {
        assert.equal(indent > aiHeaderIndent, true);
        aiBodyIndent = indent;
      } else if (indent < aiBodyIndent) {
        break;
      }
      aiBodyLines.push(line.slice(aiBodyIndent));
    }
    const runAiReviewScript = new AsyncFunction('context', 'github', 'core', aiBodyLines.join('\n'));
    const runAiReviewCase = async ({
      geminiApiKey = '',
      baseRef = 'beta',
      headRef = 'feature/test',
      isDraft = false,
      headRepo = 'shthed/capy',
      existingComments = [],
      fetchResponse = null,
      fetchImpl = null,
    } = {}) => {
      const warnings = [];
      const infos = [];
      const createdReviews = [];
      const addedLabels = [];
      const fetchCalls = [];
      const prevKey = process.env.GEMINI_API_KEY;
      const prevFetch = globalThis.fetch;
      if (geminiApiKey) process.env.GEMINI_API_KEY = geminiApiKey;
      else delete process.env.GEMINI_API_KEY;
      if (fetchImpl) {
        globalThis.fetch = async (url, init) => {
          fetchCalls.push({ url, init });
          return fetchImpl(url, init);
        };
      } else if (fetchResponse) {
        globalThis.fetch = async (url, init) => {
          fetchCalls.push({ url, init });
          return {
            ok: true,
            status: 200,
            json: async () => fetchResponse,
            text: async () => JSON.stringify(fetchResponse),
          };
        };
      }
      try {
        const mockGithub = {
          paginate: async (fn) => fn(),
          rest: {
            pulls: {
              get: async ({ mediaType } = {}) =>
                mediaType?.format === 'diff'
                  ? { data: 'diff --git a/a.ts b/a.ts\n+const x = 1;' }
                  : {
                      data: {
                        number: 999,
                        state: 'open',
                        draft: isDraft,
                        title: 'Test PR',
                        body: '## Summary\n\nTest\n\n### PR Readiness Score: 100%',
                        base: { ref: baseRef },
                        head: { ref: headRef, sha: '1111222233334444555566667777888899990000', repo: { full_name: headRepo } },
                      },
                    },
              listReviews: async () => [],
              createReview: async (arg) => {
                createdReviews.push(arg);
                return { data: { id: 1 } };
              },
            },
            issues: {
              listComments: async () => existingComments,
              addLabels: async (arg) => {
                addedLabels.push(...(arg.labels || []));
              },
            },
          },
        };
        const mockCore = {
          info: (m) => infos.push(String(m)),
          warning: (m) => warnings.push(String(m)),
        };
        const mockContext = {
          repo: { owner: 'shthed', repo: 'capy' },
          payload: { pull_request: { number: 999 } },
        };
        await runAiReviewScript(mockContext, mockGithub, mockCore);
        return { warnings, infos, createdReviews, addedLabels, fetchCalls };
      } finally {
        if (prevKey === undefined) delete process.env.GEMINI_API_KEY;
        else process.env.GEMINI_API_KEY = prevKey;
        globalThis.fetch = prevFetch;
      }
    };

    const missingKeyRes = await runAiReviewCase({ geminiApiKey: '' });
    assert.equal(missingKeyRes.warnings.some((w) => w.includes('GEMINI_API_KEY')), true);
    assert.equal(missingKeyRes.createdReviews.length, 0);
    assert.equal(missingKeyRes.addedLabels.length, 0);

    const skipDraftRes = await runAiReviewCase({ geminiApiKey: 'test-key', isDraft: true });
    assert.equal(skipDraftRes.createdReviews.length, 0);

    const skipOtherBaseRes = await runAiReviewCase({ geminiApiKey: 'test-key', baseRef: 'feature/other' });
    assert.equal(skipOtherBaseRes.createdReviews.length, 0);

    const skipSyncRes = await runAiReviewCase({ geminiApiKey: 'test-key', headRef: 'sync/beta-from-main' });
    assert.equal(skipSyncRes.createdReviews.length, 0);

    const skipForkRes = await runAiReviewCase({ geminiApiKey: 'test-key', headRepo: 'attacker/capy' });
    assert.equal(skipForkRes.createdReviews.length, 0);

    const approveRes = await runAiReviewCase({
      geminiApiKey: 'test-key',
      fetchResponse: {
        candidates: [
          {
            content: {
              parts: [
                {
                  text: JSON.stringify({
                    verdict: 'APPROVED',
                    score: 100,
                    summary: 'All checks and invariants verified.',
                  }),
                },
              ],
            },
          },
        ],
      },
    });
    assert.equal(approveRes.fetchCalls.length, 1);
    assert.equal(
      approveRes.fetchCalls[0].url,
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent'
    );
    assert.equal(approveRes.fetchCalls[0].init.method, 'POST');
    assert.equal(approveRes.fetchCalls[0].init.headers['x-goog-api-key'], 'test-key');
    assert.equal(
      JSON.parse(approveRes.fetchCalls[0].init.body).generationConfig.responseMimeType,
      'application/json'
    );
    assert.equal(approveRes.createdReviews.length, 1);
    assert.equal(approveRes.createdReviews[0].event, 'COMMENT');
    assert.equal(
      approveRes.createdReviews[0].body.includes(
        '<!-- capy-review: actor=ai-agent verdict=APPROVED sha=1111222233334444555566667777888899990000 score=100% -->'
      ),
      true
    );
    assert.deepEqual(approveRes.addedLabels, ['review:ai-approved']);

    const rejectRes = await runAiReviewCase({
      geminiApiKey: 'test-key',
      fetchResponse: {
        candidates: [
          {
            content: {
              parts: [
                {
                  text: JSON.stringify({
                    verdict: 'CHANGES_REQUESTED',
                    score: 70,
                    summary: 'Missing tests.',
                  }),
                },
              ],
            },
          },
        ],
      },
    });
    assert.equal(rejectRes.createdReviews.length, 1);
    assert.equal(
      rejectRes.createdReviews[0].body.includes(
        '<!-- capy-review: actor=ai-agent verdict=CHANGES_REQUESTED sha=1111222233334444555566667777888899990000 score=70% -->'
      ),
      true
    );
    assert.deepEqual(rejectRes.addedLabels, ['review:changes-requested']);
    assert.equal(rejectRes.addedLabels.includes('review:ai-approved'), false);

    // 404 fallback from gemini-3.8-flash to gemini-4-argon returns APPROVED 100%
    const gemini404FallbackRes = await runAiReviewCase({
      geminiApiKey: 'test-key',
      fetchImpl: async (url) => {
        if (url.includes('/gemini-3.8-flash:generateContent')) {
          return {
            ok: false,
            status: 404,
            text: async () => 'models/gemini-3.8-flash is not found',
          };
        }
        return {
          ok: true,
          status: 200,
          json: async () => ({
            candidates: [
              {
                content: {
                  parts: [
                    {
                      text: JSON.stringify({
                        verdict: 'APPROVED',
                        score: 100,
                        summary: 'Fallback argon ok.',
                      }),
                    },
                  ],
                },
              },
            ],
          }),
        };
      },
    });
    assert.equal(gemini404FallbackRes.fetchCalls.length, 2);
    assert.equal(
      gemini404FallbackRes.fetchCalls[0].url,
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent'
    );
    assert.equal(
      gemini404FallbackRes.fetchCalls[1].url,
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-4-argon:generateContent'
    );
    assert.equal(
      gemini404FallbackRes.warnings.some((w) => w.includes('gemini-3.8-flash') && w.includes('404')),
      true
    );
    assert.equal(gemini404FallbackRes.createdReviews.length, 1);
    assert.deepEqual(gemini404FallbackRes.addedLabels, ['review:ai-approved']);

    // Non-404 errors (401/500) fail fast without trying fallback models
    for (const errStatus of [401, 500]) {
      const fastFailUrls = [];
      await assert.rejects(
        () =>
          runAiReviewCase({
            geminiApiKey: 'test-key',
            fetchImpl: async (url) => {
              fastFailUrls.push(url);
              return { ok: false, status: errStatus, text: async () => `HTTP ${errStatus} error` };
            },
          }),
        new RegExp(`Gemini API HTTP ${errStatus} \\(gemini-3\\.8-flash\\)`)
      );
      assert.equal(fastFailUrls.length, 1);
    }

    const dependabotYaml = fs.readFileSync(
      path.resolve(projectRoot, '../.github/dependabot.yml'),
      'utf8'
    );
    assert.equal(dependabotYaml.includes('package-ecosystem: "npm"'), true);
    assert.equal(dependabotYaml.includes('package-ecosystem: "gradle"'), true);
    assert.equal(dependabotYaml.includes('package-ecosystem: "github-actions"'), true);
    assert.equal(dependabotYaml.includes('target-branch: "beta"'), true);
    logUnitPass('ai-review fallback models & dependabot.yml verified.');
}
