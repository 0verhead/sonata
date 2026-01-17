---
id: fix-implementation-order-of-prd-steps
title: Fix implementation order of prd steps
status: in-progress
priority: high
created: 2026-01-17T15:00:00.000Z
updated: 2026-01-17T20:00:00.000Z
---

## Summary
Replace "Steps" terminology with "Tasks" throughout the codebase and unfinished specs to eliminate implicit sequential ordering that conflicts with the 5-tier priority system.

## Tasks
- [x] Update `buildPlanningPrompt()` in `src/lib/opencode.ts`: change `## Steps` to `## Tasks`, remove numbered format from examples
- [x] Update `buildLocalPlanningPrompt()` in `src/lib/opencode.ts`: same changes
- [x] Update `buildImplementationPrompt()` in `src/lib/opencode.ts`: change "step" references to "task" (e.g., "step by step" → "task by task")
- [x] Update `buildLocalImplementationPrompt()` in `src/lib/opencode.ts`: same wording changes
- [ ] Update `templates/SPEC.example.md`: change `## Steps` to `## Tasks`, use descriptive task names
- [x] Rename `countPrdSteps()` to `countPrdTasks()` in `src/lib/session.ts`
- [x] Update Session interface in `src/lib/session.ts`: `totalSteps` → `totalTasks`, `completedSteps` → `completedTasks`
- [x] Rename `countSpecSteps()` to `countSpecTasks()` in `src/lib/specs.ts`
- [x] Update all references in `src/commands/run.ts`: function calls, variable names, user-facing messages
- [x] Update all references in `src/commands/loop.ts`: function calls, variable names, user-facing messages
- [ ] Update `specs/add-sota-eslint-with-eslint-prettier.md`: change `## Steps` to `## Tasks`, remove numbered prefixes
- [ ] Update `specs/make-setting-model-easier.md`: change `## Steps` to `## Tasks`, remove numbered prefixes

## Files
- `src/lib/opencode.ts`
- `src/lib/session.ts`
- `src/lib/specs.ts`
- `src/commands/run.ts`
- `src/commands/loop.ts`
- `templates/SPEC.example.md`
- `specs/add-sota-eslint-with-eslint-prettier.md`
- `specs/make-setting-model-easier.md`

## Acceptance Criteria
- All planning prompts use `## Tasks` section with descriptive (non-numbered) format
- Example format is `- [ ] Create database schema for metrics` NOT `- [ ] Step 1: Create database schema`
- All implementation prompts reference "tasks" not "steps"
- Internal functions renamed: `countPrdTasks()`, `countSpecTasks()`
- Session interface uses `totalTasks`, `completedTasks`
- User-facing messages say "PRD tasks", "spec tasks"
- Unfinished specs converted to new format
- Build passes with no TypeScript errors

## Reference
- [11 Tips For AI Coding With Ralph Wiggum - Tip 7: Prioritize Risky Tasks](https://www.aihero.dev/tips-for-ai-coding-with-ralph-wiggum)

## Definition of Done
When all prompts, templates, code, and unfinished specs use "Tasks" terminology, and `npm run build` succeeds.