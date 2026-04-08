# Record Mode Implementation Handoff Prompt

Use this prompt to continue implementation in a new manually triggered session.

```text
You are continuing Record Mode implementation for Web Lens.

Context:
- Repo: collectiveai-team/vscode-web-lens
- Branch: feat/record-mode-plan
- PR: #3
- Work from audit is already applied in docs:
  - docs/specs/2026-04-06-record-mode-design.md
  - docs/plans/2026-04-06-record-mode.md

Read those two files first, then implement exactly from the updated plan.

Critical requirements from the updated audit:
1) Implement and test `mode:record` handling in webview `main.ts`.
2) Re-arm record listeners after iframe navigation while recording is active.
3) Use `input` event capture (not `change`) for recorded input events.
4) Escape selector/id fragments in selector builders.
5) Add/extend tests for `src/webview/main.test.ts` covering command-path start/stop and navigation resume.

Execution constraints:
- Work in a dedicated git worktree.
- Follow TDD task-by-task from docs/plans/2026-04-06-record-mode.md.
- Do not skip verification steps (`npm run build`, targeted tests, full `npm test`).
- Keep commits small and aligned with plan tasks.

Completion requirements:
- Ensure all tests and build pass.
- Update PR #3 branch with implementation commits.
- Summarize what was implemented vs plan, and call out any deviations.
```

## Operator Notes

- Start from `.worktrees/record-mode-plan` or create a fresh worktree from `feat/record-mode-plan`.
- If the implementation uncovers new blockers, update the plan in `docs/plans/2026-04-06-record-mode.md` before coding around them.
