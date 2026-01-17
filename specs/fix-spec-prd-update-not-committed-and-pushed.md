---
id: fix-spec-prd-update-not-committed-and-pushed
title: fix spec prd update is not commited and pushed to remote pr branch
status: in-progress
priority: high
created: 2026-01-17T00:00:00.000Z
updated: 2026-01-17T16:45:00.000Z
---

## Summary

Update the local planning prompt to instruct OpenCode to commit and push the spec file after saving it to `specs/`, ensuring the spec is tracked in git and pushed to the remote PR branch.

## Tasks

- [x] Update `buildLocalPlanningPrompt` in `src/lib/opencode.ts` to add commit/push instructions after the spec file is saved
- [x] Include guidance to warn (not fail) if push fails (e.g., no remote configured)
- [ ] Test the flow: `sonata plan --local` → approve spec → verify commit and push happen

## Files

- src/lib/opencode.ts

## Acceptance Criteria

- When a spec is saved via `sonata plan --local`, OpenCode commits the spec file with a descriptive message
- OpenCode attempts to push to the remote branch after committing
- If push fails (no remote, auth issues), a warning is shown but the flow continues
- The spec file is available on the remote PR branch after approval

## Definition of Done

When running `sonata plan --local`, approving a spec results in the spec file being committed and pushed to the remote branch, with graceful handling of push failures.
