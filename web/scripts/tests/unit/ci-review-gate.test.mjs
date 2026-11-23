/**
 * [Unit 08] (Dev-Only) pr-review-gate.yml review/score/checklist/sync gate logic.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

export async function runCiReviewGateTests({ projectRoot, logUnitStart, logUnitPass, devShared }) {
    logUnitStart('Testing pr-review-gate.yml review/score/checklist/sync gate logic...');
    const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
    const extractWorkflowScript = (workflowRelPath) => {
      const raw = fs.readFileSync(path.resolve(projectRoot, '..', workflowRelPath), 'utf8');
      const lines = raw.split(/\r?\n/);
      const scriptIdx = lines.findIndex((line) => /^\s*script:\s*\|\s*$/.test(line));
      assert.notEqual(scriptIdx, -1, `Expected script: | block in ${workflowRelPath}`);
      const headerIndent = lines[scriptIdx].match(/^(\s*)/)[1].length;
      let bodyIndent = null;
      const bodyLines = [];
      for (let i = scriptIdx + 1; i < lines.length; i++) {
        const line = lines[i];
        if (line.trim() === '') {
          bodyLines.push('');
          continue;
        }
        const indent = line.match(/^(\s*)/)[1].length;
        if (bodyIndent === null) {
          assert.equal(
            indent > headerIndent,
            true,
            `Expected indented script body in ${workflowRelPath}`
          );
          bodyIndent = indent;
        } else if (indent < bodyIndent) {
          break;
        }
        bodyLines.push(line.slice(bodyIndent));
      }
      return bodyLines.join('\n');
    };

    const prReviewGateSource = extractWorkflowScript('.github/workflows/pr-review-gate.yml');
    const gateDualPassDesc =
      'Main gate passed (no Owner approval needed): AI review (100%) verified';
    const gateBetaPassDesc =
      'Beta gate passed (no Owner approval needed): AI review (100%) verified';
    const gateMainAwaitingAiDesc =
      'Main (no Owner approval needed): Blocked by AI review';
    const gateMainAwaitingAiAndOwnerDesc =
      'Main (no Owner approval needed): Blocked by AI review';
    const gateMainAwaitingOwnerDesc =
      'Main gate passed (no Owner approval needed): AI review (100%) verified';
    const gateBetaAwaitingAiDesc =
      'Beta (no Owner approval needed): Blocked by AI review';
    const gateDraftDesc =
      'Main (no Owner approval needed): Blocked by Draft PR, PR readiness/100% score';
    const gateStrictNotMetDesc =
      'Beta (no Owner approval needed): Blocked by PR readiness/100% score';
    const gateMainStrictNotMetNoOwnerDesc =
      'Main (no Owner approval needed): Blocked by PR readiness/100% score';

    const runReviewGateScript = new AsyncFunction(
      'context',
      'github',
      'core',
      prReviewGateSource
    );

    const validStrictPrBody = [
      '## Summary',
      '',
      'Ships clean async CI checks and strict readiness verification.',
      '',
      '### PR Readiness Score: 100%',
      '',
      '<details>',
      '<summary>PR Readiness Checklist</summary>',
      '',
      '- **100%** — **Functionality & Edge Cases**: Verified cleanly.',
      '- **100%** — **Automated Tests**: Passed locally.',
      '',
      '</details>',
    ].join('\n');

    const runReviewGateCase = async (options = {}) => {
      const {
        prAuthor = 'github-actions[bot]',
        baseRef = 'main',
        isDraft = false,
        headSha = 'abcdef1234567890abcdef1234567890abcdef12',
        headRef = undefined,
        headRepoFullName = 'shthed/capy',
        headTreeSha = 'tree-main',
        nodeId = 'PR_node_1',
        autoMerge = null,
        commitsByRef = null,
        compareMap = null,
        commitDate = '2026-11-13T01:00:00Z',
        labels = ['review:ai-approved'],
        events = [],
        reviews = [],
        comments = [],
        commitStatuses = [],
        aiCommentScore = 100,
        aiCommentBody = null,
        aiCommentTs = '2026-11-13T01:01:00Z',
        eventName = 'pull_request_review',
        action = 'submitted',
        actionsGithubToken = undefined,
        fetchImpl = null,
        createCommitStatusImpl = null,
        graphqlImpl = null,
        mergeImpl = null,
        requestImpl = null,
        mergeableState = undefined,
        checkRuns = null,
        changedFiles = null,
        expectCommitStatus = true,
      } = options;
      const body = 'body' in options ? options.body : validStrictPrBody;
      const calls = {
        createComment: [],
        updateComment: [],
        createReview: [],
        dismissReview: [],
        addLabels: [],
        removeLabel: [],
        createCommitStatus: [],
        fetch: [],
        graphql: [],
        merge: [],
        listForRef: [],
        request: [],
      };
      const allComments = [...comments];
      if (aiCommentScore !== null) {
        allComments.unshift({
          user: { login: 'shthed' },
          body:
            aiCommentBody ??
            `<!-- capy-review: actor=ai-agent verdict=APPROVED sha=${headSha} score=${aiCommentScore}% -->`,
          created_at: aiCommentTs,
          updated_at: aiCommentTs,
        });
      }
      const coreMock = {
        infos: [],
        warnings: [],
        failed: [],
        info: (msg) => coreMock.infos.push(msg),
        warning: (msg) => coreMock.warnings.push(msg),
        setFailed: (msg) => coreMock.failed.push(msg),
      };
      const githubMock = {
        paginate: async (fn, params) => {
          const res = await fn(params);
          return res.data;
        },
        graphql: async (query, variables) => {
          calls.graphql.push({ query, variables });
          if (graphqlImpl) {
            return graphqlImpl(query, variables);
          }
          return {};
        },
        request: async (route, payload) => {
          calls.request.push({ route, payload });
          if (requestImpl) {
            return requestImpl(route, payload);
          }
          return { status: 202, data: { status: 'pending', details: { uuid: 'uuid-async-1' } } };
        },
        rest: {
          pulls: {
            get: async () => ({
              data: {
                number: 490,
                state: 'open',
                draft: isDraft,
                user: { login: prAuthor },
                base: { ref: baseRef },
                head: {
                  sha: headSha,
                  ...(headRef ? { ref: headRef } : {}),
                  repo: { full_name: headRepoFullName },
                },
                ...(body !== undefined ? { body } : {}),
                node_id: nodeId,
                auto_merge: autoMerge,
                labels: labels.map((name) => ({ name })),
                ...(mergeableState !== undefined
                  ? { mergeable: true, mergeable_state: mergeableState }
                  : {}),
              },
            }),
            listReviews: async () => ({ data: reviews }),
            ...(changedFiles !== null ? { listFiles: async () => ({ data: changedFiles }) } : {}),
            createReview: async (payload) => {
              calls.createReview.push(payload);
              return { data: { id: 9001 } };
            },
            dismissReview: async (payload) => {
              calls.dismissReview.push(payload);
              return { data: {} };
            },
            merge: async (payload) => {
              calls.merge.push(payload);
              if (mergeImpl) {
                return mergeImpl(payload);
              }
              return { data: { merged: true, sha: headSha } };
            },
          },
          checks: {
            listForRef: async () => {
              calls.listForRef.push(true);
              const resolvedRuns =
                checkRuns !== null
                  ? checkRuns
                  : [
                      { name: 'Build & Test', status: 'completed', conclusion: 'success', started_at: '2026-11-13T01:01:00Z' },
                      { name: 'Android APK', status: 'completed', conclusion: 'success', started_at: '2026-11-13T01:01:00Z' },
                      { name: 'Playwright E2E', status: 'completed', conclusion: 'success', started_at: '2026-11-13T01:01:00Z' },
                    ];
              return { data: { check_runs: resolvedRuns } };
            },
          },
          repos: {
            getCommit: async ({ ref }) => {
              if (commitsByRef && commitsByRef[ref]) {
                return { data: commitsByRef[ref] };
              }
              return {
                data: {
                  sha: headSha,
                  commit: {
                    committer: { date: commitDate },
                    author: { date: commitDate },
                    tree: { sha: headTreeSha },
                  },
                },
              };
            },
            compareCommitsWithBasehead: async ({ basehead }) => {
              if (compareMap && compareMap[basehead]) {
                return { data: compareMap[basehead] };
              }
              return { data: { ahead_by: 1, commits: [], files: [] } };
            },
            listCommitStatusesForRef: async () => ({ data: commitStatuses }),
            createCommitStatus: async (payload) => {
              calls.createCommitStatus.push(payload);
              if (createCommitStatusImpl) {
                return createCommitStatusImpl(payload);
              }
              return { data: payload };
            },
          },
          issues: {
            listEvents: async () => ({ data: events }),
            listComments: async () => ({ data: allComments }),
            createComment: async (payload) => {
              calls.createComment.push(payload);
              return { data: { id: 8001, body: payload.body } };
            },
            updateComment: async (payload) => {
              calls.updateComment.push(payload);
              return { data: { id: payload.comment_id, body: payload.body } };
            },
            addLabels: async (payload) => {
              calls.addLabels.push(payload);
              return { data: {} };
            },
            removeLabel: async (payload) => {
              calls.removeLabel.push(payload);
              return { data: {} };
            },
          },
        },
      };
      const contextMock = {
        repo: { owner: 'shthed', repo: 'capy' },
        eventName,
        payload: { pull_request: { number: 490 }, action },
      };
      const prevActionsGithubToken = process.env.ACTIONS_GITHUB_TOKEN;
      const prevFetch = globalThis.fetch;
      if (actionsGithubToken) {
        process.env.ACTIONS_GITHUB_TOKEN = actionsGithubToken;
      } else {
        delete process.env.ACTIONS_GITHUB_TOKEN;
      }
      globalThis.fetch = async (url, init) => {
        calls.fetch.push({ url, init });
        if (fetchImpl) {
          return fetchImpl(url, init);
        }
        throw new Error(`Unexpected fetch call in runReviewGateCase: ${url}`);
      };
      try {
        await runReviewGateScript(contextMock, githubMock, coreMock);
      } finally {
        if (prevActionsGithubToken === undefined) {
          delete process.env.ACTIONS_GITHUB_TOKEN;
        } else {
          process.env.ACTIONS_GITHUB_TOKEN = prevActionsGithubToken;
        }
        globalThis.fetch = prevFetch;
      }
      assert.equal(coreMock.failed.length, 0);
      if (expectCommitStatus) {
        assert.equal(calls.createCommitStatus.length, 1);
      }
      return { status: calls.createCommitStatus[0], calls, core: coreMock };
    };

    const gateHeadSha = '1234567890abcdef1234567890abcdef12345678';
    // (a) Bot PR on main + strict 100% AI review -> auto-approved with MERGE auto-merge (and no bot review creation)
    const gateBotNativeRes = await runReviewGateCase({
      prAuthor: 'github-actions[bot]',
      headSha: gateHeadSha,
      commitDate: '2026-11-13T02:00:00Z',
      reviews: [
        {
          id: 101,
          user: { login: 'shthed' },
          state: 'APPROVED',
          commit_id: gateHeadSha,
          body: '',
          submitted_at: '2026-11-13T01:10:00Z',
        },
      ],
    });
    assert.equal(gateBotNativeRes.status.state, 'success');
    assert.equal(gateBotNativeRes.status.description, gateDualPassDesc);
    assert.equal(gateBotNativeRes.calls.createReview.length, 0);
    assert.equal(gateBotNativeRes.calls.graphql.length, 1);
    assert.equal(gateBotNativeRes.calls.graphql[0].variables.mergeMethod, 'MERGE');

    // (b) Bot PR + review:owner-approved label without AI approval -> pending awaiting strict 100% AI review
    const gateBotLabelOnlyRes = await runReviewGateCase({
      prAuthor: 'github-actions[bot]',
      headSha: gateHeadSha,
      commitDate: '2026-11-13T01:00:00Z',
      labels: ['review:owner-approved'],
      aiCommentScore: null,
      events: [
        {
          event: 'labeled',
          label: { name: 'review:owner-approved' },
          actor: { login: 'shthed' },
          created_at: '2026-11-13T01:05:00Z',
        },
      ],
      eventName: 'pull_request',
      action: 'labeled',
    });
    assert.equal(gateBotLabelOnlyRes.status.state, 'pending');
    assert.equal(gateBotLabelOnlyRes.status.description, gateMainAwaitingAiAndOwnerDesc);
    assert.equal(gateBotLabelOnlyRes.calls.createReview.length, 0);
    assert.equal(gateBotLabelOnlyRes.calls.graphql.length, 0);

    // (c) Bot PR + APPROVED/LGTM comment without AI approval -> pending awaiting strict 100% AI review
    const gateBotCommentOnlyRes = await runReviewGateCase({
      prAuthor: 'github-actions[bot]',
      headSha: gateHeadSha,
      commitDate: '2026-11-13T01:00:00Z',
      labels: [],
      aiCommentScore: null,
      comments: [
        {
          user: { login: 'shthed' },
          body: 'APPROVED',
          created_at: '2026-11-13T01:05:00Z',
          updated_at: '2026-11-13T01:05:00Z',
        },
      ],
      eventName: 'issue_comment',
      action: 'created',
    });
    assert.equal(gateBotCommentOnlyRes.status.state, 'pending');
    assert.equal(gateBotCommentOnlyRes.status.description, gateMainAwaitingAiAndOwnerDesc);
    assert.equal(gateBotCommentOnlyRes.calls.createReview.length, 0);

    const gateBotLgtmReviewOnlyRes = await runReviewGateCase({
      prAuthor: 'github-actions[bot]',
      headSha: gateHeadSha,
      commitDate: '2026-11-13T01:00:00Z',
      labels: [],
      aiCommentScore: null,
      reviews: [
        {
          id: 102,
          user: { login: 'shthed' },
          state: 'COMMENTED',
          commit_id: gateHeadSha,
          body: 'LGTM',
          submitted_at: '2026-11-13T01:06:00Z',
        },
      ],
    });
    assert.equal(gateBotLgtmReviewOnlyRes.status.state, 'pending');
    assert.equal(gateBotLgtmReviewOnlyRes.status.description, gateMainAwaitingAiAndOwnerDesc);
    assert.equal(gateBotLgtmReviewOnlyRes.calls.createReview.length, 0);

    // (d) Stale APPROVED (commit_id !== headSha) or pre-force-push -> pending without AI AND cannot clear active HOLD
    const gateBotStaleShaRes = await runReviewGateCase({
      prAuthor: 'github-actions[bot]',
      headSha: gateHeadSha,
      commitDate: '2026-11-13T01:00:00Z',
      labels: [],
      aiCommentScore: null,
      reviews: [
        {
          id: 103,
          user: { login: 'shthed' },
          state: 'APPROVED',
          commit_id: '0000000000000000000000000000000000000000',
          body: '',
          submitted_at: '2026-11-13T01:05:00Z',
        },
      ],
    });
    assert.equal(gateBotStaleShaRes.status.state, 'pending');
    assert.equal(gateBotStaleShaRes.status.description, gateMainAwaitingAiAndOwnerDesc);
    assert.equal(gateBotStaleShaRes.calls.createReview.length, 0);

    const gateBotStaleShaCannotClearHoldRes = await runReviewGateCase({
      prAuthor: 'github-actions[bot]',
      headSha: gateHeadSha,
      commitDate: '2026-11-13T01:00:00Z',
      comments: [
        {
          id: 1031,
          user: { login: 'shthed' },
          body: 'HOLD - fix required',
          created_at: '2026-11-13T01:04:00Z',
          updated_at: '2026-11-13T01:04:00Z',
        },
      ],
      reviews: [
        {
          id: 103,
          user: { login: 'shthed' },
          state: 'APPROVED',
          commit_id: '0000000000000000000000000000000000000000',
          body: '',
          submitted_at: '2026-11-13T01:06:00Z',
        },
      ],
    });
    assert.equal(gateBotStaleShaCannotClearHoldRes.status.state, 'failure');

    const gateBotPreForcePushRes = await runReviewGateCase({
      prAuthor: 'github-actions[bot]',
      headSha: gateHeadSha,
      commitDate: '2026-11-13T01:00:00Z',
      labels: [],
      aiCommentScore: null,
      events: [{ event: 'head_ref_force_pushed', created_at: '2026-11-13T01:10:00Z' }],
      reviews: [
        {
          id: 104,
          user: { login: 'shthed' },
          state: 'APPROVED',
          commit_id: gateHeadSha,
          body: '',
          submitted_at: '2026-11-13T01:05:00Z',
        },
      ],
    });
    assert.equal(gateBotPreForcePushRes.status.state, 'pending');
    assert.equal(gateBotPreForcePushRes.calls.createReview.length, 0);

    const gateBotPreForcePushCannotClearHoldRes = await runReviewGateCase({
      prAuthor: 'github-actions[bot]',
      headSha: gateHeadSha,
      commitDate: '2026-11-13T01:00:00Z',
      events: [{ event: 'head_ref_force_pushed', created_at: '2026-11-13T01:10:00Z' }],
      comments: [
        {
          id: 1041,
          user: { login: 'shthed' },
          body: 'HOLD - after force push',
          created_at: '2026-11-13T01:11:00Z',
          updated_at: '2026-11-13T01:11:00Z',
        },
      ],
      reviews: [
        {
          id: 104,
          user: { login: 'shthed' },
          state: 'APPROVED',
          commit_id: gateHeadSha,
          body: '',
          submitted_at: '2026-11-13T01:05:00Z',
        },
      ],
    });
    assert.equal(gateBotPreForcePushCannotClearHoldRes.status.state, 'failure');

    // (e) Bot PR + native APPROVED followed by CHANGES_REQUESTED on headSha (with commitMs skew) -> failure + disables active auto-merge
    const gateBotChangesReqRes = await runReviewGateCase({
      prAuthor: 'github-actions[bot]',
      headSha: gateHeadSha,
      commitDate: '2026-11-13T02:00:00Z',
      autoMerge: { merge_method: 'MERGE' },
      reviews: [
        {
          id: 105,
          user: { login: 'shthed' },
          state: 'APPROVED',
          commit_id: gateHeadSha,
          body: '',
          submitted_at: '2026-11-13T01:10:00Z',
        },
        {
          id: 106,
          user: { login: 'shthed' },
          state: 'CHANGES_REQUESTED',
          commit_id: gateHeadSha,
          body: 'Fix edge case first',
          submitted_at: '2026-11-13T01:12:00Z',
        },
      ],
    });
    assert.equal(gateBotChangesReqRes.status.state, 'failure');
    assert.equal(
      gateBotChangesReqRes.status.description.startsWith(
        'Main (no Owner approval needed): Blocked by Changes requested / hold'
      ),
      true
    );
    assert.equal(gateBotChangesReqRes.calls.createReview.length, 0);
    assert.equal(gateBotChangesReqRes.calls.graphql.length, 1);
    assert.equal(
      gateBotChangesReqRes.calls.graphql[0].query.includes('disablePullRequestAutoMerge'),
      true
    );

    // (f) Manual shthed-authored PR without AI approval stays pending; with strict 100% AI review succeeds & dismisses stale bot approval
    const gateManualLabelRes = await runReviewGateCase({
      prAuthor: 'shthed',
      baseRef: 'main',
      headSha: gateHeadSha,
      commitDate: '2026-11-13T01:00:00Z',
      labels: ['review:owner-approved'],
      aiCommentScore: null,
      events: [
        {
          event: 'labeled',
          label: { name: 'review:owner-approved' },
          actor: { login: 'shthed' },
          created_at: '2026-11-13T01:05:00Z',
        },
      ],
    });
    assert.equal(gateManualLabelRes.status.state, 'pending');
    assert.equal(gateManualLabelRes.status.description, gateMainAwaitingAiAndOwnerDesc);
    assert.equal(gateManualLabelRes.calls.createReview.length, 0);

    const gateManualCommentRes = await runReviewGateCase({
      prAuthor: 'shthed',
      baseRef: 'main',
      headSha: gateHeadSha,
      commitDate: '2026-11-13T01:00:00Z',
      labels: [],
      aiCommentScore: null,
      comments: [
        {
          user: { login: 'shthed' },
          body: 'APPROVED',
          created_at: '2026-11-13T01:05:00Z',
          updated_at: '2026-11-13T01:05:00Z',
        },
      ],
    });
    assert.equal(gateManualCommentRes.status.state, 'pending');
    assert.equal(gateManualCommentRes.status.description, gateMainAwaitingAiAndOwnerDesc);
    assert.equal(gateManualCommentRes.calls.createReview.length, 0);

    const gateManualLgtmCommentRes = await runReviewGateCase({
      prAuthor: 'shthed',
      baseRef: 'main',
      headSha: gateHeadSha,
      commitDate: '2026-11-13T01:00:00Z',
      labels: [],
      aiCommentScore: null,
      comments: [
        {
          user: { login: 'shthed' },
          body: 'LGTM',
          created_at: '2026-11-13T01:05:00Z',
          updated_at: '2026-11-13T01:05:00Z',
        },
      ],
    });
    assert.equal(gateManualLgtmCommentRes.status.state, 'pending');
    assert.equal(gateManualLgtmCommentRes.status.description, gateMainAwaitingAiAndOwnerDesc);
    assert.equal(gateManualLgtmCommentRes.calls.createReview.length, 0);

    const gateManualMainNativeNoBotReviewRes = await runReviewGateCase({
      prAuthor: 'shthed',
      baseRef: 'main',
      headSha: gateHeadSha,
      commitDate: '2026-11-13T01:00:00Z',
      reviews: [
        {
          id: 111,
          user: { login: 'shthed' },
          state: 'APPROVED',
          commit_id: gateHeadSha,
          body: '',
          submitted_at: '2026-11-13T01:05:00Z',
        },
        {
          id: 112,
          user: { login: 'github-actions[bot]' },
          state: 'APPROVED',
          commit_id: gateHeadSha,
          body: 'legacy bot approval',
          submitted_at: '2026-11-13T01:04:00Z',
        },
      ],
    });
    assert.equal(gateManualMainNativeNoBotReviewRes.status.state, 'success');
    assert.equal(gateManualMainNativeNoBotReviewRes.status.description, gateDualPassDesc);
    assert.equal(gateManualMainNativeNoBotReviewRes.calls.createReview.length, 0);
    assert.equal(gateManualMainNativeNoBotReviewRes.calls.dismissReview.length, 1);

    // (g) Draft bot PR -> pending even with AI + native APPROVED (and never enables auto-merge)
    const gateBotDraftRes = await runReviewGateCase({
      prAuthor: 'github-actions[bot]',
      isDraft: true,
      headSha: gateHeadSha,
      body: `${validStrictPrBody}\n\n## Outstanding Work Before Marking Ready\n- [ ] Finalize WIP verification`,
      reviews: [
        {
          id: 107,
          user: { login: 'shthed' },
          state: 'APPROVED',
          commit_id: gateHeadSha,
          body: '',
          submitted_at: '2026-11-13T01:10:00Z',
        },
      ],
    });
    assert.equal(gateBotDraftRes.status.state, 'pending');
    assert.equal(gateBotDraftRes.status.description, gateDraftDesc);
    assert.equal(gateBotDraftRes.calls.createReview.length, 0);
    assert.equal(gateBotDraftRes.calls.graphql.length, 0);

    // (h) Bot PR + CHANGES_REQUESTED whose body starts with "APPROVED..." -> failure (not legacy approval)
    const gateBotChangesReqApprovedPrefixRes = await runReviewGateCase({
      prAuthor: 'github-actions[bot]',
      headSha: gateHeadSha,
      commitDate: '2026-11-13T01:00:00Z',
      reviews: [
        {
          id: 108,
          user: { login: 'shthed' },
          state: 'CHANGES_REQUESTED',
          commit_id: gateHeadSha,
          body: 'APPROVED - needs one fix',
          submitted_at: '2026-11-13T01:12:00Z',
        },
      ],
    });
    assert.equal(gateBotChangesReqApprovedPrefixRes.status.state, 'failure');
    assert.equal(gateBotChangesReqApprovedPrefixRes.status.description.startsWith('Main (no Owner approval needed): Blocked by Changes requested / hold'), true);
    assert.equal(gateBotChangesReqApprovedPrefixRes.calls.createReview.length, 0);

    // (i) Bot PR + CHANGES_REQUESTED recovered by newer native APPROVED on headSha under commitMs skew -> success
    const gateBotRecoverySkewRes = await runReviewGateCase({
      prAuthor: 'github-actions[bot]',
      headSha: gateHeadSha,
      commitDate: '2026-11-13T02:00:00Z',
      reviews: [
        {
          id: 109,
          user: { login: 'shthed' },
          state: 'CHANGES_REQUESTED',
          commit_id: gateHeadSha,
          body: 'Fix edge case first',
          submitted_at: '2026-11-13T01:10:00Z',
        },
        {
          id: 110,
          user: { login: 'shthed' },
          state: 'APPROVED',
          commit_id: gateHeadSha,
          body: '',
          submitted_at: '2026-11-13T01:15:00Z',
        },
      ],
    });
    assert.equal(gateBotRecoverySkewRes.status.state, 'success');
    assert.equal(gateBotRecoverySkewRes.status.description, gateDualPassDesc);
    assert.equal(gateBotRecoverySkewRes.calls.createReview.length, 0);

    // (j) Bot PR + DISMISSED native APPROVED -> ignored (pending without AI, and cannot clear active HOLD)
    const gateBotDismissedRes = await runReviewGateCase({
      prAuthor: 'github-actions[bot]',
      headSha: gateHeadSha,
      commitDate: '2026-11-13T01:00:00Z',
      labels: [],
      aiCommentScore: null,
      reviews: [
        {
          id: 111,
          user: { login: 'shthed' },
          state: 'DISMISSED',
          commit_id: gateHeadSha,
          body: '',
          submitted_at: '2026-11-13T01:15:00Z',
        },
      ],
    });
    assert.equal(gateBotDismissedRes.status.state, 'pending');
    assert.equal(gateBotDismissedRes.status.description, gateMainAwaitingAiAndOwnerDesc);
    assert.equal(gateBotDismissedRes.calls.createReview.length, 0);

    const gateBotDismissedCannotClearHoldRes = await runReviewGateCase({
      prAuthor: 'github-actions[bot]',
      headSha: gateHeadSha,
      commitDate: '2026-11-13T01:00:00Z',
      comments: [
        {
          id: 1111,
          user: { login: 'shthed' },
          body: 'HOLD - wait before merge',
          created_at: '2026-11-13T01:10:00Z',
          updated_at: '2026-11-13T01:10:00Z',
        },
      ],
      reviews: [
        {
          id: 111,
          user: { login: 'shthed' },
          state: 'DISMISSED',
          commit_id: gateHeadSha,
          body: '',
          submitted_at: '2026-11-13T01:15:00Z',
        },
      ],
    });
    assert.equal(gateBotDismissedCannotClearHoldRes.status.state, 'failure');

    // (k) Bug 1 regression: bot PR CHANGES_REQUESTED + legacy APPROVED/LGTM comment + review:owner-approved label (with and without earlier native APPROVED) -> failure
    const gateBotLegacyAfterRejectCommentRes = await runReviewGateCase({
      prAuthor: 'github-actions[bot]',
      headSha: gateHeadSha,
      commitDate: '2026-11-13T01:00:00Z',
      reviews: [
        {
          id: 112,
          user: { login: 'shthed' },
          state: 'CHANGES_REQUESTED',
          commit_id: gateHeadSha,
          body: 'Fix required',
          submitted_at: '2026-11-13T01:05:00Z',
        },
      ],
      comments: [
        {
          id: 201,
          user: { login: 'shthed' },
          body: 'APPROVED',
          created_at: '2026-11-13T01:10:00Z',
          updated_at: '2026-11-13T01:10:00Z',
        },
      ],
    });
    assert.equal(gateBotLegacyAfterRejectCommentRes.status.state, 'failure');
    assert.equal(gateBotLegacyAfterRejectCommentRes.status.description.startsWith('Main (no Owner approval needed): Blocked by Changes requested / hold'), true);
    assert.equal(gateBotLegacyAfterRejectCommentRes.calls.createReview.length, 0);

    const gateBotChangesReqLegacyLgtmAndLabelRes = await runReviewGateCase({
      prAuthor: 'github-actions[bot]',
      headSha: gateHeadSha,
      commitDate: '2026-11-13T01:00:00Z',
      labels: ['review:ai-approved', 'review:owner-approved'],
      events: [
        {
          id: 501,
          event: 'labeled',
          label: { name: 'review:owner-approved' },
          actor: { login: 'shthed' },
          created_at: '2026-11-13T01:10:00Z',
        },
      ],
      reviews: [
        {
          id: 113,
          user: { login: 'shthed' },
          state: 'CHANGES_REQUESTED',
          commit_id: gateHeadSha,
          body: 'Fix Bug 1 first',
          submitted_at: '2026-11-13T01:05:00Z',
        },
      ],
      comments: [
        {
          id: 202,
          user: { login: 'shthed' },
          body: 'LGTM',
          created_at: '2026-11-13T01:11:00Z',
          updated_at: '2026-11-13T01:11:00Z',
        },
      ],
    });
    assert.equal(gateBotChangesReqLegacyLgtmAndLabelRes.status.state, 'failure');
    assert.equal(gateBotChangesReqLegacyLgtmAndLabelRes.status.description.startsWith('Main (no Owner approval needed): Blocked by Changes requested / hold'), true);
    assert.equal(gateBotChangesReqLegacyLgtmAndLabelRes.calls.createReview.length, 0);

    const gateBotLegacyAfterPriorNativeAndRejectRes = await runReviewGateCase({
      prAuthor: 'github-actions[bot]',
      headSha: gateHeadSha,
      commitDate: '2026-11-13T01:00:00Z',
      labels: ['review:ai-approved', 'review:owner-approved'],
      events: [
        {
          id: 502,
          event: 'labeled',
          label: { name: 'review:owner-approved' },
          actor: { login: 'shthed' },
          created_at: '2026-11-13T01:10:00Z',
        },
      ],
      reviews: [
        {
          id: 114,
          user: { login: 'shthed' },
          state: 'APPROVED',
          commit_id: gateHeadSha,
          body: '',
          submitted_at: '2026-11-13T01:02:00Z',
        },
        {
          id: 115,
          user: { login: 'shthed' },
          state: 'CHANGES_REQUESTED',
          commit_id: gateHeadSha,
          body: 'Needs fix',
          submitted_at: '2026-11-13T01:05:00Z',
        },
      ],
      comments: [
        {
          id: 203,
          user: { login: 'shthed' },
          body: 'LGTM on UI',
          created_at: '2026-11-13T01:11:00Z',
          updated_at: '2026-11-13T01:11:00Z',
        },
      ],
    });
    assert.equal(gateBotLegacyAfterPriorNativeAndRejectRes.status.state, 'failure');
    assert.equal(gateBotLegacyAfterPriorNativeAndRejectRes.status.description.startsWith('Main (no Owner approval needed): Blocked by Changes requested / hold'), true);
    assert.equal(gateBotLegacyAfterPriorNativeAndRejectRes.calls.createReview.length, 0);

    // (l) Bug 2 regression: +120s commitMs skew catches post-approval HOLD comment, reverse-ordered COMMENTED DO NOT MERGE review (non-head & head), and DISMISSED+HOLD; stale pre-push HOLD stays ignored
    const gateBotSkewHoldCommentRes = await runReviewGateCase({
      prAuthor: 'github-actions[bot]',
      headSha: gateHeadSha,
      commitDate: '2026-11-13T01:02:00Z',
      reviews: [
        {
          id: 116,
          user: { login: 'shthed' },
          state: 'APPROVED',
          commit_id: gateHeadSha,
          body: '',
          submitted_at: '2026-11-13T01:00:10Z',
        },
      ],
      comments: [
        {
          id: 204,
          user: { login: 'shthed' },
          body: 'HOLD - do not merge yet',
          created_at: '2026-11-13T01:00:40Z',
          updated_at: '2026-11-13T01:00:40Z',
        },
      ],
      eventName: 'issue_comment',
      action: 'created',
    });
    assert.equal(gateBotSkewHoldCommentRes.status.state, 'failure');
    assert.equal(gateBotSkewHoldCommentRes.status.description.startsWith('Main (no Owner approval needed): Blocked by Changes requested / hold'), true);
    assert.equal(gateBotSkewHoldCommentRes.calls.createReview.length, 0);

    const gateBotSkewNonHeadCommentedReviewRes = await runReviewGateCase({
      prAuthor: 'github-actions[bot]',
      headSha: gateHeadSha,
      commitDate: '2026-11-13T01:02:00Z',
      reviews: [
        {
          id: 118,
          user: { login: 'shthed' },
          state: 'COMMENTED',
          commit_id: '0000000000000000000000000000000000000000',
          body: 'DO NOT MERGE - regression',
          submitted_at: '2026-11-13T01:00:40Z',
        },
        {
          id: 117,
          user: { login: 'shthed' },
          state: 'APPROVED',
          commit_id: gateHeadSha,
          body: '',
          submitted_at: '2026-11-13T01:00:10Z',
        },
      ],
    });
    assert.equal(gateBotSkewNonHeadCommentedReviewRes.status.state, 'failure');
    assert.equal(gateBotSkewNonHeadCommentedReviewRes.status.description.startsWith('Main (no Owner approval needed): Blocked by Changes requested / hold'), true);
    assert.equal(gateBotSkewNonHeadCommentedReviewRes.calls.createReview.length, 0);

    const gateBotSkewHeadCommentedReviewRes = await runReviewGateCase({
      prAuthor: 'github-actions[bot]',
      headSha: gateHeadSha,
      commitDate: '2026-11-13T01:02:00Z',
      reviews: [
        {
          id: 120,
          user: { login: 'shthed' },
          state: 'COMMENTED',
          commit_id: gateHeadSha,
          body: 'DO NOT MERGE - head regression',
          submitted_at: '2026-11-13T01:00:40Z',
        },
        {
          id: 119,
          user: { login: 'shthed' },
          state: 'APPROVED',
          commit_id: gateHeadSha,
          body: '',
          submitted_at: '2026-11-13T01:00:10Z',
        },
      ],
    });
    assert.equal(gateBotSkewHeadCommentedReviewRes.status.state, 'failure');
    assert.equal(gateBotSkewHeadCommentedReviewRes.status.description.startsWith('Main (no Owner approval needed): Blocked by Changes requested / hold'), true);
    assert.equal(gateBotSkewHeadCommentedReviewRes.calls.createReview.length, 0);

    const gateBotSkewDismissedHoldRes = await runReviewGateCase({
      prAuthor: 'github-actions[bot]',
      headSha: gateHeadSha,
      commitDate: '2026-11-13T01:02:00Z',
      reviews: [
        {
          id: 121,
          user: { login: 'shthed' },
          state: 'DISMISSED',
          commit_id: gateHeadSha,
          body: '',
          submitted_at: '2026-11-13T01:00:10Z',
        },
      ],
      comments: [
        {
          id: 205,
          user: { login: 'shthed' },
          body: 'HOLD - wait after dismiss',
          created_at: '2026-11-13T01:00:40Z',
          updated_at: '2026-11-13T01:00:40Z',
        },
      ],
    });
    assert.equal(gateBotSkewDismissedHoldRes.status.state, 'failure');
    assert.equal(gateBotSkewDismissedHoldRes.calls.createReview.length, 0);

    const gateBotStalePrePushHoldPendingRes = await runReviewGateCase({
      prAuthor: 'github-actions[bot]',
      headSha: gateHeadSha,
      commitDate: '2026-11-13T01:00:00Z',
      labels: [],
      aiCommentScore: null,
      comments: [
        {
          id: 206,
          user: { login: 'shthed' },
          body: 'HOLD',
          created_at: '2026-11-13T00:55:00Z',
          updated_at: '2026-11-13T00:55:00Z',
        },
      ],
    });
    assert.equal(gateBotStalePrePushHoldPendingRes.status.state, 'pending');
    assert.equal(gateBotStalePrePushHoldPendingRes.calls.createReview.length, 0);

    const gateBotSkewStalePrePushHoldWithApprovalRes = await runReviewGateCase({
      prAuthor: 'github-actions[bot]',
      headSha: gateHeadSha,
      commitDate: '2026-11-13T01:02:00Z',
      reviews: [
        {
          id: 122,
          user: { login: 'shthed' },
          state: 'APPROVED',
          commit_id: gateHeadSha,
          body: '',
          submitted_at: '2026-11-13T01:00:10Z',
        },
      ],
      comments: [
        {
          id: 207,
          user: { login: 'shthed' },
          body: 'HOLD - fix old commit',
          created_at: '2026-11-13T00:55:00Z',
          updated_at: '2026-11-13T00:55:00Z',
        },
      ],
    });
    assert.equal(gateBotSkewStalePrePushHoldWithApprovalRes.status.state, 'success');
    assert.equal(gateBotSkewStalePrePushHoldWithApprovalRes.status.description, gateDualPassDesc);
    assert.equal(gateBotSkewStalePrePushHoldWithApprovalRes.calls.createReview.length, 0);

    // (m) Finding 3 regression: same-second review ties use deterministic [ts, id], while omitted IDs & cross-source review/comment ties fail closed
    const gateSameSecRejectWinsByIdRes = await runReviewGateCase({
      prAuthor: 'github-actions[bot]',
      headSha: gateHeadSha,
      commitDate: '2026-11-13T01:00:00Z',
      reviews: [
        {
          id: 10,
          user: { login: 'shthed' },
          state: 'APPROVED',
          commit_id: gateHeadSha,
          body: '',
          submitted_at: '2026-11-13T01:05:00Z',
        },
        {
          id: 11,
          user: { login: 'shthed' },
          state: 'CHANGES_REQUESTED',
          commit_id: gateHeadSha,
          body: 'Hold on',
          submitted_at: '2026-11-13T01:05:00Z',
        },
      ],
    });
    assert.equal(gateSameSecRejectWinsByIdRes.status.state, 'failure');
    assert.equal(gateSameSecRejectWinsByIdRes.status.description.startsWith('Main (no Owner approval needed): Blocked by Changes requested / hold'), true);
    assert.equal(gateSameSecRejectWinsByIdRes.calls.createReview.length, 0);

    const gateSameSecApproveSupersedesByIdRes = await runReviewGateCase({
      prAuthor: 'github-actions[bot]',
      headSha: gateHeadSha,
      commitDate: '2026-11-13T01:00:00Z',
      reviews: [
        {
          id: 10,
          user: { login: 'shthed' },
          state: 'CHANGES_REQUESTED',
          commit_id: gateHeadSha,
          body: 'Hold on',
          submitted_at: '2026-11-13T01:05:00Z',
        },
        {
          id: 11,
          user: { login: 'shthed' },
          state: 'APPROVED',
          commit_id: gateHeadSha,
          body: '',
          submitted_at: '2026-11-13T01:05:00Z',
        },
      ],
    });
    assert.equal(gateSameSecApproveSupersedesByIdRes.status.state, 'success');
    assert.equal(gateSameSecApproveSupersedesByIdRes.status.description, gateDualPassDesc);
    assert.equal(gateSameSecApproveSupersedesByIdRes.calls.createReview.length, 0);

    const gateSameSecOmittedIdsFailClosedRes = await runReviewGateCase({
      prAuthor: 'github-actions[bot]',
      headSha: gateHeadSha,
      commitDate: '2026-11-13T01:00:00Z',
      reviews: [
        {
          user: { login: 'shthed' },
          state: 'APPROVED',
          commit_id: gateHeadSha,
          body: '',
          submitted_at: '2026-11-13T01:05:00Z',
        },
        {
          id: 12,
          user: { login: 'shthed' },
          state: 'CHANGES_REQUESTED',
          commit_id: gateHeadSha,
          body: 'Hold on',
          submitted_at: '2026-11-13T01:05:00Z',
        },
      ],
    });
    assert.equal(gateSameSecOmittedIdsFailClosedRes.status.state, 'failure');
    assert.equal(gateSameSecOmittedIdsFailClosedRes.calls.createReview.length, 0);

    const gateSameSecOmittedRejectionIdFailClosedRes = await runReviewGateCase({
      prAuthor: 'github-actions[bot]',
      headSha: gateHeadSha,
      commitDate: '2026-11-13T01:00:00Z',
      reviews: [
        {
          id: 12,
          user: { login: 'shthed' },
          state: 'APPROVED',
          commit_id: gateHeadSha,
          body: '',
          submitted_at: '2026-11-13T01:05:00Z',
        },
        {
          user: { login: 'shthed' },
          state: 'CHANGES_REQUESTED',
          commit_id: gateHeadSha,
          body: 'Missing rejection id fails closed',
          submitted_at: '2026-11-13T01:05:00Z',
        },
      ],
    });
    assert.equal(gateSameSecOmittedRejectionIdFailClosedRes.status.state, 'failure');
    assert.equal(gateSameSecOmittedRejectionIdFailClosedRes.calls.createReview.length, 0);

    const gateSameSecCrossSourceFailClosedRes = await runReviewGateCase({
      prAuthor: 'github-actions[bot]',
      headSha: gateHeadSha,
      commitDate: '2026-11-13T01:00:00Z',
      reviews: [
        {
          id: 105,
          user: { login: 'shthed' },
          state: 'APPROVED',
          commit_id: gateHeadSha,
          body: '',
          submitted_at: '2026-11-13T01:05:00Z',
        },
      ],
      comments: [
        {
          id: 50,
          user: { login: 'shthed' },
          body: 'HOLD',
          created_at: '2026-11-13T01:05:00Z',
          updated_at: '2026-11-13T01:05:00Z',
        },
      ],
    });
    assert.equal(gateSameSecCrossSourceFailClosedRes.status.state, 'failure');
    assert.equal(gateSameSecCrossSourceFailClosedRes.calls.createReview.length, 0);

    // (n) --base beta split: AI>=95% passes without Owner sign-off and without creating bot APPROVE review, holds fail closed, spoofing blocked, Dependabot & sync/beta-from-main governed properly
    const gateBetaAiOnlyPassRes = await runReviewGateCase({
      prAuthor: 'shthed',
      baseRef: 'beta',
      headSha: gateHeadSha,
      commitDate: '2026-11-13T01:00:00Z',
      reviews: [
        {
          id: 301,
          user: { login: 'github-actions[bot]' },
          state: 'APPROVED',
          commit_id: '0000000000000000000000000000000000000000',
          body: 'stale',
          submitted_at: '2026-11-13T00:50:00Z',
        },
      ],
    });
    assert.equal(gateBetaAiOnlyPassRes.status.state, 'success');
    assert.equal(gateBetaAiOnlyPassRes.status.description, gateBetaPassDesc);
    assert.equal(gateBetaAiOnlyPassRes.calls.createReview.length, 0);
    assert.equal(gateBetaAiOnlyPassRes.calls.dismissReview.length, 1);
    assert.equal(gateBetaAiOnlyPassRes.calls.graphql.length, 1);
    assert.equal(gateBetaAiOnlyPassRes.calls.graphql[0].variables.mergeMethod, 'SQUASH');

    const gateBetaHoldFailRes = await runReviewGateCase({
      prAuthor: 'github-actions[bot]',
      baseRef: 'beta',
      headSha: gateHeadSha,
      commitDate: '2026-11-13T01:00:00Z',
      comments: [
        {
          id: 302,
          user: { login: 'shthed' },
          body: 'HOLD - wait for fix',
          created_at: '2026-11-13T01:05:00Z',
          updated_at: '2026-11-13T01:05:00Z',
        },
      ],
    });
    assert.equal(gateBetaHoldFailRes.status.state, 'failure');

    const gateBetaHoldWithLgtmCommentStillFailsRes = await runReviewGateCase({
      prAuthor: 'github-actions[bot]',
      baseRef: 'beta',
      headSha: gateHeadSha,
      commitDate: '2026-11-13T01:00:00Z',
      comments: [
        {
          id: 30201,
          user: { login: 'shthed' },
          body: 'HOLD - wait for fix',
          created_at: '2026-11-13T01:05:00Z',
          updated_at: '2026-11-13T01:05:00Z',
        },
        {
          id: 30202,
          user: { login: 'shthed' },
          body: 'LGTM',
          created_at: '2026-11-13T01:06:00Z',
          updated_at: '2026-11-13T01:06:00Z',
        },
      ],
    });
    assert.equal(gateBetaHoldWithLgtmCommentStillFailsRes.status.state, 'failure');
    assert.equal(gateBetaHoldWithLgtmCommentStillFailsRes.calls.createReview.length, 0);

    // ADVERSARIAL-A regression: --base beta with +2m commitDate clock skew still blocks post-AI HOLD / CHANGES REQUESTED / DO NOT MERGE (comments or AI PR review) while ignoring stale pre-push holds
    for (const [tag, holdBody] of [
      ['HOLD', 'HOLD - do not merge!'],
      ['CHANGES REQUESTED', 'CHANGES REQUESTED - needs fixes'],
      ['DO NOT MERGE', 'DO NOT MERGE yet'],
    ]) {
      const gateBetaSkewHoldCommentRes = await runReviewGateCase({
        prAuthor: 'shthed',
        baseRef: 'beta',
        headSha: gateHeadSha,
        commitDate: '2026-11-13T01:02:00Z',
        aiCommentTs: '2026-11-13T01:00:20Z',
        comments: [
          {
            id: 30301,
            user: { login: 'shthed' },
            body: holdBody,
            created_at: '2026-11-13T01:00:40Z',
            updated_at: '2026-11-13T01:00:40Z',
          },
        ],
        eventName: 'issue_comment',
        action: 'created',
      });
      assert.equal(
        gateBetaSkewHoldCommentRes.status.state,
        'failure',
        `Expected --base beta skewed ${tag} hold to fail`
      );
    }

    const gateBetaSkewAiReviewHoldCommentRes = await runReviewGateCase({
      prAuthor: 'shthed',
      baseRef: 'beta',
      headSha: gateHeadSha,
      commitDate: '2026-11-13T01:02:00Z',
      aiCommentScore: null,
      reviews: [
        {
          id: 30302,
          user: { login: 'shthed' },
          author_association: 'OWNER',
          state: 'COMMENTED',
          commit_id: gateHeadSha,
          body: `<!-- capy-review: actor=ai-agent verdict=APPROVED sha=${gateHeadSha} score=100% -->`,
          submitted_at: '2026-11-13T01:00:20Z',
        },
      ],
      comments: [
        {
          id: 30303,
          user: { login: 'shthed' },
          body: 'DO NOT MERGE yet',
          created_at: '2026-11-13T01:00:40Z',
          updated_at: '2026-11-13T01:00:40Z',
        },
      ],
      eventName: 'issue_comment',
      action: 'created',
    });
    assert.equal(gateBetaSkewAiReviewHoldCommentRes.status.state, 'failure');

    const gateBetaSkewStalePrePushHoldIgnoredRes = await runReviewGateCase({
      prAuthor: 'shthed',
      baseRef: 'beta',
      headSha: gateHeadSha,
      commitDate: '2026-11-13T01:02:00Z',
      aiCommentTs: '2026-11-13T01:00:20Z',
      comments: [
        {
          id: 30304,
          user: { login: 'shthed' },
          body: 'HOLD - stale pre-push',
          created_at: '2026-11-13T00:55:00Z',
          updated_at: '2026-11-13T00:55:00Z',
        },
      ],
    });
    assert.equal(gateBetaSkewStalePrePushHoldIgnoredRes.status.state, 'success');

    const gateBetaDraftRes = await runReviewGateCase({
      prAuthor: 'github-actions[bot]',
      baseRef: 'beta',
      isDraft: true,
      headSha: gateHeadSha,
    });
    assert.equal(gateBetaDraftRes.status.state, 'pending');

    const gateBetaMissingAiRes = await runReviewGateCase({
      prAuthor: 'github-actions[bot]',
      baseRef: 'beta',
      labels: [],
      aiCommentScore: null,
      headSha: gateHeadSha,
    });
    assert.equal(gateBetaMissingAiRes.status.state, 'pending');
    assert.equal(gateBetaMissingAiRes.status.description, gateBetaAwaitingAiDesc);

    // Untrusted external user cannot spoof AI CHANGES_REQUESTED DoS or forged APPROVED marker
    const gateUntrustedDosIgnoredRes = await runReviewGateCase({
      baseRef: 'beta',
      headSha: gateHeadSha,
      commitDate: '2026-11-13T01:00:00Z',
      comments: [
        {
          id: 303,
          user: { login: 'stranger' },
          author_association: 'NONE',
          body: `<!-- capy-review: actor=ai-agent verdict=CHANGES_REQUESTED sha=${gateHeadSha} score=10% -->`,
          created_at: '2026-11-13T01:05:00Z',
          updated_at: '2026-11-13T01:05:00Z',
        },
      ],
    });
    assert.equal(gateUntrustedDosIgnoredRes.status.state, 'success');

    const gateUntrustedApproveIgnoredRes = await runReviewGateCase({
      baseRef: 'beta',
      headSha: gateHeadSha,
      aiCommentScore: null,
      comments: [
        {
          id: 304,
          user: { login: 'stranger' },
          author_association: 'NONE',
          body: `<!-- capy-review: actor=ai-agent verdict=APPROVED sha=${gateHeadSha} score=100% -->`,
          created_at: '2026-11-13T01:05:00Z',
          updated_at: '2026-11-13T01:05:00Z',
        },
      ],
    });
    assert.equal(gateUntrustedApproveIgnoredRes.status.state, 'pending');
    assert.deepEqual(gateUntrustedApproveIgnoredRes.calls.removeLabel[0].name, 'review:ai-approved');

    // Dependabot PRs: held pending on beta until AI-reviewed, 403 pull_request warning safety, native Approve required on main
    const gateDependabotBetaPendingRes = await runReviewGateCase({
      prAuthor: 'dependabot[bot]',
      baseRef: 'beta',
      labels: [],
      aiCommentScore: null,
      headSha: gateHeadSha,
    });
    assert.equal(gateDependabotBetaPendingRes.status.state, 'pending');

    const gateDependabotBetaPassRes = await runReviewGateCase({
      prAuthor: 'dependabot[bot]',
      baseRef: 'beta',
      headSha: gateHeadSha,
      eventName: 'issue_comment',
      action: 'created',
    });
    assert.equal(gateDependabotBetaPassRes.status.state, 'success');
    assert.equal(gateDependabotBetaPassRes.calls.createReview.length, 0);

    const gateDependabotReadOnly403Res = await runReviewGateCase({
      prAuthor: 'dependabot[bot]',
      baseRef: 'beta',
      headSha: gateHeadSha,
      eventName: 'pull_request',
      action: 'opened',
      expectCommitStatus: false,
      createCommitStatusImpl: async () => {
        const err = new Error('Resource not accessible by integration');
        err.status = 403;
        throw err;
      },
    });
    assert.equal(
      gateDependabotReadOnly403Res.core.warnings.some((w) => w.includes('Read-only GITHUB_TOKEN')),
      true
    );

    const gateDependabotPr403SkipsFallbackRes = await runReviewGateCase({
      prAuthor: 'dependabot[bot]',
      baseRef: 'beta',
      headSha: gateHeadSha,
      eventName: 'pull_request',
      action: 'synchronize',
      actionsGithubToken: 'ghs_ro_dependabot',
      fetchImpl: async () => ({ ok: true, status: 201 }),
      createCommitStatusImpl: async () => {
        const err = new Error('Resource not accessible by integration');
        err.status = 403;
        throw err;
      },
    });
    assert.equal(gateDependabotPr403SkipsFallbackRes.calls.fetch.length, 0);
    assert.equal(
      gateDependabotPr403SkipsFallbackRes.core.warnings.some((w) => w.includes('Read-only GITHUB_TOKEN')),
      true
    );
    assert.equal(gateDependabotPr403SkipsFallbackRes.calls.graphql.length, 0);

    const gateDependabotIssueComment403UsesFallbackRes = await runReviewGateCase({
      prAuthor: 'dependabot[bot]',
      baseRef: 'beta',
      headSha: gateHeadSha,
      eventName: 'issue_comment',
      action: 'created',
      actionsGithubToken: 'ghs_test_tok',
      fetchImpl: async () => ({ ok: true, status: 201 }),
      createCommitStatusImpl: async () => {
        const err = new Error('Resource not accessible by personal access token');
        err.status = 403;
        throw err;
      },
    });
    assert.equal(gateDependabotIssueComment403UsesFallbackRes.calls.fetch.length, 1);
    assert.equal(
      gateDependabotIssueComment403UsesFallbackRes.calls.fetch[0].url,
      `https://api.github.com/repos/shthed/capy/statuses/${gateHeadSha}`
    );
    assert.equal(
      JSON.parse(gateDependabotIssueComment403UsesFallbackRes.calls.fetch[0].init.body).state,
      'success'
    );
    assert.equal(gateDependabotIssueComment403UsesFallbackRes.calls.graphql[0].variables.mergeMethod, 'SQUASH');

    const gateDependabotMainPendingRes = await runReviewGateCase({
      prAuthor: 'dependabot[bot]',
      baseRef: 'main',
      headSha: gateHeadSha,
      commitDate: '2026-11-13T01:00:00Z',
      labels: [],
      aiCommentScore: null,
      comments: [
        {
          id: 305,
          user: { login: 'shthed' },
          body: 'APPROVED',
          created_at: '2026-11-13T01:05:00Z',
          updated_at: '2026-11-13T01:05:00Z',
        },
      ],
    });
    assert.equal(gateDependabotMainPendingRes.status.state, 'pending');
    assert.equal(gateDependabotMainPendingRes.status.description, gateMainAwaitingAiAndOwnerDesc);

    const gateDependabotMainStrictPassRes = await runReviewGateCase({
      prAuthor: 'dependabot[bot]',
      baseRef: 'main',
      headSha: gateHeadSha,
      commitDate: '2026-11-13T01:00:00Z',
      body: 'Dependabot bump details without unchecked checkboxes.',
      eventName: 'issue_comment',
      action: 'created',
      reviews: [
        {
          id: 306,
          user: { login: 'shthed' },
          state: 'APPROVED',
          commit_id: gateHeadSha,
          body: '',
          submitted_at: '2026-11-13T01:06:00Z',
        },
      ],
    });
    assert.equal(gateDependabotMainStrictPassRes.status.state, 'success');
    assert.equal(gateDependabotMainStrictPassRes.status.description, gateDualPassDesc);
    assert.equal(gateDependabotMainStrictPassRes.calls.createReview.length, 0);
    assert.equal(gateDependabotMainStrictPassRes.calls.graphql[0].variables.mergeMethod, 'MERGE');

    const gateDependabotMainUncheckedTaskFailRes = await runReviewGateCase({
      prAuthor: 'dependabot[bot]',
      baseRef: 'main',
      headSha: gateHeadSha,
      commitDate: '2026-11-13T01:00:00Z',
      body: '- [ ] Confirm major dependency bump changelog',
      eventName: 'issue_comment',
      action: 'created',
    });
    assert.equal(gateDependabotMainUncheckedTaskFailRes.status.state, 'pending');
    assert.equal(gateDependabotMainUncheckedTaskFailRes.status.description, gateMainStrictNotMetNoOwnerDesc);
    assert.deepEqual(
      gateDependabotMainUncheckedTaskFailRes.calls.removeLabel.map((r) => r.name),
      ['review:ai-approved']
    );

    // sync/beta-from-main PRs pass verified ancestry syncs on beta and enable MERGE auto-merge (never SQUASH)
    const gateSyncBetaPassRes = await runReviewGateCase({
      prAuthor: 'github-actions[bot]',
      baseRef: 'beta',
      headRef: 'sync/beta-from-main',
      isDraft: false,
      headSha: gateHeadSha,
    });
    assert.equal(gateSyncBetaPassRes.status.state, 'success');
    assert.equal(gateSyncBetaPassRes.calls.createReview.length, 0);
    assert.equal(gateSyncBetaPassRes.calls.graphql[0].variables.mergeMethod, 'MERGE');

    // Retargeting an AI-approved PR from beta to main via pull_request edited passes immediately without Owner Approve and upgrades SQUASH -> MERGE
    const gateRetargetBetaToMainAwaitingOwnerRes = await runReviewGateCase({
      prAuthor: 'shthed',
      baseRef: 'main',
      isDraft: false,
      headSha: gateHeadSha,
      autoMerge: { merge_method: 'SQUASH' },
      eventName: 'pull_request',
      action: 'edited',
    });
    assert.equal(gateRetargetBetaToMainAwaitingOwnerRes.status.state, 'success');
    assert.equal(gateRetargetBetaToMainAwaitingOwnerRes.status.description, gateMainAwaitingOwnerDesc);
    assert.equal(gateRetargetBetaToMainAwaitingOwnerRes.calls.graphql[0].variables.mergeMethod, 'MERGE');

    const gateRetargetBetaToMainRes = await runReviewGateCase({
      prAuthor: 'shthed',
      baseRef: 'main',
      isDraft: false,
      headSha: gateHeadSha,
      autoMerge: { merge_method: 'SQUASH' },
      eventName: 'pull_request',
      action: 'edited',
      reviews: [
        {
          id: 307,
          user: { login: 'shthed' },
          state: 'APPROVED',
          commit_id: gateHeadSha,
          body: '',
          submitted_at: '2026-11-13T01:06:00Z',
        },
      ],
    });
    assert.equal(gateRetargetBetaToMainRes.status.state, 'success');
    assert.equal(gateRetargetBetaToMainRes.status.description, gateDualPassDesc);
    assert.equal(gateRetargetBetaToMainRes.calls.graphql[0].variables.mergeMethod, 'MERGE');

    // ADVERSARIAL-C regression: DISMISSED and PENDING reviews carrying <!-- capy-review: ... --> markers are ignored for both APPROVED and CHANGES_REQUESTED
    const gateDismissedAiReviewIgnoredRes = await runReviewGateCase({
      prAuthor: 'shthed',
      baseRef: 'beta',
      headSha: gateHeadSha,
      labels: ['review:ai-approved'],
      aiCommentScore: null,
      eventName: 'pull_request_review',
      action: 'dismissed',
      reviews: [
        {
          id: 401,
          user: { login: 'shthed' },
          author_association: 'OWNER',
          state: 'DISMISSED',
          commit_id: gateHeadSha,
          body: `<!-- capy-review: actor=ai-agent verdict=APPROVED sha=${gateHeadSha} score=100% -->`,
          submitted_at: '2026-11-13T01:05:00Z',
        },
      ],
    });
    assert.equal(gateDismissedAiReviewIgnoredRes.status.state, 'pending');
    assert.equal(gateDismissedAiReviewIgnoredRes.status.description, gateBetaAwaitingAiDesc);
    assert.deepEqual(
      gateDismissedAiReviewIgnoredRes.calls.removeLabel.map((r) => r.name),
      ['review:ai-approved']
    );

    const gatePendingAiReviewIgnoredRes = await runReviewGateCase({
      prAuthor: 'shthed',
      baseRef: 'beta',
      headSha: gateHeadSha,
      labels: ['review:ai-approved'],
      aiCommentScore: null,
      eventName: 'pull_request',
      action: 'labeled',
      reviews: [
        {
          id: 402,
          user: { login: 'shthed' },
          author_association: 'OWNER',
          state: 'PENDING',
          commit_id: gateHeadSha,
          body: `<!-- capy-review: actor=ai-agent verdict=APPROVED sha=${gateHeadSha} score=100% -->`,
          submitted_at: null,
        },
      ],
    });
    assert.equal(gatePendingAiReviewIgnoredRes.status.state, 'pending');
    assert.deepEqual(
      gatePendingAiReviewIgnoredRes.calls.removeLabel.map((r) => r.name),
      ['review:ai-approved']
    );

    const gateDismissedAndPendingAiRejectIgnoredRes = await runReviewGateCase({
      prAuthor: 'shthed',
      baseRef: 'beta',
      headSha: gateHeadSha,
      labels: ['review:ai-approved'],
      aiCommentScore: 100,
      reviews: [
        {
          id: 403,
          user: { login: 'shthed' },
          author_association: 'OWNER',
          state: 'DISMISSED',
          commit_id: gateHeadSha,
          body: `<!-- capy-review: actor=ai-agent verdict=CHANGES_REQUESTED sha=${gateHeadSha} score=40% -->`,
          submitted_at: '2026-11-13T01:06:00Z',
        },
        {
          id: 404,
          user: { login: 'shthed' },
          author_association: 'OWNER',
          state: 'PENDING',
          commit_id: gateHeadSha,
          body: `<!-- capy-review: actor=ai-agent verdict=CHANGES_REQUESTED sha=${gateHeadSha} score=40% -->`,
          submitted_at: null,
        },
      ],
    });
    assert.equal(gateDismissedAndPendingAiRejectIgnoredRes.status.state, 'success');

    // ADVERSARIAL-B regression: draft and converted_to_draft preserve review:changes-requested (failure), while synchronize strips all review labels
    const gateDraftPreservesChangesRequestedRes = await runReviewGateCase({
      prAuthor: 'shthed',
      baseRef: 'beta',
      isDraft: true,
      headSha: gateHeadSha,
      labels: ['review:ai-approved', 'review:owner-approved', 'review:changes-requested'],
      aiCommentScore: null,
      eventName: 'pull_request',
      action: 'labeled',
    });
    assert.equal(gateDraftPreservesChangesRequestedRes.status.state, 'failure');
    assert.equal(gateDraftPreservesChangesRequestedRes.status.description.startsWith('Beta (no Owner approval needed): Blocked by Changes requested / hold'), true);
    assert.deepEqual(
      gateDraftPreservesChangesRequestedRes.calls.removeLabel.map((r) => r.name),
      ['review:ai-approved', 'review:owner-approved']
    );

    const gateConvertedToDraftPreservesChangesRequestedRes = await runReviewGateCase({
      prAuthor: 'shthed',
      baseRef: 'beta',
      isDraft: true,
      headSha: gateHeadSha,
      labels: ['review:ai-approved', 'review:changes-requested'],
      aiCommentScore: null,
      eventName: 'pull_request',
      action: 'converted_to_draft',
    });
    assert.equal(gateConvertedToDraftPreservesChangesRequestedRes.status.state, 'failure');
    assert.deepEqual(
      gateConvertedToDraftPreservesChangesRequestedRes.calls.removeLabel.map((r) => r.name),
      ['review:ai-approved']
    );

    const gateSynchronizeClearsAllReviewLabelsRes = await runReviewGateCase({
      prAuthor: 'shthed',
      baseRef: 'beta',
      isDraft: false,
      headSha: gateHeadSha,
      labels: ['review:ai-approved', 'review:owner-approved', 'review:changes-requested'],
      aiCommentScore: null,
      eventName: 'pull_request',
      action: 'synchronize',
    });
    assert.equal(gateSynchronizeClearsAllReviewLabelsRes.status.state, 'pending');
    assert.equal(gateSynchronizeClearsAllReviewLabelsRes.status.description, gateBetaAwaitingAiDesc);
    assert.deepEqual(
      gateSynchronizeClearsAllReviewLabelsRes.calls.removeLabel.map((r) => r.name),
      ['review:ai-approved', 'review:owner-approved', 'review:changes-requested']
    );

    const gateDraftSynchronizeClearsAllReviewLabelsRes = await runReviewGateCase({
      prAuthor: 'shthed',
      baseRef: 'beta',
      isDraft: true,
      headSha: gateHeadSha,
      labels: ['review:ai-approved', 'review:owner-approved', 'review:changes-requested'],
      aiCommentScore: null,
      eventName: 'pull_request',
      action: 'synchronize',
    });
    assert.equal(gateDraftSynchronizeClearsAllReviewLabelsRes.status.state, 'pending');
    assert.equal(
      gateDraftSynchronizeClearsAllReviewLabelsRes.status.description.startsWith(
        'Beta (no Owner approval needed): Blocked by Draft PR'
      ),
      true
    );
    assert.deepEqual(
      gateDraftSynchronizeClearsAllReviewLabelsRes.calls.removeLabel.map((r) => r.name),
      ['review:ai-approved', 'review:owner-approved', 'review:changes-requested']
    );

    // edc70ed regression: synchronize preserves review:ai-approved when hasValidAiMarker holds while stripping owner/changes-requested labels
    const gateSynchronizePreservesAiApprovedRes = await runReviewGateCase({
      prAuthor: 'shthed',
      baseRef: 'beta',
      isDraft: false,
      headSha: gateHeadSha,
      labels: ['review:ai-approved', 'review:owner-approved', 'review:changes-requested'],
      aiCommentScore: 100,
      eventName: 'pull_request',
      action: 'synchronize',
    });
    assert.equal(gateSynchronizePreservesAiApprovedRes.status.state, 'success');
    assert.deepEqual(
      gateSynchronizePreservesAiApprovedRes.calls.removeLabel.map((r) => r.name),
      ['review:owner-approved', 'review:changes-requested']
    );
    assert.equal(gateSynchronizePreservesAiApprovedRes.calls.addLabels.length, 0);

    const gateSynchronizeReaddsAiApprovedRes = await runReviewGateCase({
      prAuthor: 'shthed',
      baseRef: 'beta',
      isDraft: false,
      headSha: gateHeadSha,
      labels: ['review:owner-approved', 'review:changes-requested'],
      aiCommentScore: 100,
      eventName: 'pull_request',
      action: 'synchronize',
    });
    assert.equal(gateSynchronizeReaddsAiApprovedRes.status.state, 'success');
    assert.deepEqual(
      gateSynchronizeReaddsAiApprovedRes.calls.addLabels.flatMap((a) => a.labels),
      ['review:ai-approved']
    );
    assert.deepEqual(
      gateSynchronizeReaddsAiApprovedRes.calls.removeLabel.map((r) => r.name),
      ['review:owner-approved', 'review:changes-requested']
    );

    // ACTIONS_GITHUB_TOKEN 403 commit status REST fallback across success, pending, and failure states
    const gatePrimaryStatusNoFallbackRes = await runReviewGateCase({
      prAuthor: 'shthed',
      baseRef: 'beta',
      headSha: gateHeadSha,
      actionsGithubToken: 'ghs_actions_token',
    });
    assert.equal(gatePrimaryStatusNoFallbackRes.status.state, 'success');
    assert.equal(gatePrimaryStatusNoFallbackRes.calls.fetch.length, 0);

    for (const fallbackCase of [
      {
        expectedState: 'success',
        aiCommentScore: 100,
        labels: ['review:ai-approved'],
        comments: [],
      },
      {
        expectedState: 'pending',
        aiCommentScore: null,
        labels: [],
        comments: [],
      },
      {
        expectedState: 'failure',
        aiCommentScore: 100,
        labels: ['review:ai-approved'],
        comments: [
          {
            user: { login: 'shthed' },
            body: 'HOLD pending fix',
            created_at: '2026-11-13T01:02:00Z',
            updated_at: '2026-11-13T01:02:00Z',
          },
        ],
      },
    ]) {
      const fallbackRes = await runReviewGateCase({
        prAuthor: 'shthed',
        baseRef: 'beta',
        headSha: gateHeadSha,
        aiCommentScore: fallbackCase.aiCommentScore,
        labels: fallbackCase.labels,
        comments: fallbackCase.comments,
        actionsGithubToken: 'ghs_test_tok',
        fetchImpl: async () => ({ ok: true, status: 201 }),
        createCommitStatusImpl: async () => {
          const err = new Error('Resource not accessible by personal access token');
          err.status = 403;
          throw err;
        },
      });
      assert.equal(fallbackRes.calls.fetch.length, 1);
      const { url: fetchUrl, init: fetchInit } = fallbackRes.calls.fetch[0];
      assert.equal(fetchUrl, `https://api.github.com/repos/shthed/capy/statuses/${gateHeadSha}`);
      assert.equal(fetchInit.method, 'POST');
      assert.equal(fetchInit.headers.Authorization, 'Bearer ghs_test_tok');
      assert.equal(fetchInit.headers.Accept, 'application/vnd.github+json');
      const fallbackBody = JSON.parse(fetchInit.body);
      assert.equal(fallbackBody.state, fallbackCase.expectedState);
      assert.equal(fallbackBody.context, 'capy/review-gate');
      assert.equal(fallbackBody.description.length <= 140, true);
      assert.equal(fallbackBody.target_url, 'https://github.com/shthed/capy/pull/490');
      if (fallbackCase.expectedState === 'success') {
        assert.equal(fallbackRes.calls.graphql[0].variables.mergeMethod, 'SQUASH');
      }
    }

    // capyboop co-owner approval, AI review marker, HOLD, cross-owner supersession & untrusted rejection
    const gateCapyboopMainApprovedRes = await runReviewGateCase({
      prAuthor: 'github-actions[bot]',
      baseRef: 'main',
      headSha: gateHeadSha,
      labels: ['review:ai-approved'],
      reviews: [
        {
          id: 701,
          state: 'APPROVED',
          body: '',
          commit_id: gateHeadSha,
          submitted_at: '2026-11-13T01:02:00Z',
          user: { login: 'capyboop' },
        },
      ],
    });
    assert.equal(gateCapyboopMainApprovedRes.status.state, 'success');
    assert.equal(gateCapyboopMainApprovedRes.status.description, gateDualPassDesc);

    const gateCapyboopBetaAiMarkerRes = await runReviewGateCase({
      prAuthor: 'github-actions[bot]',
      baseRef: 'beta',
      headSha: gateHeadSha,
      labels: ['review:ai-approved'],
      aiCommentScore: null,
      comments: [
        {
          user: { login: 'CapyBoop' },
          body: `<!-- capy-review: actor=ai-agent verdict=APPROVED sha=${gateHeadSha} score=100% -->`,
          created_at: '2026-11-13T01:01:00Z',
          updated_at: '2026-11-13T01:01:00Z',
        },
      ],
    });
    assert.equal(gateCapyboopBetaAiMarkerRes.status.state, 'success');
    assert.ok(gateCapyboopBetaAiMarkerRes.status.description.includes('Beta gate passed'));

    for (const targetBase of ['beta', 'main']) {
      const gateCapyboopHoldRes = await runReviewGateCase({
        prAuthor: 'github-actions[bot]',
        baseRef: targetBase,
        headSha: gateHeadSha,
        labels: ['review:ai-approved'],
        reviews: [
          {
            id: 702,
            state: 'APPROVED',
            body: '',
            commit_id: gateHeadSha,
            submitted_at: '2026-11-13T01:02:00Z',
            user: { login: 'shthed' },
          },
        ],
        comments: [
          {
            user: { login: 'capyboop' },
            body: 'HOLD pending final check',
            created_at: '2026-11-13T01:03:00Z',
            updated_at: '2026-11-13T01:03:00Z',
          },
        ],
      });
      assert.equal(gateCapyboopHoldRes.status.state, 'failure');
      assert.equal(gateCapyboopHoldRes.status.description.includes('Blocked by Changes requested / hold'), true);
    }

    const gateShthedSupersedesCapyboopHoldRes = await runReviewGateCase({
      prAuthor: 'github-actions[bot]',
      baseRef: 'main',
      headSha: gateHeadSha,
      labels: ['review:ai-approved'],
      reviews: [
        {
          id: 703,
          state: 'APPROVED',
          body: '',
          commit_id: gateHeadSha,
          submitted_at: '2026-11-13T01:04:00Z',
          user: { login: 'shthed' },
        },
      ],
      comments: [
        {
          user: { login: 'capyboop' },
          body: 'HOLD earlier issue',
          created_at: '2026-11-13T01:02:00Z',
          updated_at: '2026-11-13T01:02:00Z',
        },
      ],
    });
    assert.equal(gateShthedSupersedesCapyboopHoldRes.status.state, 'success');
    assert.equal(gateShthedSupersedesCapyboopHoldRes.status.description, gateDualPassDesc);

    const gateBeta99PendingRes = await runReviewGateCase({
      prAuthor: 'github-actions[bot]',
      baseRef: 'beta',
      headSha: gateHeadSha,
      labels: ['review:ai-approved'],
      aiCommentScore: 99,
    });
    assert.equal(gateBeta99PendingRes.status.state, 'pending');
    assert.equal(gateBeta99PendingRes.status.description, gateStrictNotMetDesc);
    assert.deepEqual(
      gateBeta99PendingRes.calls.removeLabel.map((r) => r.name),
      ['review:ai-approved']
    );

    const gateUntrustedMainApprovedRes = await runReviewGateCase({
      prAuthor: 'github-actions[bot]',
      baseRef: 'main',
      headSha: gateHeadSha,
      labels: [],
      aiCommentScore: null,
      reviews: [
        {
          id: 704,
          state: 'APPROVED',
          body: '',
          commit_id: gateHeadSha,
          submitted_at: '2026-11-13T01:02:00Z',
          user: { login: 'stranger' },
        },
      ],
    });
    assert.equal(gateUntrustedMainApprovedRes.status.state, 'pending');
    assert.equal(gateUntrustedMainApprovedRes.status.description, gateMainAwaitingAiAndOwnerDesc);

    const gateUntrustedMainCannotClearHoldRes = await runReviewGateCase({
      prAuthor: 'github-actions[bot]',
      baseRef: 'main',
      headSha: gateHeadSha,
      comments: [
        {
          id: 7041,
          user: { login: 'shthed' },
          body: 'HOLD - untrusted reviewer cannot override',
          created_at: '2026-11-13T01:01:00Z',
          updated_at: '2026-11-13T01:01:00Z',
        },
      ],
      reviews: [
        {
          id: 7042,
          state: 'APPROVED',
          body: '',
          commit_id: gateHeadSha,
          submitted_at: '2026-11-13T01:03:00Z',
          user: { login: 'stranger' },
        },
      ],
    });
    assert.equal(gateUntrustedMainCannotClearHoldRes.status.state, 'failure');

    // Strict 100% PR body / AI review body enforcement & auto-merge GraphQL + clean-status merge fallback (2ae9e78)
    for (const [targetBase, expectedMethod, expectedDesc] of [
      ['beta', 'SQUASH', gateBetaPassDesc],
      ['main', 'MERGE', gateDualPassDesc],
    ]) {
      const gateStrictBodyValidPassRes = await runReviewGateCase({
        prAuthor: 'github-actions[bot]',
        baseRef: targetBase,
        headSha: gateHeadSha,
        body: validStrictPrBody,
        reviews:
          targetBase === 'main'
            ? [
                {
                  id: 8101,
                  user: { login: 'shthed' },
                  state: 'APPROVED',
                  commit_id: gateHeadSha,
                  body: '',
                  submitted_at: '2026-11-13T01:06:00Z',
                },
              ]
            : [],
        aiCommentBody: [
          'Independent review passed.',
          '- **100%** — **All Checks**: Verified.',
          `<!-- capy-review: actor=ai-agent verdict=APPROVED sha=${gateHeadSha} score=100% -->`,
        ].join('\n'),
      });
      assert.equal(gateStrictBodyValidPassRes.status.state, 'success');
      assert.equal(gateStrictBodyValidPassRes.status.description, expectedDesc);
      assert.equal(gateStrictBodyValidPassRes.calls.graphql.length, 1);
      assert.equal(gateStrictBodyValidPassRes.calls.graphql[0].variables.mergeMethod, expectedMethod);
    }

    for (const [labelCase, overrides] of [
      [
        'null body',
        {
          body: null,
        },
      ],
      [
        'undefined/missing body',
        {
          body: undefined,
        },
      ],
      [
        'empty body',
        {
          body: '   ',
        },
      ],
      [
        'missing ## Summary',
        {
          body: '### PR Readiness Score: 100%\n\n- **100%** — **Checks**: Passed.',
        },
      ],
      [
        'missing PR Readiness Score: 100%',
        {
          body: '## Summary\n\nPlain summary.\n\n### PR Readiness Score: 99%\n\n- **100%** — **Checks**: Passed.',
        },
      ],
      [
        'sub-100% PR checklist item',
        {
          body: `${validStrictPrBody}\n- **95%** — **Followup**: Incomplete.`,
        },
      ],
      [
        'unchecked PR task checkbox',
        {
          body: `${validStrictPrBody}\n- [ ] Remaining subtask`,
        },
      ],
      [
        'unchecked star checkbox',
        {
          body: `${validStrictPrBody}\n* [ ] Follow up`,
        },
      ],
      [
        'sub-100% heading in AI body',
        {
          body: validStrictPrBody,
          aiCommentBody: `### PR Readiness Score: 98%\n<!-- capy-review: actor=ai-agent verdict=APPROVED sha=${gateHeadSha} score=100% -->`,
        },
      ],
      [
        'sub-100% AI review checklist item',
        {
          body: validStrictPrBody,
          aiCommentBody: `- **98%** — **Minor gap**\n<!-- capy-review: actor=ai-agent verdict=APPROVED sha=${gateHeadSha} score=100% -->`,
        },
      ],
      [
        'unchecked AI review task checkbox',
        {
          body: validStrictPrBody,
          aiCommentBody: `- [ ] Pending follow-up\n<!-- capy-review: actor=ai-agent verdict=APPROVED sha=${gateHeadSha} score=100% -->`,
        },
      ],
    ]) {
      const strictRejectRes = await runReviewGateCase({
        prAuthor: 'github-actions[bot]',
        baseRef: 'beta',
        headSha: gateHeadSha,
        labels: ['review:ai-approved'],
        ...overrides,
      });
      assert.equal(
        strictRejectRes.status.state,
        'pending',
        `Expected strict 100% gate to reject ${labelCase}`
      );
      assert.equal(strictRejectRes.status.description, gateStrictNotMetDesc);
      assert.deepEqual(
        strictRejectRes.calls.removeLabel.map((r) => r.name),
        ['review:ai-approved']
      );
      assert.equal(strictRejectRes.calls.graphql.length, 0);
    }

    // Tampering with PR body via pull_request edited strips review:ai-approved, holds pending, and disarms prior auto-merge
    for (const [tamperCase, tamperedBody] of [
      ['## Summary removed', '### PR Readiness Score: 100%\n\n- **100%** — **Checks**: Passed.'],
      ['unchecked task added', `${validStrictPrBody}\n- [ ] Incomplete follow-up`],
      ['null body', null],
    ]) {
      const tamperedNoAutoMergeRes = await runReviewGateCase({
        prAuthor: 'github-actions[bot]',
        baseRef: 'beta',
        headSha: gateHeadSha,
        body: tamperedBody,
        labels: ['review:ai-approved'],
        eventName: 'pull_request',
        action: 'edited',
      });
      assert.equal(
        tamperedNoAutoMergeRes.status.state,
        'pending',
        `Expected edited ${tamperCase} to return pending`
      );
      assert.equal(tamperedNoAutoMergeRes.status.description, gateStrictNotMetDesc);
      assert.deepEqual(
        tamperedNoAutoMergeRes.calls.removeLabel.map((r) => r.name),
        ['review:ai-approved']
      );
      assert.equal(tamperedNoAutoMergeRes.calls.graphql.length, 0);

      const tamperedWithAutoMergeRes = await runReviewGateCase({
        prAuthor: 'github-actions[bot]',
        baseRef: 'beta',
        headSha: gateHeadSha,
        nodeId: 'PR_node_tamper',
        body: tamperedBody,
        autoMerge: { merge_method: 'SQUASH' },
        labels: ['review:ai-approved'],
        eventName: 'pull_request',
        action: 'edited',
      });
      assert.equal(tamperedWithAutoMergeRes.status.state, 'pending');
      assert.deepEqual(
        tamperedWithAutoMergeRes.calls.removeLabel.map((r) => r.name),
        ['review:ai-approved']
      );
      assert.equal(tamperedWithAutoMergeRes.calls.graphql.length, 1);
      assert.equal(
        tamperedWithAutoMergeRes.calls.graphql[0].query.includes('disablePullRequestAutoMerge'),
        true
      );
    }

    // Pre-existing Owner-armed auto-merge awaiting initial AI review is preserved while capy/review-gate stays pending
    const preAiAutoMergePreservedRes = await runReviewGateCase({
      prAuthor: 'github-actions[bot]',
      baseRef: 'beta',
      headSha: gateHeadSha,
      autoMerge: { merge_method: 'SQUASH' },
      labels: [],
      aiCommentScore: null,
    });
    assert.equal(preAiAutoMergePreservedRes.status.state, 'pending');
    assert.equal(preAiAutoMergePreservedRes.calls.graphql.length, 0);

    for (const [targetBase, expectedMergeMethod] of [
      ['beta', 'squash'],
      ['main', 'merge'],
    ]) {
      for (const fallbackError of [
        'Pull request is in clean status',
        'Auto-merge is not supported for stacked pull requests.',
      ]) {
        const gateCleanFallbackRes = await runReviewGateCase({
          prAuthor: 'github-actions[bot]',
          baseRef: targetBase,
          headSha: gateHeadSha,
          body: validStrictPrBody,
          reviews: [],
          graphqlImpl: async () => {
            throw new Error(fallbackError);
          },
        });
        assert.equal(gateCleanFallbackRes.status.state, 'success');
        assert.equal(gateCleanFallbackRes.calls.merge.length, 1);
        assert.equal(gateCleanFallbackRes.calls.merge[0].merge_method, expectedMergeMethod);
        assert.equal(gateCleanFallbackRes.calls.merge[0].sha, gateHeadSha);
        assert.equal(gateCleanFallbackRes.calls.request.length, 0);
      }

      // Stacked PRs that reject REST pulls.merge must fall back cleanly to PUT /merge-async
      const gateStackedAsyncFallbackRes = await runReviewGateCase({
        prAuthor: 'github-actions[bot]',
        baseRef: targetBase,
        headSha: gateHeadSha,
        body: validStrictPrBody,
        reviews: [],
        graphqlImpl: async () => {
          throw new Error('Auto-merge is not supported for stacked pull requests.');
        },
        mergeImpl: async () => {
          throw new Error(
            'Merging stacked PRs via this endpoint is not supported. Use the asynchronous merge endpoint instead.'
          );
        },
      });
      assert.equal(gateStackedAsyncFallbackRes.status.state, 'success');
      assert.equal(gateStackedAsyncFallbackRes.calls.merge.length, 1);
      assert.equal(gateStackedAsyncFallbackRes.calls.request.length, 1);
      assert.equal(
        gateStackedAsyncFallbackRes.calls.request[0].route,
        'PUT /repos/{owner}/{repo}/pulls/{pull_number}/merge-async'
      );
      assert.deepEqual(gateStackedAsyncFallbackRes.calls.request[0].payload, {
        owner: 'shthed',
        repo: 'capy',
        pull_number: 490,
        sha: gateHeadSha,
        merge_method: expectedMergeMethod,
        merge_action: 'direct_merge',
      });

      const gateStackedAsync409Res = await runReviewGateCase({
        prAuthor: 'github-actions[bot]',
        baseRef: targetBase,
        headSha: gateHeadSha,
        body: validStrictPrBody,
        reviews: [],
        graphqlImpl: async () => {
          throw new Error('Auto-merge is not supported for stacked pull requests.');
        },
        mergeImpl: async () => {
          throw new Error(
            'Merging stacked PRs via this endpoint is not supported. Use the asynchronous merge endpoint instead.'
          );
        },
        requestImpl: async () => {
          const err = new Error('Merge already queued');
          err.status = 409;
          throw err;
        },
      });
      assert.equal(gateStackedAsync409Res.status.state, 'success');
      assert.equal(gateStackedAsync409Res.calls.request.length, 1);
      assert.equal(
        gateStackedAsync409Res.core.warnings.some((w) => w.includes('Async stacked merge fallback failed')),
        false
      );
    }

    // Auto-merge stuck `blocked` by non-check ruleset requirements must merge directly once
    // required checks are green on the exact head SHA (Build & Test for beta; Build & Test +
    // Android APK + Playwright E2E for main).
    const greenBetaHeadRuns = [
      { name: 'Build & Test', status: 'completed', conclusion: 'cancelled', started_at: '2026-11-13T01:00:00Z' },
      { name: 'Build & Test', status: 'completed', conclusion: 'success', started_at: '2026-11-13T01:01:00Z' },
      { name: 'Playwright E2E', status: 'in_progress', conclusion: null, started_at: '2026-11-13T01:01:00Z' },
    ];
    const greenMainHeadRuns = [
      { name: 'Build & Test', status: 'completed', conclusion: 'success', started_at: '2026-11-13T01:01:00Z' },
      { name: 'Android APK', status: 'completed', conclusion: 'success', started_at: '2026-11-13T01:01:00Z' },
      { name: 'Playwright E2E', status: 'completed', conclusion: 'success', started_at: '2026-11-13T01:01:00Z' },
    ];
    for (const [targetBase, expectedMergeMethod, runsForBase] of [
      ['beta', 'squash', greenBetaHeadRuns],
      ['main', 'merge', greenMainHeadRuns],
    ]) {
      const gateBlockedDirectMergeRes = await runReviewGateCase({
        prAuthor: 'shthed',
        baseRef: targetBase,
        headSha: gateHeadSha,
        body: validStrictPrBody,
        reviews: [],
        mergeableState: 'blocked',
        checkRuns: runsForBase,
      });
      assert.equal(gateBlockedDirectMergeRes.status.state, 'success');
      assert.equal(gateBlockedDirectMergeRes.calls.graphql.length, 1);
      assert.equal(gateBlockedDirectMergeRes.calls.merge.length, 1);
      assert.equal(gateBlockedDirectMergeRes.calls.merge[0].merge_method, expectedMergeMethod);
      assert.equal(gateBlockedDirectMergeRes.calls.merge[0].sha, gateHeadSha);
    }

    // `main` release promotions must stay pending (never auto-merge or direct-merge) until
    // Build & Test, Android APK, and Playwright E2E all succeed on HEAD.
    for (const incompleteMainRuns of [
      greenBetaHeadRuns,
      [
        { name: 'Build & Test', status: 'completed', conclusion: 'success', started_at: '2026-11-13T01:01:00Z' },
        { name: 'Playwright E2E', status: 'completed', conclusion: 'success', started_at: '2026-11-13T01:01:00Z' },
      ],
      [
        { name: 'Build & Test', status: 'completed', conclusion: 'success', started_at: '2026-11-13T01:01:00Z' },
        { name: 'Android APK', status: 'completed', conclusion: 'success', started_at: '2026-11-13T01:01:00Z' },
        { name: 'Playwright E2E', status: 'completed', conclusion: 'failure', started_at: '2026-11-13T01:01:00Z' },
      ],
    ]) {
      const gateMainPendingReleaseChecksRes = await runReviewGateCase({
        prAuthor: 'github-actions[bot]',
        baseRef: 'main',
        headSha: gateHeadSha,
        body: validStrictPrBody,
        reviews: [],
        mergeableState: 'blocked',
        checkRuns: incompleteMainRuns,
      });
      assert.equal(gateMainPendingReleaseChecksRes.status.state, 'pending');
      assert.equal(
        gateMainPendingReleaseChecksRes.status.description.includes('Playwright E2E / Android APK release checks'),
        true
      );
      assert.equal(gateMainPendingReleaseChecksRes.calls.graphql.length, 0);
      assert.equal(gateMainPendingReleaseChecksRes.calls.merge.length, 0);
    }

    // Stacked-PR fallback must NOT direct-merge or call /merge-async when Build & Test is not green
    const gateStackedNotGreenRes = await runReviewGateCase({
      prAuthor: 'github-actions[bot]',
      baseRef: 'beta',
      headSha: gateHeadSha,
      body: validStrictPrBody,
      reviews: [],
      checkRuns: [{ name: 'Build & Test', status: 'in_progress', conclusion: null, started_at: '2026-11-13T01:01:00Z' }],
      graphqlImpl: async () => {
        throw new Error('Auto-merge is not supported for stacked pull requests.');
      },
    });
    assert.equal(gateStackedNotGreenRes.status.state, 'success');
    assert.equal(gateStackedNotGreenRes.calls.merge.length, 0);
    assert.equal(gateStackedNotGreenRes.calls.request.length, 0);

    // Docs-only PRs targeting `main` pass when Build & Test succeeds and E2E/APK are skipped,
    // whereas code PRs targeting `main` must stay pending when E2E/APK are skipped.
    const skippedReleaseRuns = [
      { name: 'Build & Test', status: 'completed', conclusion: 'success', started_at: '2026-11-13T01:01:00Z' },
      { name: 'Android APK', status: 'completed', conclusion: 'skipped', started_at: '2026-11-13T01:01:00Z' },
      { name: 'Playwright E2E', status: 'completed', conclusion: 'skipped', started_at: '2026-11-13T01:01:00Z' },
    ];
    const gateDocsOnlyMainRes = await runReviewGateCase({
      prAuthor: 'github-actions[bot]',
      baseRef: 'main',
      headSha: gateHeadSha,
      body: validStrictPrBody,
      reviews: [],
      changedFiles: [{ filename: 'README.md' }, { filename: 'docs/guide.md' }],
      checkRuns: skippedReleaseRuns,
    });
    assert.equal(gateDocsOnlyMainRes.status.state, 'success');

    const gateCodeMainSkippedRes = await runReviewGateCase({
      prAuthor: 'github-actions[bot]',
      baseRef: 'main',
      headSha: gateHeadSha,
      body: validStrictPrBody,
      reviews: [],
      changedFiles: [{ filename: 'web/src/App.tsx' }],
      checkRuns: skippedReleaseRuns,
    });
    assert.equal(gateCodeMainSkippedRes.status.state, 'pending');
    assert.equal(gateCodeMainSkippedRes.calls.graphql.length, 0);

    // Non-main/non-beta stacked PRs (targeting a feature branch) must not require Production Release Checks
    const gateStackedFeatureBaseRes = await runReviewGateCase({
      prAuthor: 'github-actions[bot]',
      baseRef: 'feature/parent-branch',
      headSha: gateHeadSha,
      body: validStrictPrBody,
      reviews: [],
      checkRuns: [],
    });
    assert.equal(gateStackedFeatureBaseRes.status.state, 'success');
    assert.equal(
      gateStackedFeatureBaseRes.calls.createComment.some((c) =>
        c.body.includes('Production Release Checks')
      ),
      false
    );

    const greenHeadRuns = greenBetaHeadRuns;

    for (const blockingRuns of [
      [],
      [{ name: 'Build & Test', status: 'in_progress', conclusion: null, started_at: '2026-11-13T01:01:00Z' }],
      [
        { name: 'Build & Test', status: 'completed', conclusion: 'success', started_at: '2026-11-13T01:01:00Z' },
        { name: 'Android APK', status: 'completed', conclusion: 'failure', started_at: '2026-11-13T01:01:00Z' },
      ],
    ]) {
      const gateBlockedNotGreenRes = await runReviewGateCase({
        prAuthor: 'shthed',
        baseRef: 'beta',
        headSha: gateHeadSha,
        body: validStrictPrBody,
        reviews: [],
        mergeableState: 'blocked',
        checkRuns: blockingRuns,
      });
      assert.equal(gateBlockedNotGreenRes.status.state, 'success');
      assert.equal(gateBlockedNotGreenRes.calls.merge.length, 0);
    }

    const gateBlockedHeldRes = await runReviewGateCase({
      prAuthor: 'shthed',
      baseRef: 'beta',
      headSha: gateHeadSha,
      body: validStrictPrBody,
      reviews: [],
      labels: ['review:ai-approved', 'review:changes-requested'],
      mergeableState: 'blocked',
      checkRuns: greenHeadRuns,
    });
    assert.notEqual(gateBlockedHeldRes.status.state, 'success');
    assert.equal(gateBlockedHeldRes.calls.merge.length, 0);

    const gateCleanStateNoDirectMergeRes = await runReviewGateCase({
      prAuthor: 'shthed',
      baseRef: 'beta',
      headSha: gateHeadSha,
      body: validStrictPrBody,
      reviews: [],
      mergeableState: 'unstable',
      checkRuns: greenHeadRuns,
    });
    assert.equal(gateCleanStateNoDirectMergeRes.status.state, 'success');
    assert.equal(gateCleanStateNoDirectMergeRes.calls.merge.length, 0);

    // Draft PRs must include a `- [ ]` outstanding-work checklist before being marked Ready for Review
    const gateDraftMissingChecklistRes = await runReviewGateCase({
      prAuthor: 'github-actions[bot]',
      baseRef: 'beta',
      isDraft: true,
      headSha: gateHeadSha,
      body: validStrictPrBody,
    });
    assert.equal(gateDraftMissingChecklistRes.status.state, 'pending');
    assert.equal(
      gateDraftMissingChecklistRes.status.description.includes('Draft outstanding-work checklist'),
      true
    );
    assert.equal(
      gateDraftMissingChecklistRes.calls.createComment[0].body.includes(
        '- [ ] **Draft Outstanding Work Checklist**'
      ),
      true
    );

    const draftWithOutstandingBody = [
      '## Summary',
      '',
      'WIP Draft feature slice.',
      '',
      '## Outstanding Work Before Marking Ready',
      '- [ ] Finish Playwright E2E regression tests',
      '',
      '### PR Readiness Score: 80%',
    ].join('\n');
    const gateDraftWithChecklistRes = await runReviewGateCase({
      prAuthor: 'github-actions[bot]',
      baseRef: 'beta',
      isDraft: true,
      headSha: gateHeadSha,
      body: draftWithOutstandingBody,
    });
    assert.equal(gateDraftWithChecklistRes.status.state, 'pending');
    assert.equal(
      gateDraftWithChecklistRes.status.description.includes('Draft outstanding-work checklist'),
      false
    );
    assert.equal(
      gateDraftWithChecklistRes.calls.createComment[0].body.includes(
        '- [x] **Draft Outstanding Work Checklist**'
      ),
      true
    );

    const gateReadyStillUncheckedBlockedRes = await runReviewGateCase({
      prAuthor: 'github-actions[bot]',
      baseRef: 'beta',
      isDraft: false,
      headSha: gateHeadSha,
      body: draftWithOutstandingBody,
      labels: ['review:ai-approved'],
    });
    assert.equal(gateReadyStillUncheckedBlockedRes.status.state, 'pending');
    assert.deepEqual(
      gateReadyStillUncheckedBlockedRes.calls.removeLabel.map((r) => r.name),
      ['review:ai-approved']
    );

    // Dependabot PRs omit ## Summary / PR Readiness Score, yet still reject unchecked or sub-100% lines
    const gateDependabotBetaExemptPassRes = await runReviewGateCase({
      prAuthor: 'dependabot[bot]',
      baseRef: 'beta',
      headSha: gateHeadSha,
      body: 'Bump vite from 7.0.0 to 7.0.1.',
      labels: ['review:ai-approved'],
      aiCommentScore: 100,
    });
    assert.equal(gateDependabotBetaExemptPassRes.status.state, 'success');
    assert.equal(gateDependabotBetaExemptPassRes.status.description, gateBetaPassDesc);

    const gateDependabotBetaBadChecklistRes = await runReviewGateCase({
      prAuthor: 'dependabot[bot]',
      baseRef: 'beta',
      headSha: gateHeadSha,
      body: 'Bump vite.\n\n- [ ] Check release notes\n',
      labels: ['review:ai-approved'],
      aiCommentScore: 100,
    });
    assert.equal(gateDependabotBetaBadChecklistRes.status.state, 'pending');
    assert.equal(gateDependabotBetaBadChecklistRes.status.description, gateStrictNotMetDesc);
    assert.deepEqual(
      gateDependabotBetaBadChecklistRes.calls.removeLabel.map((r) => r.name),
      ['review:ai-approved']
    );

    // sync/beta-from-main PR body is exempted from ## Summary / PR Readiness Score even under AI review
    const gateSyncBodyExemptPassRes = await runReviewGateCase({
      prAuthor: 'github-actions[bot]',
      baseRef: 'beta',
      headRef: 'sync/beta-from-main',
      headSha: gateHeadSha,
      body: 'Automated merge of origin/main into beta.',
      labels: ['review:ai-approved'],
      aiCommentScore: 100,
    });
    assert.equal(gateSyncBodyExemptPassRes.status.state, 'success');
    assert.equal(gateSyncBodyExemptPassRes.calls.graphql.length, 1);
    assert.equal(gateSyncBodyExemptPassRes.calls.graphql[0].variables.mergeMethod, 'MERGE');

    // GraphQL enablePullRequestAutoMerge preserves existing MERGE method on beta, and held PR disables active auto-merge
    const gateBetaPreservesMergeMethodRes = await runReviewGateCase({
      prAuthor: 'github-actions[bot]',
      baseRef: 'beta',
      headSha: gateHeadSha,
      body: validStrictPrBody,
      autoMerge: { merge_method: 'MERGE' },
    });
    assert.equal(gateBetaPreservesMergeMethodRes.status.state, 'success');
    assert.equal(gateBetaPreservesMergeMethodRes.calls.graphql.length, 0);

    const gateHeldDisablesAutoMergeRes = await runReviewGateCase({
      prAuthor: 'github-actions[bot]',
      baseRef: 'beta',
      headSha: gateHeadSha,
      nodeId: 'PR_node_490',
      autoMerge: { merge_method: 'SQUASH' },
      comments: [
        {
          id: 950,
          user: { login: 'shthed' },
          body: 'HOLD - pause auto-merge',
          created_at: '2026-11-13T01:05:00Z',
          updated_at: '2026-11-13T01:05:00Z',
        },
      ],
    });
    assert.equal(gateHeldDisablesAutoMergeRes.status.state, 'failure');
    assert.equal(gateHeldDisablesAutoMergeRes.calls.graphql.length, 1);
    assert.equal(
      gateHeldDisablesAutoMergeRes.calls.graphql[0].query.includes('disablePullRequestAutoMerge'),
      true
    );
    assert.equal(
      gateHeldDisablesAutoMergeRes.calls.graphql[0].variables.pullRequestId,
      'PR_node_490'
    );
    assert.equal(gateHeldDisablesAutoMergeRes.calls.merge.length, 0);

    // (o) Verified sync/beta-from-main -> beta fast-pass & fail-closed checks
    const baseSyncSha = 'basesha000000000000000000000000000000000';
    const mainSyncSha = 'mainsha111111111111111111111111111111111';
    const betaSyncSha = 'betasha222222222222222222222222222222222';
    const syncMergeSha = 'syncsha333333333333333333333333333333333';
    const syncCommitsFixture = {
      [syncMergeSha]: {
        sha: syncMergeSha,
        commit: {
          committer: { date: '2026-11-15T01:00:00Z' },
          author: { date: '2026-11-15T01:00:00Z' },
          tree: { sha: 'tree-main-exact' },
        },
      },
      'heads/main': {
        sha: mainSyncSha,
        commit: { tree: { sha: 'tree-main-exact' } },
      },
      'heads/beta': {
        sha: betaSyncSha,
        commit: { tree: { sha: 'tree-beta-old' } },
      },
    };
    const syncExactCompareFixture = {
      [`${syncMergeSha}...${mainSyncSha}`]: { ahead_by: 0, total_commits: 0 },
      [`${mainSyncSha}...${syncMergeSha}`]: {
        ahead_by: 1,
        total_commits: 1,
        files: [],
        commits: [
          {
            sha: syncMergeSha,
            parents: [{ sha: betaSyncSha }, { sha: mainSyncSha }],
          },
        ],
      },
      [`${syncMergeSha}...${betaSyncSha}`]: { ahead_by: 0, total_commits: 0 },
      [`${mainSyncSha}...${betaSyncSha}`]: { ahead_by: 0, total_commits: 0 },
    };

    const gateMainSyncExactPassRes = await runReviewGateCase({
      prAuthor: 'github-actions[bot]',
      baseRef: 'beta',
      headRef: 'sync/beta-from-main',
      headSha: syncMergeSha,
      labels: [],
      aiCommentScore: null,
      commitsByRef: syncCommitsFixture,
      compareMap: syncExactCompareFixture,
      eventName: 'pull_request',
      action: 'synchronize',
    });
    assert.equal(gateMainSyncExactPassRes.status.state, 'success');
    assert.equal(
      gateMainSyncExactPassRes.status.description,
      'Beta gate passed (no Owner approval needed): verified origin/main sync'
    );

    const gateMainSyncFastForwardPassRes = await runReviewGateCase({
      prAuthor: 'github-actions[bot]',
      baseRef: 'beta',
      headRef: 'sync/beta-from-main',
      headSha: mainSyncSha,
      labels: [],
      aiCommentScore: null,
      commitsByRef: {
        ...syncCommitsFixture,
        [mainSyncSha]: {
          sha: mainSyncSha,
          commit: {
            committer: { date: '2026-11-15T01:00:00Z' },
            author: { date: '2026-11-15T01:00:00Z' },
            tree: { sha: 'tree-main-exact' },
          },
        },
      },
      compareMap: {
        [`${mainSyncSha}...${mainSyncSha}`]: { ahead_by: 0, total_commits: 0 },
        [`${mainSyncSha}...${betaSyncSha}`]: { ahead_by: 0, total_commits: 0 },
      },
      eventName: 'pull_request',
      action: 'synchronize',
    });
    assert.equal(gateMainSyncFastForwardPassRes.status.state, 'success');

    // Defect 1D regression: unreviewed 1-parent no-op/reverted commit or multi-commit on betaIsAncestorOfMain (even with tree === mainTreeSha) fails closed -> pending
    const gateMainSyncUnreviewedNoopFailRes = await runReviewGateCase({
      prAuthor: 'github-actions[bot]',
      baseRef: 'beta',
      headRef: 'sync/beta-from-main',
      headSha: syncMergeSha,
      labels: [],
      aiCommentScore: null,
      commitsByRef: syncCommitsFixture,
      compareMap: {
        [`${syncMergeSha}...${mainSyncSha}`]: { ahead_by: 0, total_commits: 0 },
        [`${mainSyncSha}...${syncMergeSha}`]: {
          ahead_by: 1,
          total_commits: 1,
          files: [],
          commits: [
            {
              sha: syncMergeSha,
              parents: [{ sha: betaSyncSha }],
            },
          ],
        },
        [`${syncMergeSha}...${betaSyncSha}`]: { ahead_by: 0, total_commits: 0 },
        [`${mainSyncSha}...${betaSyncSha}`]: { ahead_by: 0, total_commits: 0 },
      },
    });
    assert.equal(gateMainSyncUnreviewedNoopFailRes.status.state, 'pending');

    const gateMainSyncMultiCommitFailRes = await runReviewGateCase({
      prAuthor: 'github-actions[bot]',
      baseRef: 'beta',
      headRef: 'sync/beta-from-main',
      headSha: syncMergeSha,
      labels: [],
      aiCommentScore: null,
      commitsByRef: syncCommitsFixture,
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
    assert.equal(gateMainSyncMultiCommitFailRes.status.state, 'pending');

    // Diverged beta + main clean merge passes only when commits + files match mergeBase..main without touching beta-modified files
    const gateMainSyncDivergedPassRes = await runReviewGateCase({
      prAuthor: 'github-actions[bot]',
      baseRef: 'beta',
      headRef: 'sync/beta-from-main',
      headSha: syncMergeSha,
      labels: [],
      aiCommentScore: null,
      commitsByRef: {
        ...syncCommitsFixture,
        [syncMergeSha]: {
          ...syncCommitsFixture[syncMergeSha],
          commit: { ...syncCommitsFixture[syncMergeSha].commit, tree: { sha: 'tree-merged-clean' } },
        },
      },
      compareMap: {
        [`${syncMergeSha}...${mainSyncSha}`]: { ahead_by: 0, total_commits: 0 },
        [`${syncMergeSha}...${betaSyncSha}`]: { ahead_by: 0, total_commits: 0 },
        [`${mainSyncSha}...${betaSyncSha}`]: {
          ahead_by: 1,
          merge_base_commit: { sha: baseSyncSha },
        },
        [`${betaSyncSha}...${syncMergeSha}`]: {
          total_commits: 2,
          commits: [
            { sha: mainSyncSha, parents: [{ sha: baseSyncSha }] },
            { sha: syncMergeSha, parents: [{ sha: betaSyncSha }, { sha: mainSyncSha }] },
          ],
          files: [{ filename: 'CAPYBOOP.md', status: 'modified', sha: 'blob-capyboop-1' }],
        },
        [`${baseSyncSha}...${betaSyncSha}`]: {
          total_commits: 1,
          commits: [{ sha: betaSyncSha, parents: [{ sha: baseSyncSha }] }],
          files: [{ filename: 'beta-only.md', status: 'modified', sha: 'blob-beta-only' }],
        },
        [`${baseSyncSha}...${mainSyncSha}`]: {
          total_commits: 1,
          commits: [{ sha: mainSyncSha, parents: [{ sha: baseSyncSha }] }],
          files: [{ filename: 'CAPYBOOP.md', status: 'modified', sha: 'blob-capyboop-1' }],
        },
      },
    });
    assert.equal(gateMainSyncDivergedPassRes.status.state, 'success');
    assert.equal(
      gateMainSyncDivergedPassRes.status.description,
      'Beta gate passed (no Owner approval needed): verified origin/main sync'
    );

    // Defect 1A regression (PR #525 pattern): shared-file 3-way conflict (even clean merge) & evil-merge clobber both fail closed -> pending
    for (const conflictScenario of [
      {
        name: 'shared-file 3-way merge',
        prBlob: 'blob-merged-clean',
      },
      {
        name: 'evil-merge overwriting beta edits with main blob',
        prBlob: 'blob-main-clobber',
      },
    ]) {
      const sharedFileFailRes = await runReviewGateCase({
        prAuthor: 'github-actions[bot]',
        baseRef: 'beta',
        headRef: 'sync/beta-from-main',
        headSha: syncMergeSha,
        labels: [],
        aiCommentScore: null,
        commitsByRef: {
          ...syncCommitsFixture,
          [syncMergeSha]: {
            ...syncCommitsFixture[syncMergeSha],
            commit: { ...syncCommitsFixture[syncMergeSha].commit, tree: { sha: 'tree-merged-shared' } },
          },
        },
        compareMap: {
          [`${syncMergeSha}...${mainSyncSha}`]: { ahead_by: 0, total_commits: 0 },
          [`${syncMergeSha}...${betaSyncSha}`]: { ahead_by: 0, total_commits: 0 },
          [`${mainSyncSha}...${betaSyncSha}`]: {
            ahead_by: 1,
            merge_base_commit: { sha: baseSyncSha },
          },
          [`${betaSyncSha}...${syncMergeSha}`]: {
            total_commits: 2,
            commits: [
              { sha: mainSyncSha, parents: [{ sha: baseSyncSha }] },
              { sha: syncMergeSha, parents: [{ sha: betaSyncSha }, { sha: mainSyncSha }] },
            ],
            files: [{ filename: 'CHANGELOG.md', status: 'modified', sha: conflictScenario.prBlob }],
          },
          [`${baseSyncSha}...${betaSyncSha}`]: {
            total_commits: 1,
            commits: [{ sha: betaSyncSha, parents: [{ sha: baseSyncSha }] }],
            files: [{ filename: 'CHANGELOG.md', status: 'modified', sha: 'blob-beta-cl' }],
          },
          [`${baseSyncSha}...${mainSyncSha}`]: {
            total_commits: 1,
            commits: [{ sha: mainSyncSha, parents: [{ sha: baseSyncSha }] }],
            files: [{ filename: 'CHANGELOG.md', status: 'modified', sha: 'blob-main-clobber' }],
          },
        },
      });
      assert.equal(
        sharedFileFailRes.status.state,
        'pending',
        `Expected ${conflictScenario.name} to fail closed to pending`
      );
    }

    // Defect 1A renamed previous_filename mismatch + Defect 1B compare truncation (total_commits: 260) fail closed -> pending
    const gateMainSyncRenameMismatchFailRes = await runReviewGateCase({
      prAuthor: 'github-actions[bot]',
      baseRef: 'beta',
      headRef: 'sync/beta-from-main',
      headSha: syncMergeSha,
      labels: [],
      aiCommentScore: null,
      commitsByRef: syncCommitsFixture,
      compareMap: {
        [`${syncMergeSha}...${mainSyncSha}`]: { ahead_by: 0, total_commits: 0 },
        [`${syncMergeSha}...${betaSyncSha}`]: { ahead_by: 0, total_commits: 0 },
        [`${mainSyncSha}...${betaSyncSha}`]: {
          ahead_by: 1,
          merge_base_commit: { sha: baseSyncSha },
        },
        [`${betaSyncSha}...${syncMergeSha}`]: {
          total_commits: 2,
          commits: [
            { sha: mainSyncSha, parents: [{ sha: baseSyncSha }] },
            { sha: syncMergeSha, parents: [{ sha: betaSyncSha }, { sha: mainSyncSha }] },
          ],
          files: [
            {
              filename: 'GUIDE_NEW.md',
              status: 'renamed',
              previous_filename: 'OTHER.md',
              sha: 'blob-guide',
            },
          ],
        },
        [`${baseSyncSha}...${betaSyncSha}`]: {
          total_commits: 1,
          commits: [{ sha: betaSyncSha, parents: [{ sha: baseSyncSha }] }],
          files: [{ filename: 'beta-only.md', status: 'modified', sha: 'blob-beta-only' }],
        },
        [`${baseSyncSha}...${mainSyncSha}`]: {
          total_commits: 1,
          commits: [{ sha: mainSyncSha, parents: [{ sha: baseSyncSha }] }],
          files: [
            {
              filename: 'GUIDE_NEW.md',
              status: 'renamed',
              previous_filename: 'GUIDE_OLD.md',
              sha: 'blob-guide',
            },
          ],
        },
      },
    });
    assert.equal(gateMainSyncRenameMismatchFailRes.status.state, 'pending');

    const gateMainSyncTruncatedCompareFailRes = await runReviewGateCase({
      prAuthor: 'github-actions[bot]',
      baseRef: 'beta',
      headRef: 'sync/beta-from-main',
      headSha: syncMergeSha,
      labels: [],
      aiCommentScore: null,
      commitsByRef: syncCommitsFixture,
      compareMap: {
        [`${syncMergeSha}...${mainSyncSha}`]: { ahead_by: 0, total_commits: 0 },
        [`${syncMergeSha}...${betaSyncSha}`]: { ahead_by: 0, total_commits: 0 },
        [`${mainSyncSha}...${betaSyncSha}`]: {
          ahead_by: 1,
          merge_base_commit: { sha: baseSyncSha },
        },
        [`${betaSyncSha}...${syncMergeSha}`]: {
          total_commits: 260,
          commits: [
            { sha: mainSyncSha, parents: [{ sha: baseSyncSha }] },
            { sha: syncMergeSha, parents: [{ sha: betaSyncSha }, { sha: mainSyncSha }] },
          ],
          files: [{ filename: 'CAPYBOOP.md', status: 'modified', sha: 'blob-capyboop-1' }],
        },
        [`${baseSyncSha}...${betaSyncSha}`]: {
          total_commits: 1,
          commits: [{ sha: betaSyncSha, parents: [{ sha: baseSyncSha }] }],
          files: [{ filename: 'beta-only.md', status: 'modified', sha: 'blob-beta-only' }],
        },
        [`${baseSyncSha}...${mainSyncSha}`]: {
          total_commits: 1,
          commits: [{ sha: mainSyncSha, parents: [{ sha: baseSyncSha }] }],
          files: [{ filename: 'CAPYBOOP.md', status: 'modified', sha: 'blob-capyboop-1' }],
        },
      },
    });
    assert.equal(gateMainSyncTruncatedCompareFailRes.status.state, 'pending');

    // Defect 1C regression: future +10m commitDate with skewAnchorMs === 0 cannot drop a live HOLD comment (nor re-evaluation anchored by initial capy/review-gate status)
    const liveFutureNow = Date.now();
    const gateBetaFutureCommitHoldFailRes = await runReviewGateCase({
      prAuthor: 'github-actions[bot]',
      baseRef: 'beta',
      headSha: gateHeadSha,
      labels: [],
      aiCommentScore: null,
      commitDate: new Date(liveFutureNow + 10 * 60_000).toISOString(),
      comments: [
        {
          id: 910,
          user: { login: 'shthed' },
          body: 'HOLD - do not drop under future commitDate skew',
          created_at: new Date(liveFutureNow + 2 * 60_000).toISOString(),
          updated_at: new Date(liveFutureNow + 2 * 60_000).toISOString(),
        },
      ],
      eventName: 'issue_comment',
      action: 'created',
    });
    assert.equal(gateBetaFutureCommitHoldFailRes.status.state, 'failure');

    // +45s (+1s..+60s) future commitDate skew with AI approval at T+10s must NEVER drop Owner HOLD at T
    const nowSkew45 = Date.now();
    const gateBetaSkew45sHoldFailRes = await runReviewGateCase({
      prAuthor: 'github-actions[bot]',
      baseRef: 'beta',
      headSha: gateHeadSha,
      labels: [],
      aiCommentScore: 100,
      aiCommentTs: new Date(nowSkew45 + 10_000).toISOString(),
      commitDate: new Date(nowSkew45 + 45_000).toISOString(),
      comments: [
        {
          id: 912,
          user: { login: 'shthed' },
          body: 'HOLD - +45s clock skew must still fail closed',
          created_at: new Date(nowSkew45).toISOString(),
          updated_at: new Date(nowSkew45).toISOString(),
        },
      ],
      eventName: 'issue_comment',
      action: 'created',
    });
    assert.equal(gateBetaSkew45sHoldFailRes.status.state, 'failure');

    const gateBetaPastSkewStatusAnchorHoldFailRes = await runReviewGateCase({
      prAuthor: 'github-actions[bot]',
      baseRef: 'beta',
      headSha: gateHeadSha,
      labels: [],
      aiCommentScore: null,
      commitDate: '2026-11-13T01:10:00Z',
      commitStatuses: [
        {
          context: 'capy/review-gate',
          state: 'pending',
          created_at: '2026-11-13T01:00:05Z',
        },
      ],
      comments: [
        {
          id: 911,
          user: { login: 'shthed' },
          body: 'HOLD - caught via initial status timestamp anchor',
          created_at: '2026-11-13T01:02:00Z',
          updated_at: '2026-11-13T01:02:00Z',
        },
      ],
      eventName: 'issue_comment',
      action: 'created',
    });
    assert.equal(gateBetaPastSkewStatusAnchorHoldFailRes.status.state, 'failure');

    // Probe 9b regression: +45s skewed commit re-evaluated at t0+120s (after nowMs passes committer.date) must STILL detect skew via earliestHeadStatusMs (t0+15s) and enforce HOLD (t0+10s)
    const probe9bT0 = Date.now() - 120_000;
    const gateBetaProbe9bStatusAnchoredSkewHoldRes = await runReviewGateCase({
      prAuthor: 'github-actions[bot]',
      baseRef: 'beta',
      headSha: gateHeadSha,
      labels: ['review:ai-approved'],
      commitDate: new Date(probe9bT0 + 45_000).toISOString(),
      commitStatuses: [
        {
          context: 'capy/review-gate',
          state: 'pending',
          created_at: new Date(probe9bT0 + 15_000).toISOString(),
        },
      ],
      aiCommentScore: 100,
      aiCommentTs: new Date(probe9bT0 + 30_000).toISOString(),
      comments: [
        {
          id: 913,
          user: { login: 'shthed' },
          body: 'HOLD - Probe 9b post-push hold before status anchor must fail closed after t0+120s',
          created_at: new Date(probe9bT0 + 10_000).toISOString(),
          updated_at: new Date(probe9bT0 + 10_000).toISOString(),
        },
      ],
      eventName: 'issue_comment',
      action: 'created',
    });
    assert.equal(gateBetaProbe9bStatusAnchoredSkewHoldRes.status.state, 'failure');

    // Evil merge injecting extra file or modified blob SHA fails closed -> pending
    const gateMainSyncEvilMergeFailRes = await runReviewGateCase({
      prAuthor: 'github-actions[bot]',
      baseRef: 'beta',
      headRef: 'sync/beta-from-main',
      headSha: syncMergeSha,
      labels: [],
      aiCommentScore: null,
      commitsByRef: {
        ...syncCommitsFixture,
        [syncMergeSha]: {
          ...syncCommitsFixture[syncMergeSha],
          commit: { ...syncCommitsFixture[syncMergeSha].commit, tree: { sha: 'tree-evil' } },
        },
      },
      compareMap: {
        [`${syncMergeSha}...${mainSyncSha}`]: { ahead_by: 0, total_commits: 0 },
        [`${syncMergeSha}...${betaSyncSha}`]: { ahead_by: 0, total_commits: 0 },
        [`${mainSyncSha}...${betaSyncSha}`]: {
          ahead_by: 1,
          merge_base_commit: { sha: baseSyncSha },
        },
        [`${betaSyncSha}...${syncMergeSha}`]: {
          total_commits: 1,
          commits: [{ sha: syncMergeSha, parents: [{ sha: betaSyncSha }, { sha: mainSyncSha }] }],
          files: [
            { filename: 'CAPYBOOP.md', status: 'modified', sha: 'blob-capyboop-1' },
            { filename: 'web/src/evil.ts', status: 'added', sha: 'blob-evil' },
          ],
        },
        [`${baseSyncSha}...${betaSyncSha}`]: {
          total_commits: 1,
          commits: [{ sha: betaSyncSha, parents: [{ sha: baseSyncSha }] }],
          files: [{ filename: 'beta-only.md', status: 'modified', sha: 'blob-beta-only' }],
        },
        [`${baseSyncSha}...${mainSyncSha}`]: {
          total_commits: 1,
          commits: [{ sha: mainSyncSha, parents: [{ sha: baseSyncSha }] }],
          files: [{ filename: 'CAPYBOOP.md', status: 'modified', sha: 'blob-capyboop-1' }],
        },
      },
    });
    assert.equal(gateMainSyncEvilMergeFailRes.status.state, 'pending');
    assert.equal(gateMainSyncEvilMergeFailRes.status.description, gateBetaAwaitingAiDesc);

    // Unreviewed non-main commit or revert of beta-ahead work even with tree === mainTreeSha fails closed -> pending
    const gateMainSyncBetaRevertFailRes = await runReviewGateCase({
      prAuthor: 'github-actions[bot]',
      baseRef: 'beta',
      headRef: 'sync/beta-from-main',
      headSha: syncMergeSha,
      labels: [],
      aiCommentScore: null,
      commitsByRef: syncCommitsFixture,
      compareMap: {
        [`${syncMergeSha}...${mainSyncSha}`]: { ahead_by: 0, total_commits: 0 },
        [`${syncMergeSha}...${betaSyncSha}`]: { ahead_by: 0, total_commits: 0 },
        [`${mainSyncSha}...${betaSyncSha}`]: {
          ahead_by: 1,
          merge_base_commit: { sha: baseSyncSha },
        },
        [`${betaSyncSha}...${syncMergeSha}`]: {
          total_commits: 2,
          commits: [
            { sha: 'unreviewed123', parents: [{ sha: mainSyncSha }] },
            { sha: syncMergeSha, parents: [{ sha: betaSyncSha }, { sha: 'unreviewed123' }] },
          ],
          files: [{ filename: 'CAPYBOOP.md', status: 'modified', sha: 'blob-capyboop-1' }],
        },
        [`${baseSyncSha}...${betaSyncSha}`]: {
          total_commits: 1,
          commits: [{ sha: betaSyncSha, parents: [{ sha: baseSyncSha }] }],
          files: [{ filename: 'beta-only.md', status: 'modified', sha: 'blob-beta-only' }],
        },
        [`${baseSyncSha}...${mainSyncSha}`]: {
          total_commits: 1,
          commits: [{ sha: mainSyncSha, parents: [{ sha: baseSyncSha }] }],
          files: [{ filename: 'CAPYBOOP.md', status: 'modified', sha: 'blob-capyboop-1' }],
        },
        [`${mainSyncSha}...unreviewed123`]: { ahead_by: 1 },
      },
    });
    assert.equal(gateMainSyncBetaRevertFailRes.status.state, 'pending');

    // Fork sync/beta-from-main, draft, HOLD comment, and --base main all fail closed / obey full gate
    const gateMainSyncForkFailRes = await runReviewGateCase({
      prAuthor: 'github-actions[bot]',
      baseRef: 'beta',
      headRef: 'sync/beta-from-main',
      headRepoFullName: 'stranger/capy',
      headSha: syncMergeSha,
      labels: [],
      aiCommentScore: null,
      commitsByRef: syncCommitsFixture,
      compareMap: syncExactCompareFixture,
    });
    assert.equal(gateMainSyncForkFailRes.status.state, 'pending');

    const gateMainSyncHoldFailRes = await runReviewGateCase({
      prAuthor: 'github-actions[bot]',
      baseRef: 'beta',
      headRef: 'sync/beta-from-main',
      headSha: syncMergeSha,
      labels: [],
      aiCommentScore: null,
      commitsByRef: syncCommitsFixture,
      compareMap: syncExactCompareFixture,
      comments: [
        {
          id: 909,
          user: { login: 'shthed' },
          body: 'HOLD - wait for verification',
          created_at: '2026-11-15T01:05:00Z',
          updated_at: '2026-11-15T01:05:00Z',
        },
      ],
    });
    assert.equal(gateMainSyncHoldFailRes.status.state, 'failure');

    const gateMainSyncTargetMainPendingRes = await runReviewGateCase({
      prAuthor: 'github-actions[bot]',
      baseRef: 'main',
      headRef: 'sync/beta-from-main',
      headSha: syncMergeSha,
      labels: [],
      aiCommentScore: null,
      commitsByRef: syncCommitsFixture,
      compareMap: syncExactCompareFixture,
    });
    assert.equal(gateMainSyncTargetMainPendingRes.status.state, 'pending');
    logUnitPass('pr-review-gate.yml 100% AI score, checklist & hold/sync enforcement verified.');
    Object.assign(devShared, {
      AsyncFunction,
      extractWorkflowScript,
      mainSyncSha,
      betaSyncSha,
      syncMergeSha,
      syncCommitsFixture,
      syncExactCompareFixture,
    });
}
