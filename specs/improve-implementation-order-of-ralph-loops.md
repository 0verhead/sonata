---
id: improve-implementation-order-of-ralph-loops
title: Improve implementation order of ralph loops
status: done
priority: high
created: 2026-01-17T00:00:00.000Z
updated: 2026-01-17T13:26:57.222Z
---

## Summary
Update the ralph loop implementation prompts to use the explicit prioritization order from the [aihero.dev Ralph Wiggum tips article](https://www.aihero.dev/tips-for-ai-coding-with-ralph-wiggum#2-start-with-hitl-then-go-afk), ensuring the AI tackles architectural/risky work first instead of defaulting to easy wins.

## Steps
- [x] Step 1: Update `buildImplementationPrompt()` in `src/lib/opencode.ts` to replace the vague "CHOOSE" section with the explicit 5-tier priority order from the article
- [x] Step 2: Update `buildLocalImplementationPrompt()` in the same file with identical prioritization instructions

## Files
- src/lib/opencode.ts

## Acceptance Criteria
- Both implementation prompts include the explicit 5-tier priority order:
  1. Architectural decisions and core abstractions
  2. Integration points between modules
  3. Unknown unknowns and spike work
  4. Standard features and implementation
  5. Polish, cleanup, and quick wins
- The prompt includes the "Fail fast on risky work. Save easy wins for later." guidance
- Existing functionality (completion signal, progress tracking, etc.) is unchanged

## Reference
- [11 Tips For AI Coding With Ralph Wiggum - Tip 7: Prioritize Risky Tasks](https://www.aihero.dev/tips-for-ai-coding-with-ralph-wiggum)

## Definition of Done
When both `buildImplementationPrompt()` and `buildLocalImplementationPrompt()` use the new prioritization order.