---
id: add-sota-eslint-with-eslint-prettier
title: Add sota eslint with eslint-prettier
status: in-progress
priority: high
created: 2026-01-17T00:00:00.000Z
updated: 2026-01-17T16:00:00.000Z
---

## Summary

Configure ESLint 9 (flat config) with TypeScript, Prettier integration, and modern plugins (import sorting, Node.js rules, unicorn), plus pre-commit hooks via Husky and lint-staged that run lint, format, and typecheck. Update sonata's implementation prompts to incorporate the new linting workflow.

## Tasks

- [x] Install ESLint 9 and TypeScript ESLint dependencies (`eslint`, `@eslint/js`, `typescript-eslint`)
- [x] Install Prettier and eslint-config-prettier (`prettier`, `eslint-config-prettier`)
- [x] Install additional plugins (`eslint-plugin-import-x`, `eslint-plugin-n`, `eslint-plugin-unicorn`)
- [x] Create `eslint.config.js` with flat config (TypeScript recommended, Prettier compat, import sorting, Node.js and unicorn rules)
- [x] Create `.prettierrc` config file (use defaults)
- [x] Create `.prettierignore` file (dist, node_modules, etc.)
- [x] Install Husky and lint-staged (`husky`, `lint-staged`)
- [ ] Add lint-staged config to `package.json` (eslint --fix, prettier --write, tsc --noEmit)
- [ ] Update `package.json` scripts (update `lint`, add `lint:fix`, `format`, `format:check`)
- [ ] Initialize Husky and create `.husky/pre-commit` hook
- [ ] Update `buildImplementationPrompt` in `src/lib/opencode.ts` to reference specific lint/format/typecheck commands
- [ ] Update `buildLocalImplementationPrompt` in `src/lib/opencode.ts` with same updates
- [ ] Run linter and fix any existing issues in codebase
- [ ] Test pre-commit hook with a test commit

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
