---
id: select-spec-to-implement-next
title: Select spec to implement next
status: in-progress
priority: high
created: 2026-01-24T10:30:00Z
updated: 2026-01-24T19:00:00.000Z
---

## Summary

Enhance `sonata loop --local` to automatically continue to the next spec after completing one, using smart ranking that analyzes task content with keyword matching to prioritize specs with more architectural/risky work ("fail fast"). Add `--auto` flag to skip the initial selection prompt.

## Tasks

- [x] Define keyword lists for task classification in `specs.ts`:
  - High-risk: `architecture`, `schema`, `design`, `integration`, `API`, `contract`, `spike`, `unknown`, `core`, `abstraction`, `foundation`, `refactor`
  - Low-risk: `polish`, `fix`, `cleanup`, `style`, `typo`, `docs`, `UI`, `button`, `tweak`
- [x] Add `classifyTask(taskText: string): 'high' | 'low' | 'normal'` function in `specs.ts`
- [x] Add `getSpecRiskRatio(spec: Spec): number` that returns ratio of high-risk uncompleted tasks (0.0-1.0)
- [x] Add `getSpecProgress(spec: Spec): number` that returns completion % (0-100)
- [x] Add `getNextSpec(cwd: string): Spec | null` that returns highest-ranked spec using the full algorithm
- [x] Implement ranking: in-progress first -> risk ratio (desc) -> priority metadata -> progress % (desc) -> created date (asc)
- [x] Refactor `runLocalLoopCommand()` in `loop.ts`: after PR creation, select next spec and continue
- [x] Initialize new session and branch for the next spec
- [ ] Add `--auto` flag to `loop` command in `index.ts`
- [ ] Update selection UI to show risk ratio and progress (e.g., `[IN PROGRESS 75%] [RISK: 40%]`)
- [ ] Ensure iteration count persists across specs

## Files

- src/lib/specs.ts
- src/commands/loop.ts
- src/index.ts

## Acceptance Criteria

- Tasks classified by keywords into high-risk, normal, or low-risk
- Specs with higher ratio of risky uncompleted tasks are prioritized ("fail fast")
- `sonata loop --local` continues to next spec after completing one
- `--auto` flag skips initial spec picker
- Iteration limit applies across all specs in session
- Selection UI shows risk ratio and progress %

## Definition of Done

When `sonata loop --local` can autonomously chain through multiple specs, prioritizing those with more architectural/risky work first, aligning with the Ralph principle of "fail fast on risky work, save easy wins for later."
