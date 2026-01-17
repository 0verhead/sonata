---
id: rename-notion-code-to-sonata
title: Rename notion-code to sonata
status: done
priority: high
created: 2026-01-17T00:00:00.000Z
updated: 2026-01-17T21:00:00.000Z
---

## Summary
Rename the project from "notion-code" to "sonata" across all source files, configuration, documentation, and user-facing text. This is a clean break with no backward compatibility or migration support.

## Steps
- [x] Step 1: Update `package.json` - change package name and bin entry to "sonata"
- [x] Step 2: Update `src/index.ts` - change CLI program name and description
- [x] Step 3: Update config paths in `src/lib/config.ts`, `src/lib/session.ts`, and `src/lib/opencode.ts` to use `.sonata` directories
- [x] Step 4: Update all command files (`setup.ts`, `status.ts`, `run.ts`, `loop.ts`, `plan.ts`) - change intro banners, help text, and command examples to use "sonata"
- [x] Step 5: Update remaining lib files (`mode.ts`, `git.ts`, `progress.ts`) and `src/types/index.ts` - change error messages, PR title default, comments, and JSDoc
- [x] Step 6: Update `templates/PROMPT.md` - change documentation reference
- [x] Step 7: Update `README.md` - change all ~48 references including title, architecture diagram, config paths, git URL (`git@github.com:0verhead/sonata.git`), and command examples
- [x] Step 8: Delete `specs/local-mode-feature.md`
- [x] Step 9: Run `npm install` to regenerate `package-lock.json`, build, and verify CLI works with `sonata` command

## Files

**To Modify:**
- `package.json`
- `src/index.ts`
- `src/lib/config.ts`
- `src/lib/session.ts`
- `src/lib/opencode.ts`
- `src/lib/mode.ts`
- `src/lib/git.ts`
- `src/lib/progress.ts`
- `src/types/index.ts`
- `src/commands/setup.ts`
- `src/commands/status.ts`
- `src/commands/run.ts`
- `src/commands/loop.ts`
- `src/commands/plan.ts`
- `templates/PROMPT.md`
- `README.md`

**To Delete:**
- `specs/local-mode-feature.md`

**Auto-regenerated:**
- `package-lock.json`

## Acceptance Criteria
- `sonata --help` displays CLI with "sonata" branding
- All CLI commands work: `sonata setup`, `sonata plan`, `sonata run`, `sonata loop`, `sonata status`
- All CLI banners display "sonata" (e.g., ` sonata setup `, ` sonata run --local `)
- Config directories are `~/.sonata/` and `.sonata/`
- README reflects new git URL: `git@github.com:0verhead/sonata.git`
- No remaining references to "notion-code" in source code or documentation
- Project builds successfully

## Definition of Done
All files updated, `grep -r "notion-code" . --include="*.ts" --include="*.md" --include="*.json" | grep -v node_modules | grep -v ".git"` returns no results, and the CLI runs successfully as `sonata`.