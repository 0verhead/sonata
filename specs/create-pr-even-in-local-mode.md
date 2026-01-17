---
id: create-pr-even-in-local-mode
title: Create PR even in local mode
status: in-progress
priority: high
created: 2026-01-17T10:00:00Z
updated: 2026-01-17T14:00:00.000Z
---

## Summary
Fix the bug where PR creation (and branch creation) is silently skipped in local mode when no config file exists. The fix involves using `loadConfig()` instead of `null` as fallback, which returns sensible defaults (`createPR: true`, `createBranch: true`).

## Steps
- [x] Step 1: In `src/commands/run.ts`, change line 521 from `const config = configExists() ? loadConfig() : null;` to `const config = loadConfig();`
- [x] Step 2: In `src/commands/run.ts`, remove the `?` optional chaining on `config` in the local mode function (since config is now guaranteed non-null)
- [ ] Step 3: In `src/commands/loop.ts`, change line 539 from `const config = configExists() ? loadConfig() : null;` to `const config = loadConfig();`
- [ ] Step 4: In `src/commands/loop.ts`, remove the `?` optional chaining on `config` in the local loop function
- [ ] Step 5: In `src/commands/plan.ts`, change line 442 from `const config = configExists() ? loadConfig() : null;` to `const config = loadConfig();` (for consistency)
- [ ] Step 6: Update type annotations if needed (config changes from `Config | null` to `Config`)
- [ ] Step 7: Test local mode PR creation: run `sonata run --local` without setup, verify PR is offered upon completion

## Files
- src/commands/run.ts
- src/commands/loop.ts
- src/commands/plan.ts

## Acceptance Criteria
- When running `sonata run --local` or `sonata loop --local` without having run `sonata setup`, PR creation should be offered upon task completion (default behavior)
- When running with a config that has `createPR: false`, PR creation should be skipped (respects user preference)
- Branch creation should work the same way (defaults to true, respects config)
- No breaking changes to existing Notion mode behavior

## Definition of Done
When a user can run `sonata run --local` on a fresh project (no `~/.sonata/config.json`), complete a spec, and be prompted to create a PR - and when all existing tests pass.