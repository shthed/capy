# Cross-Repo Reference Guardrail (`docs/ai/cross-repo-guardrail.md`)

Private persona-isolation guardrail preventing accidental GitHub cross-reference timeline leaks onto the public `capyboop/paint` repository. Excluded wholesale from public `capyboop/paint` clean-room exports via [`rebrand-persona.mjs`](../../web/scripts/rebrand-persona.mjs).

**Related Guides**: [`AGENTS.md`](../../AGENTS.md) | [`CAPYBOOP.md`](../../CAPYBOOP.md) | [`workflow-and-models.md`](./workflow-and-models.md) | [`pr-readiness.md`](./pr-readiness.md)

---

## 1. Why Cross-References Leak Private Identity

Whenever any Pull Request description, Issue body, PR/Issue comment, or commit message in the private development repository contains a live GitHub link or shorthand reference to a specific `capyboop/paint` issue or pull request, GitHub automatically posts a public cross-reference timeline event on the target `capyboop/paint` issue. That public timeline event exposes the private development repository name and owner handle to external readers.

---

## 2. Prohibited Patterns vs. Allowed Plain Text

Inside private development repository PR titles, PR bodies, Issue titles/bodies, comments, and commit messages:

- **Prohibited (Triggers GitHub Cross-Reference Events)**:
  - Live issue or PR URLs pointing to a numbered item on `capyboop/paint` (matching `https://github.com/capyboop/paint/issues/<N>` or `https://github.com/capyboop/paint/pull/<N>`).
  - GitHub cross-repo shorthand with `#` followed by digits (`capyboop/paint` + `#` + `<N>`).
- **Allowed (Zero Cross-Reference Events)**:
  - Plain text without `#` or a numbered URL, such as `` `capyboop/paint` public issue 3 `` or `` `capyboop/paint` public issue 4 ``.
  - Root tracker links without a specific issue or PR number, such as `https://github.com/capyboop/paint/issues` or `https://github.com/capyboop/paint/issues/new/choose`.

---

## 3. Automated Workflow Enforcement

The following shared regex is enforced automatically across all bot-authored GitHub write workflows and the PR review gate:

```js
/(?:https?:\/\/github\.com\/capyboop\/paint\/(?:issues|pull)\/\d+|(?<![A-Za-z0-9_.-])capyboop\/paint#\d+)/i
```

- **[`open-pr.yml`](../../.github/workflows/open-pr.yml)**: Fails fast via `core.setFailed(...)` before calling `pulls.create` or `pulls.update` if `title` or `body` matches the forbidden cross-ref regex.
- **[`open-issue.yml`](../../.github/workflows/open-issue.yml)**: Fails fast via `core.setFailed(...)` before calling `issues.create`, `issues.update`, or `issues.createComment` if `title` or `body` matches the forbidden cross-ref regex.
- **[`pr-review-gate.yml`](../../.github/workflows/pr-review-gate.yml)**:
  - `review-gate`: Inspects `pr.title` and `pr.body`; if matched, blocks `capy/review-gate` (`state = 'failure'`, blocker `Forbidden capyboop/paint cross-ref`) so the PR can never pass or auto-merge until cleaned.
  - `ai-review`: Fails fast via `core.setFailed(...)` before posting a review if `ai_summary` matches the forbidden cross-ref regex.
