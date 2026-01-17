---
id: add-sota-eslint-with-eslint-prettier
title: Add sota eslint with eslint-prettier
status: in-progress
priority: high
created: 2026-01-17T00:00:00.000Z
updated: 2026-01-17T13:24:15.833Z
---

## Summary
Configure ESLint 9 (flat config) with TypeScript, Prettier integration, and modern plugins (import sorting, Node.js rules, unicorn), plus pre-commit hooks via Husky and lint-staged that run lint, format, and typecheck. Update sonata's implementation prompts to incorporate the new linting workflow.

## Steps
- [ ] Step 1: Install ESLint 9 and TypeScript ESLint dependencies (`eslint`, `@eslint/js`, `typescript-eslint`)
- [ ] Step 2: Install Prettier and eslint-config-prettier (`prettier`, `eslint-config-prettier`)
- [ ] Step 3: Install additional plugins (`eslint-plugin-import-x`, `eslint-plugin-n`, `eslint-plugin-unicorn`)
- [ ] Step 4: Create `eslint.config.js` with flat config (TypeScript recommended, Prettier compat, import sorting, Node.js and unicorn rules)
- [ ] Step 5: Create `.prettierrc` config file (use defaults)
- [ ] Step 6: Create `.prettierignore` file (dist, node_modules, etc.)
- [ ] Step 7: Install Husky and lint-staged (`husky`, `lint-staged`)
- [ ] Step 8: Add lint-staged config to `package.json` (eslint --fix, prettier --write, tsc --noEmit)
- [ ] Step 9: Update `package.json` scripts (update `lint`, add `lint:fix`, `format`, `format:check`)
- [ ] Step 10: Initialize Husky and create `.husky/pre-commit` hook
- [ ] Step 11: Update `buildImplementationPrompt` in `src/lib/opencode.ts` to reference specific lint/format/typecheck commands
- [ ] Step 12: Update `buildLocalImplementationPrompt` in `src/lib/opencode.ts` with same updates
- [ ] Step 13: Run linter and fix any existing issues in codebase
- [ ] Step 14: Test pre-commit hook with a test commit

## Files
- `eslint.config.js` (new)
- `.prettierrc` (new)
- `.prettierignore` (new)
- `.husky/pre-commit` (new)
- `package.json`
- `src/lib/opencode.ts`
- `src/**/*.ts` (potential lint/format fixes)

## Acceptance Criteria
- `npm run lint` passes with no errors
- `npm run format:check` passes with no errors
- `npm run typecheck` passes with no errors
- Pre-commit hook runs lint-staged on staged files (lint, format, typecheck)
- ESLint properly integrates with TypeScript
- No conflicts between ESLint and Prettier rules
- Import statements are auto-sorted consistently
- Sonata implementation prompts reference specific lint/format/typecheck commands

## Definition of Done
When ESLint, Prettier, and pre-commit hooks are fully configured, all existing code passes linting/formatting/typecheck, a test commit triggers pre-commit validation successfully, and the sonata prompts are updated to guide AI to run the new feedback loop commands.