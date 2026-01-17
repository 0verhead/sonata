---
id: make-setting-model-easier
title: Make settings the used model in opencode easier
status: done
priority: high
created: 2026-01-17T14:30:00Z
updated: 2026-01-17T19:00:00.000Z
---

## Summary

Add a `sonata model` command to easily view, search, and set the default AI model and reasoning effort for a project, writing to `opencode.json` without manual file editing.

## Tasks

- [x] Add `@inquirer/search` dependency to `package.json`
- [x] Extend `OpenCodeConfigSchema` in `src/lib/opencode-config.ts` to include `model` and `reasoningEffort` fields
- [x] Add helper functions `getModel()`, `setModel()`, `getReasoningEffort()`, `setReasoningEffort()` in `opencode-config.ts`
- [x] Add helper function `getAvailableModels()` that calls `opencode models` and parses output
- [x] Create `src/commands/model.ts` with the `modelCommand` function
- [x] Implement `sonata model` (no args) - show current model and reasoning effort
- [x] Implement `sonata model list [provider]` - list available models (optionally filtered by provider)
- [x] Implement `sonata model set <model>` - set model directly via CLI arg
- [x] Implement `sonata model set` (interactive) - use `@inquirer/search` for searchable model picker
- [x] Implement `--effort <level>` flag (low/medium/high/xhigh) to set reasoning effort
- [x] Register the command in `src/index.ts`

## Files

- package.json
- src/index.ts
- src/lib/opencode-config.ts
- src/commands/model.ts (new file)

## Acceptance Criteria

- `sonata model` displays current model and reasoning effort from `opencode.json`
- `sonata model list` displays all available models from `opencode models`
- `sonata model set <model>` updates `opencode.json` with the specified model
- `sonata model set` (no arg) opens interactive searchable picker using `@inquirer/search`
- `--effort` flag sets `reasoningEffort` in the config
- Invalid model names show helpful error with suggestions
- Creates `opencode.json` with `$schema` if it doesn't exist

## Definition of Done

When users can search and set their model with `sonata model set`, optionally with `--effort`, and the change persists correctly in `opencode.json`.
