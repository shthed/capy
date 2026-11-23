/**
 * [Unit 03] .github/scripts cleanup-gh-pages-previews.mjs & cleanup-branches.mjs.
 * [Unit 13] 404.html redirect VM, pr-index.html, generate-pr-manifest.mjs, workflow YAML & upload-pages-artifact dotfiles.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { parseYaml } from './yamlParser.mjs';

const makeMockResponse = ({ ok = true, status = 200, statusText = 'OK', headers = {}, jsonData = null, textData = '' } = {}) => ({
  ok,
  status,
  statusText,
  headers: {
    get(name) {
      const target = String(name || '').toLowerCase();
      for (const [k, v] of Object.entries(headers)) {
        if (k.toLowerCase() === target) return v;
      }
      return null;
    },
  },
  async json() {
    return jsonData;
  },
  async text() {
    return textData;
  },
});

export async function runCiCleanupScriptsTests({ logUnitStart, logUnitPass }) {
    logUnitStart('Testing .github/scripts cleanup-gh-pages-previews.mjs & cleanup-branches.mjs...');
    const previewCleanupMod = await import('../../../../.github/scripts/cleanup-gh-pages-previews.mjs');
    const branchCleanupMod = await import('../../../../.github/scripts/cleanup-branches.mjs');


    // cleanup-gh-pages-previews: 504 transient retry -> 200
    {
      let calls = 0;
      const sleeps = [];
      const res = await previewCleanupMod.requestWithRetry('https://api.github.com/repos/a/b/pulls', {
        baseDelayMs: 1,
        sleepImpl: async (ms) => sleeps.push(ms),
        fetchImpl: async () => {
          calls += 1;
          if (calls === 1) {
            return makeMockResponse({ ok: false, status: 504, statusText: 'Gateway Timeout', textData: 'timeout' });
          }
          return makeMockResponse({ ok: true, status: 200, jsonData: [] });
        },
      });
      assert.equal(calls, 2);
      assert.equal(sleeps.length, 1);
      assert.deepEqual(res.data, []);
    }

    // cleanup-gh-pages-previews: 429 Retry-After honored -> 200
    {
      let calls = 0;
      const sleeps = [];
      await previewCleanupMod.requestWithRetry('https://api.github.com/repos/a/b/pulls', {
        baseDelayMs: 1,
        sleepImpl: async (ms) => sleeps.push(ms),
        fetchImpl: async () => {
          calls += 1;
          if (calls === 1) {
            return makeMockResponse({
              ok: false,
              status: 429,
              statusText: 'Too Many Requests',
              headers: { 'Retry-After': '0.005' },
            });
          }
          return makeMockResponse({ ok: true, status: 200, jsonData: [{ number: 1 }] });
        },
      });
      assert.equal(calls, 2);
      assert.equal(sleeps[0], 5);
    }

    // cleanup-gh-pages-previews: non-rate-limit 403 & 404 fail fast without retry
    {
      let calls404 = 0;
      await assert.rejects(
        () =>
          previewCleanupMod.requestWithRetry('https://api.github.com/repos/a/b/pulls/999', {
            baseDelayMs: 1,
            sleepImpl: async () => {},
            fetchImpl: async () => {
              calls404 += 1;
              return makeMockResponse({ ok: false, status: 404, statusText: 'Not Found' });
            },
          }),
        /404/
      );
      assert.equal(calls404, 1);

      let calls403 = 0;
      await assert.rejects(
        () =>
          previewCleanupMod.requestWithRetry('https://api.github.com/repos/a/b/pulls', {
            baseDelayMs: 1,
            sleepImpl: async () => {},
            fetchImpl: async () => {
              calls403 += 1;
              return makeMockResponse({ ok: false, status: 403, statusText: 'Forbidden' });
            },
          }),
        /403/
      );
      assert.equal(calls403, 1);
    }

    // cleanup-gh-pages-previews: fetchPullRequests uses state=open + targeted PR lookup, ignoring 404
    {
      const requestedUrls = [];
      const pulls = await previewCleanupMod.fetchPullRequests({
        baseUrl: 'https://api.github.com/repos/a/b',
        headers: {},
        targetPr: 484,
        baseDelayMs: 1,
        sleepImpl: async () => {},
        fetchImpl: async (url) => {
          const href = String(url);
          requestedUrls.push(href);
          if (href.includes('/pulls/484')) {
            return makeMockResponse({ ok: true, status: 200, jsonData: { number: 484, state: 'closed', head: { ref: 'feature/x' } } });
          }
          return makeMockResponse({ ok: true, status: 200, jsonData: [{ number: 492, state: 'open', head: { ref: 'fix/y' } }] });
        },
      });
      assert.equal(requestedUrls.some((u) => u.includes('state=open')), true);
      assert.equal(requestedUrls.some((u) => u.includes('state=all')), false);
      assert.equal(requestedUrls.some((u) => u.endsWith('/pulls/484')), true);
      assert.equal(pulls.length, 2);

      const missingTargetPulls = await previewCleanupMod.fetchPullRequests({
        baseUrl: 'https://api.github.com/repos/a/b',
        headers: {},
        targetPr: 999,
        baseDelayMs: 1,
        sleepImpl: async () => {},
        fetchImpl: async (url) => {
          if (String(url).includes('/pulls/999')) {
            return makeMockResponse({ ok: false, status: 404, statusText: 'Not Found' });
          }
          return makeMockResponse({ ok: true, status: 200, jsonData: [{ number: 492, state: 'open', head: { ref: 'fix/y' } }] });
        },
      });
      assert.equal(missingTargetPulls.length, 1);
    }

    // cleanup-gh-pages-previews: selectPreviewDeletions & runCleanupGhPagesPreviews temp dir
    {
      const selected = previewCleanupMod.selectPreviewDeletions(
        [
          { name: '492', kind: 'pull', prNumber: 492, pull: { state: 'open' }, prs: [], hasLiveBranch: true, isRecent: false },
          { name: '484', kind: 'pull', prNumber: 484, pull: { state: 'closed' }, prs: [], hasLiveBranch: false, isRecent: false },
          { name: 'pull', kind: 'legacy', prNumber: null, pull: null, prs: [], hasLiveBranch: false, isRecent: true },
          { name: 'PR', kind: 'legacy', prNumber: null, pull: null, prs: [], hasLiveBranch: false, isRecent: true },
          { name: 'legacy-old', kind: 'legacy', prNumber: null, pull: null, prs: [], hasLiveBranch: false, isRecent: false },
          { name: 'legacy-live', kind: 'legacy', prNumber: null, pull: null, prs: [], hasLiveBranch: true, isRecent: false },
        ],
        { targetPr: null, ignoreRecency: false }
      );
      assert.deepEqual(
        selected.map((s) => s.name),
        ['484', 'pull', 'PR', 'legacy-old']
      );

      const tmpPages = fs.mkdtempSync(path.join(os.tmpdir(), 'capy-gh-pages-cleanup-'));
      try {
        fs.mkdirSync(path.join(tmpPages, 'alpha', '492'), { recursive: true });
        fs.mkdirSync(path.join(tmpPages, 'alpha', '484'), { recursive: true });
        fs.mkdirSync(path.join(tmpPages, 'pull', '123'), { recursive: true });
        fs.mkdirSync(path.join(tmpPages, 'PR', '456'), { recursive: true });
        fs.mkdirSync(path.join(tmpPages, 'stale-legacy-dir'), { recursive: true });
        fs.mkdirSync(path.join(tmpPages, 'live-branch-dir'), { recursive: true });
        fs.mkdirSync(path.join(tmpPages, 'beta'), { recursive: true });
        const capturedPreviewLogs = [];
        const runRes = await previewCleanupMod.runCleanupGhPagesPreviews({
          pagesDir: tmpPages,
          logger: {
            log: (m) => capturedPreviewLogs.push(String(m)),
            warn: (m) => capturedPreviewLogs.push(String(m)),
            error: (m) => capturedPreviewLogs.push(String(m)),
          },
          ignoreRecency: false,
          nowMs: Date.now() + 2 * 24 * 60 * 60 * 1000,
          repository: 'a/b',
          token: 'tok',
          defaultBranch: 'main',
          remoteBranches: ['main', 'beta', 'live-branch-dir'],
          baseDelayMs: 1,
          sleepImpl: async () => {},
          fetchImpl: async () =>
            makeMockResponse({
              ok: true,
              status: 200,
              jsonData: [{ number: 492, state: 'open', head: { ref: 'fix/pr-url-rename' } }],
            }),
        });
        assert.deepEqual(runRes.deleted.sort(), ['PR', 'alpha/484', 'pull', 'stale-legacy-dir']);
        assert.equal(
          capturedPreviewLogs.some((line) => line.includes('alpha/484')),
          true,
          'Custom logger must receive cleanup-gh-pages-previews log output without stdout spam'
        );
        assert.equal(fs.existsSync(path.join(tmpPages, 'alpha', '492')), true);
        assert.equal(fs.existsSync(path.join(tmpPages, 'alpha', '484')), false);
        assert.equal(fs.existsSync(path.join(tmpPages, 'pull')), false);
        assert.equal(fs.existsSync(path.join(tmpPages, 'PR')), false);
        assert.equal(fs.existsSync(path.join(tmpPages, 'stale-legacy-dir')), false);
        assert.equal(fs.existsSync(path.join(tmpPages, 'live-branch-dir')), true);
        assert.equal(fs.existsSync(path.join(tmpPages, 'beta')), true);
      } finally {
        fs.rmSync(tmpPages, { recursive: true, force: true });
      }
    }

    // cleanup-branches: 503 retry, DELETE 404 on retry attempt > 0 success vs attempt 0 fail
    {
      let delCalls = 0;
      await branchCleanupMod.requestWithRetry('https://api.github.com/repos/a/b/git/refs/heads/feature%2Fx', {
        method: 'DELETE',
        retries: 2,
        baseDelayMs: 1,
        sleepImpl: async () => {},
        fetchImpl: async () => {
          delCalls += 1;
          if (delCalls === 1) {
            return makeMockResponse({ ok: false, status: 502, statusText: 'Bad Gateway' });
          }
          return makeMockResponse({ ok: false, status: 404, statusText: 'Not Found' });
        },
      });
      assert.equal(delCalls, 2);

      await assert.rejects(
        () =>
          branchCleanupMod.requestWithRetry('https://api.github.com/repos/a/b/git/refs/heads/missing', {
            method: 'DELETE',
            retries: 2,
            baseDelayMs: 1,
            sleepImpl: async () => {},
            fetchImpl: async () => makeMockResponse({ ok: false, status: 404, statusText: 'Not Found' }),
          }),
        /404/
      );
    }

    // cleanup-branches: protected channels even with *, dependabot/ & sync/ prefixes, closed-unmerged, stale zero-PR vs recent WIP, missing timestamp fail-closed
    {
      const nowMs = Date.parse('2026-11-13T00:00:00Z');
      const dayMs = 24 * 60 * 60 * 1000;
      const commitDates = new Map([
        ['sha-dep-closed-old', nowMs - 2 * dayMs],
        ['sha-dep-closed-fresh', nowMs - 6 * 60 * 60 * 1000],
        ['sha-sync-stale', nowMs - 8 * dayMs],
        ['sha-wip-recent', nowMs - 3 * dayMs],
      ]);
      const evalRes = await branchCleanupMod.evaluateBranchesForCleanup({
        branches: [
          { name: 'main', protected: false, commit: { sha: 's1' } },
          { name: 'beta', protected: false, commit: { sha: 's2' } },
          { name: 'gh-pages', protected: false, commit: { sha: 's3' } },
          { name: 'release-lock', protected: true, commit: { sha: 's4' } },
          { name: 'feature/open-pr', protected: false, commit: { sha: 's5' } },
          { name: 'dependabot/npm/old-closed', protected: false, commit: { sha: 'sha-dep-closed-old' } },
          { name: 'dependabot/npm/fresh-closed', protected: false, commit: { sha: 'sha-dep-closed-fresh' } },
          { name: 'sync/beta-from-main', protected: false, commit: { sha: 'sha-sync-stale' } },
          { name: 'feature/wip-recent', protected: false, commit: { sha: 'sha-wip-recent' } },
          { name: 'fix/no-commit-ts', protected: false, commit: { sha: 'sha-missing' } },
        ],
        defaultBranch: 'main',
        includePrefixes: ['*'],
        activeBranches: new Set(['feature/open-pr']),
        mergedBranches: new Map(),
        closedUnmergedBranches: new Map([
          ['dependabot/npm/old-closed', nowMs - 2 * dayMs],
          ['dependabot/npm/fresh-closed', nowMs - 6 * 60 * 60 * 1000],
        ]),
        getCommitTimestampMs: async (sha) => commitDates.get(sha) ?? 0,
        minAgeDays: 1,
        unmergedMinAgeDays: 7,
        nowMs,
      });
      assert.deepEqual(
        evalRes.deletions.map((d) => d.name),
        ['dependabot/npm/old-closed', 'sync/beta-from-main']
      );

      // Verify explicit prefix list rejects unmatched prefix even when old
      const prefixOnlyRes = await branchCleanupMod.evaluateBranchesForCleanup({
        branches: [
          { name: 'dependabot/npm/old', protected: false, commit: { sha: 'sha-sync-stale' } },
          { name: 'other/old', protected: false, commit: { sha: 'sha-sync-stale' } },
        ],
        includePrefixes: ['dependabot/', 'sync/'],
        getCommitTimestampMs: async () => nowMs - 10 * dayMs,
        minAgeDays: 1,
        unmergedMinAgeDays: 7,
        nowMs,
      });
      assert.deepEqual(
        prefixOnlyRes.deletions.map((d) => d.name),
        ['dependabot/npm/old']
      );

      // Reused merged branch with fresh commit is NOT deleted; stale merged branch IS deleted; null/error commit timestamp fails closed
      const reusedMergedRes = await branchCleanupMod.evaluateBranchesForCleanup({
        branches: [
          { name: 'sync/reused-fresh', protected: false, commit: { sha: 'sha-reused-fresh' } },
          { name: 'feature/merged-stale', protected: false, commit: { sha: 'sha-merged-stale' } },
          { name: 'fix/merged-null-ts', protected: false, commit: { sha: 'sha-null-ts' } },
          { name: 'fix/merged-error-ts', protected: false, commit: { sha: 'sha-error-ts' } },
        ],
        includePrefixes: ['sync/', 'feature/', 'fix/'],
        mergedBranches: new Map([
          ['sync/reused-fresh', nowMs - 5 * dayMs],
          ['feature/merged-stale', nowMs - 5 * dayMs],
          ['fix/merged-null-ts', nowMs - 5 * dayMs],
          ['fix/merged-error-ts', nowMs - 5 * dayMs],
        ]),
        getCommitTimestampMs: async (sha) => {
          if (sha === 'sha-reused-fresh') return nowMs - 60 * 60 * 1000;
          if (sha === 'sha-merged-stale') return nowMs - 5 * dayMs;
          if (sha === 'sha-null-ts') return null;
          throw new Error('simulated commit lookup failure');
        },
        minAgeDays: 1,
        nowMs,
      });
      assert.deepEqual(reusedMergedRes.deletions, [{ name: 'feature/merged-stale', reason: 'merged' }]);
      assert.equal(
        reusedMergedRes.diagnostics.some(
          (d) =>
            d.name === 'sync/reused-fresh' &&
            d.detail.includes('merged branch has newer commit within minAgeDays')
        ),
        true
      );
      assert.equal(
        reusedMergedRes.diagnostics.some(
          (d) =>
            d.name === 'fix/merged-null-ts' &&
            d.detail === 'skipped: unable to determine commit timestamp'
        ),
        true
      );
      assert.equal(
        reusedMergedRes.diagnostics.some(
          (d) =>
            d.name === 'fix/merged-error-ts' &&
            d.detail === 'skipped: unable to determine commit timestamp'
        ),
        true
      );
    }

    // cleanup-branches: end-to-end runCleanupBranches with dryRun vs live DELETE
    {
      const nowMs = Date.parse('2026-11-13T00:00:00Z');
      const oldIso = '2026-11-01T00:00:00Z';
      const createMockFetch = (deleteCalls) => async (url, init = {}) => {
        const href = String(url);
        const method = init.method || 'GET';
        if (method === 'DELETE') {
          deleteCalls.push(href);
          return makeMockResponse({ ok: true, status: 204 });
        }
        if (href.endsWith('/repos/a/b')) {
          return makeMockResponse({ ok: true, status: 200, jsonData: { default_branch: 'main' } });
        }
        if (href.includes('/pulls') && href.includes('state=open')) {
          return makeMockResponse({ ok: true, status: 200, jsonData: [] });
        }
        if (href.includes('/pulls') && href.includes('state=closed')) {
          return makeMockResponse({ ok: true, status: 200, jsonData: [] });
        }
        if (href.includes('/branches')) {
          return makeMockResponse({
            ok: true,
            status: 200,
            jsonData: [
              { name: 'beta', protected: false, commit: { sha: 'sha-beta' } },
              { name: 'dependabot/npm/stale', protected: false, commit: { sha: 'sha-stale' } },
            ],
          });
        }
        if (href.includes('/commits/sha-stale')) {
          return makeMockResponse({
            ok: true,
            status: 200,
            jsonData: { commit: { committer: { date: oldIso } } },
          });
        }
        return makeMockResponse({ ok: false, status: 404 });
      };

      const dryDeletes = [];
      let quietSpyLogs = 0;
      await branchCleanupMod.runCleanupBranches({
        repository: 'a/b',
        token: 'tok',
        dryRun: true,
        quiet: true,
        logger: {
          log: () => { quietSpyLogs += 1; },
          warn: () => { quietSpyLogs += 1; },
          error: () => { quietSpyLogs += 1; },
        },
        includePrefixes: ['dependabot/', 'sync/'],
        minAgeDays: 1,
        unmergedMinAgeDays: 7,
        nowMs,
        baseDelayMs: 1,
        sleepImpl: async () => {},
        fetchImpl: createMockFetch(dryDeletes),
      });
      assert.equal(dryDeletes.length, 0);
      assert.equal(quietSpyLogs, 0, 'quiet: true must suppress cleanup-branches logging');

      const liveDeletes = [];
      const capturedBranchLogs = [];
      const liveRes = await branchCleanupMod.runCleanupBranches({
        repository: 'a/b',
        token: 'tok',
        dryRun: false,
        logger: {
          log: (m) => capturedBranchLogs.push(String(m)),
          warn: (m) => capturedBranchLogs.push(String(m)),
          error: (m) => capturedBranchLogs.push(String(m)),
        },
        includePrefixes: ['dependabot/', 'sync/'],
        minAgeDays: 1,
        unmergedMinAgeDays: 7,
        nowMs,
        baseDelayMs: 1,
        sleepImpl: async () => {},
        fetchImpl: createMockFetch(liveDeletes),
      });
      assert.equal(liveDeletes.length, 1);
      assert.equal(liveDeletes[0].endsWith('/git/refs/heads/dependabot/npm/stale'), true);
      assert.deepEqual(liveRes.deleted, ['dependabot/npm/stale']);
      assert.equal(
        capturedBranchLogs.some((line) => line.includes('deleted 1 branch(es)')),
        true,
        'Custom logger must receive cleanup-branches summary without stdout spam'
      );
    }
    logUnitPass('cleanup-gh-pages-previews.mjs & cleanup-branches.mjs retries, filtering & quiet/logger options verified.');
}

export async function runCiPagesWorkflowTests({ projectRoot, logUnitStart, logUnitPass }) {
    const previewCleanupMod = await import('../../../../.github/scripts/cleanup-gh-pages-previews.mjs');
    logUnitStart('Testing 404.html redirect VM behavior, pr-index.html, generate-pr-manifest.mjs & workflow wiring...');
    const notFoundHtmlPath = path.resolve(projectRoot, 'public/404.html');
    const notFoundHtml = fs.readFileSync(notFoundHtmlPath, 'utf8');
    assert.equal(notFoundHtml.includes('/capy/alpha/?missing='), true, '404.html must redirect to /capy/alpha/?missing=');
    assert.equal(notFoundHtml.includes('(alpha|PR|pull)'), true, '404.html must match /capy/alpha/, /capy/PR/, and /capy/pull/');
    assert.equal(notFoundHtml.includes('href="/capy/alpha/"'), true, '404.html must include fallback /capy/alpha/ link');

    const scriptMatch = notFoundHtml.match(/<script>([\s\S]*?)<\/script>/);
    assert.ok(scriptMatch, '404.html must contain an inline redirect script');
    const run404Redirect = (pathname) => {
      let replacedWith = null;
      const msgEl = { textContent: '' };
      const prLinkEl = {
        attrs: {},
        setAttribute(k, v) {
          this.attrs[k] = v;
        },
      };
      const sandbox = {
        encodeURIComponent,
        window: {
          location: {
            pathname,
            replace(url) {
              replacedWith = url;
            },
          },
        },
        document: {
          getElementById(id) {
            if (id === 'message') return msgEl;
            if (id === 'pr-link') return prLinkEl;
            return null;
          },
        },
      };
      vm.runInNewContext(scriptMatch[1], sandbox);
      return { replacedWith, msg: msgEl.textContent, href: prLinkEl.attrs.href ?? null };
    };

    assert.equal(run404Redirect('/capy/alpha/491/').replacedWith, '/capy/alpha/?missing=491');
    assert.equal(run404Redirect('/capy/PR/491/').replacedWith, '/capy/alpha/?missing=491');
    assert.equal(run404Redirect('/capy/pull/489/').replacedWith, '/capy/alpha/?missing=489');
    assert.equal(run404Redirect('/capy/PR/').replacedWith, '/capy/alpha/');
    assert.equal(run404Redirect('/capy/pull/').replacedWith, '/capy/alpha/');
    assert.equal(run404Redirect('/capy/alpha/').replacedWith, null, '404.html must not loop on /capy/alpha/');
    assert.equal(run404Redirect('/capy/alpha').replacedWith, null, '404.html must not loop on /capy/alpha');
    assert.equal(run404Redirect('/capy/beta/missing').replacedWith, null, '404.html must not redirect /capy/beta/*');
    assert.equal(run404Redirect('/capy/unknown').replacedWith, null, '404.html must not redirect /capy/unknown');
    assert.equal(run404Redirect('/capy/privacy-policy.html').replacedWith, null, '404.html must not redirect /capy/privacy-policy.html');
    assert.equal(run404Redirect('/capy/preview').replacedWith, null, '404.html must not redirect /capy/preview');
    assert.equal(run404Redirect('/capy/pull-request').replacedWith, null, '404.html must not redirect /capy/pull-request');
    assert.equal(run404Redirect('/capy/alpha-test').replacedWith, null, '404.html must not redirect /capy/alpha-test');
    assert.equal(run404Redirect('/capy/alpha/491').replacedWith, '/capy/alpha/?missing=491');
    assert.equal(run404Redirect('/capy/alpha///491').replacedWith, '/capy/alpha/?missing=491');
    assert.equal(run404Redirect('/capy/pull/491').replacedWith, '/capy/alpha/?missing=491');
    assert.equal(run404Redirect('/capy/PR/491/sub?x=1#y').replacedWith, '/capy/alpha/?missing=491');

    const prIndexHtmlPath = path.resolve(projectRoot, '../.github/scripts/pr-index.html');
    const prIndexHtml = fs.readFileSync(prIndexHtmlPath, 'utf8');
    assert.equal(prIndexHtml.includes('/capy/alpha/'), true, 'pr-index.html must target /capy/alpha/');
    assert.equal(prIndexHtml.includes("fetch('manifest.json', { cache: 'no-store' })"), true, 'pr-index.html must fetch manifest.json with no-store');
    assert.equal(prIndexHtml.includes("params.get('missing')"), true, 'pr-index.html must read ?missing= query parameter');
    assert.equal(prIndexHtml.includes('/capy/PR/'), false, 'pr-index.html must not reference legacy /capy/PR/');
    assert.equal(prIndexHtml.toLowerCase().includes('shthed'), false, 'pr-index.html must not hardcode owner slug');
    assert.equal(prIndexHtml.includes('deriveRepoSlug'), true, 'pr-index.html must derive repo slug dynamically');

    const { generatePrManifest } = await import('../../../../.github/scripts/generate-pr-manifest.mjs');
    const tmpPagesDir = fs.mkdtempSync(path.join(os.tmpdir(), 'capy-pr-manifest-'));
    try {
      const alphaDir = path.join(tmpPagesDir, 'alpha');
      fs.mkdirSync(path.join(alphaDir, '485'), { recursive: true });
      fs.mkdirSync(path.join(alphaDir, '491'), { recursive: true });
      fs.mkdirSync(path.join(alphaDir, 'feature-x'), { recursive: true });
      fs.mkdirSync(path.join(alphaDir, 'not-a-pr'), { recursive: true });
      fs.writeFileSync(path.join(alphaDir, '491', 'capy.apk'), 'apk');

      const manifest = generatePrManifest({ pagesDir: tmpPagesDir });
      assert.deepEqual(
        manifest.prs.map((p) => ({ number: p.number, path: p.path, hasApk: p.hasApk })),
        [
          { number: 491, path: '/capy/alpha/491/', hasApk: true },
          { number: 485, path: '/capy/alpha/485/', hasApk: false },
        ],
        'generatePrManifest must sort numeric PR directories descending, emit /capy/alpha/<id>/, and exclude non-numeric dirs'
      );
      const writtenManifest = JSON.parse(fs.readFileSync(path.join(alphaDir, 'manifest.json'), 'utf8'));
      assert.deepEqual(
        writtenManifest.prs.map((p) => p.path),
        ['/capy/alpha/491/', '/capy/alpha/485/']
      );
      assert.equal(fs.existsSync(path.join(alphaDir, 'index.html')), true, 'alpha/index.html must be copied');
      assert.equal(fs.existsSync(path.join(tmpPagesDir, '404.html')), true, 'root 404.html must be seeded when missing');

      // Passing alpha/ subdirectory directly must resolve rootPagesDir cleanly
      const subManifest = generatePrManifest({ pagesDir: alphaDir });
      assert.equal(subManifest.prs.length, 2);

      // Existing 404.html must be preserved when refreshNotFound is false, and overwritten when refreshNotFound is true
      const dest404Path = path.join(tmpPagesDir, '404.html');
      fs.writeFileSync(dest404Path, 'stale-404-sentinel', 'utf8');
      generatePrManifest({ pagesDir: tmpPagesDir, refreshNotFound: false });
      assert.equal(fs.readFileSync(dest404Path, 'utf8'), 'stale-404-sentinel');

      generatePrManifest({ pagesDir: tmpPagesDir, refreshNotFound: true });
      assert.equal(fs.readFileSync(dest404Path, 'utf8'), notFoundHtml);

      // Verify CLI flags --pages-dir, --not-found-src, and --refresh-404
      fs.writeFileSync(dest404Path, 'cli-stale-sentinel', 'utf8');
      execFileSync(process.execPath, [
        path.resolve(projectRoot, '../.github/scripts/generate-pr-manifest.mjs'),
        '--pages-dir',
        tmpPagesDir,
        '--not-found-src',
        notFoundHtmlPath,
        '--refresh-404',
      ]);
      assert.equal(fs.readFileSync(dest404Path, 'utf8'), notFoundHtml);

      // cleanup-gh-pages-previews must preserve alpha/index.html and alpha/manifest.json intact
      const cleanupRes = await previewCleanupMod.runCleanupGhPagesPreviews({
        pagesDir: tmpPagesDir,
        quiet: true,
        ignoreRecency: true,
        repository: 'a/b',
        token: 'tok',
        defaultBranch: 'main',
        remoteBranches: ['main', 'beta'],
        baseDelayMs: 1,
        sleepImpl: async () => {},
        fetchImpl: async () =>
          makeMockResponse({
            ok: true,
            status: 200,
            jsonData: [{ number: 491, state: 'open', head: { ref: 'fix/pr-404-redirect' } }],
          }),
      });
      assert.equal(cleanupRes.deleted.includes('alpha/485'), true);
      assert.equal(fs.existsSync(path.join(alphaDir, '491')), true);
      assert.equal(fs.existsSync(path.join(alphaDir, '485')), false);
      assert.equal(fs.existsSync(path.join(alphaDir, 'index.html')), true, 'alpha/index.html must survive preview cleanup');
      assert.equal(fs.existsSync(path.join(alphaDir, 'manifest.json')), true, 'alpha/manifest.json must survive preview cleanup');
    } finally {
      fs.rmSync(tmpPagesDir, { recursive: true, force: true });
    }

    const deployWorkflowYaml = fs.readFileSync(
      path.resolve(projectRoot, '../.github/workflows/deploy-branch.yml'),
      'utf8'
    );
    assert.equal(deployWorkflowYaml.includes('generate-pr-manifest.mjs'), true);
    assert.equal(deployWorkflowYaml.includes('web/public/404.html'), true);
    assert.equal(deployWorkflowYaml.includes('--refresh-404'), true);
    assert.equal(deployWorkflowYaml.includes('ls -lah "${LIST_PATH}"'), true);

    const cleanupWorkflowYaml = fs.readFileSync(
      path.resolve(projectRoot, '../.github/workflows/cleanup-closed-pr.yml'),
      'utf8'
    );
    assert.equal(cleanupWorkflowYaml.includes('generate-pr-manifest.mjs'), true);

    // Parse all .github/workflows/*.yml via pure-Node parseYaml and verify Upload Pages artifact preserves hidden dotfiles
    const workflowsDir = path.resolve(projectRoot, '../.github/workflows');
    const parsedWorkflows = {};
    for (const wfName of fs.readdirSync(workflowsDir).filter((f) => f.endsWith('.yml')).sort()) {
      parsedWorkflows[wfName] = parseYaml(fs.readFileSync(path.join(workflowsDir, wfName), 'utf8'), wfName);
    }
    for (const [wfFile, jobName] of [
      ['deploy-branch.yml', 'deploy_preview'],
      ['deploy-branch.yml', 'deploy'],
      ['cleanup-closed-pr.yml', 'cleanup'],
      ['cleanup-branches.yml', 'cleanup'],
    ]) {
      const steps = parsedWorkflows?.[wfFile]?.jobs?.[jobName]?.steps || [];
      const uploadPagesStep = steps.find(
        (s) => typeof s?.uses === 'string' && s.uses.startsWith('actions/upload-pages-artifact@')
      );
      assert.ok(uploadPagesStep, `Expected actions/upload-pages-artifact step in ${wfFile}`);
      assert.equal(
        uploadPagesStep?.with?.['include-hidden-files'],
        true,
        `${wfFile} Upload Pages artifact step must set include-hidden-files: true`
      );
    }

    /* capy-dev-only:start */
    // Verify regenerate-puzzles.yml triggers only on workflow_dispatch or path-filtered pushes to beta (no schedule).
    // Note: regenerate-puzzles.yml is a dev-only workflow stripped from clean-room capyboop/paint exports.
    const regenWorkflowPath = path.resolve(projectRoot, '../.github/workflows/regenerate-puzzles.yml');
    if (fs.existsSync(regenWorkflowPath)) {
      const regenWorkflow = parsedWorkflows?.['regenerate-puzzles.yml'];
      assert.ok(regenWorkflow, 'Expected parsed regenerate-puzzles.yml workflow');
      // PyYAML parses YAML 1.1 `on:` as boolean True -> JSON key "true"
      const regenOn = regenWorkflow.on ?? regenWorkflow.true;
      assert.ok(regenOn && typeof regenOn === 'object', 'Expected on: block in regenerate-puzzles.yml');
      assert.equal(
        Object.prototype.hasOwnProperty.call(regenOn, 'schedule'),
        false,
        'regenerate-puzzles.yml must not trigger on a cron schedule'
      );
      assert.equal(
        Object.prototype.hasOwnProperty.call(regenOn, 'workflow_dispatch'),
        true,
        'regenerate-puzzles.yml must retain workflow_dispatch for on-demand runs'
      );
      const regenPush = regenOn.push;
      assert.ok(regenPush && Array.isArray(regenPush.branches), 'regenerate-puzzles.yml must define push.branches');
      assert.equal(
        regenPush.branches.includes('beta'),
        true,
        'regenerate-puzzles.yml push.branches must include beta'
      );
      assert.ok(Array.isArray(regenPush.paths), 'regenerate-puzzles.yml must define push.paths');
      for (const expectedPath of [
        'web/public/assets/**',
        '!web/public/assets/**/*.capy',
        '!web/public/assets/presets/**',
        '!web/public/assets/icon-*.png',
        '!web/public/assets/apple-touch-icon.png',
        'web/scripts/generate-sample-saves.mjs',
        'web/src/engine/**',
        'web/src/services/CapyCodec.ts',
        'web/src/services/DailyPuzzleService.ts',
        'web/src/services/PuzzleWorkerService.ts',
        'web/src/services/StorageService.ts',
        'web/src/types/index.ts',
        '.github/workflows/regenerate-puzzles.yml',
      ]) {
        assert.equal(
          regenPush.paths.includes(expectedPath),
          true,
          `regenerate-puzzles.yml push.paths must include ${expectedPath}`
        );
      }
    }
    /* capy-dev-only:end */
    logUnitPass('404.html redirect VM, pr-index.html, generate-pr-manifest.mjs & upload-pages-artifact dotfiles verified.');
}
