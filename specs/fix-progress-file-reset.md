---
id: fix-progress-file-reset
title: the progress file does not get reset
status: in-progress
priority: high
created: 2026-01-17T00:00:00.000Z
updated: 2026-01-17T14:30:00.000Z
---

## Summary
The progress file (`progress.txt`) does not get reset when a task completes, causing stale context to accumulate across different tasks. This spec adds automatic cleanup after task completion and a `sonata clean` command for manual reset.

## Tasks
- [x] Import `deleteProgress` from `../lib/progress` in `src/commands/run.ts`
- [x] Call `deleteProgress(cwd)` after `clearSession(cwd)` in `src/commands/run.ts` (~2 locations)
- [x] Import `deleteProgress` from `../lib/progress` in `src/commands/loop.ts`
- [ ] Call `deleteProgress(cwd)` after `clearSession(cwd)` in `src/commands/loop.ts` (~2 locations)
- [ ] Create `src/commands/clean.ts` with confirmation prompt that deletes progress file
- [ ] Register `clean` command in `src/cli.ts`

## Files
- src/commands/run.ts
- src/commands/loop.ts
- src/commands/clean.ts (new)
- src/cli.ts

## Acceptance Criteria
- Progress file is automatically deleted when a task completes successfully
- Running `sonata clean` prompts for confirmation, then clears the progress file
- Starting a new task after completion begins with a fresh progress file
- No breaking changes to existing workflow

## Definition of Done
When progress files are automatically cleaned up after task completion, `sonata clean` works with confirmation, and no stale progress leaks between different tasks.