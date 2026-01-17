---
id: add-github-actions
title: Add GitHub Actions
status: in-progress
priority: high
created: 2026-01-17T00:00:00.000Z
updated: 2026-01-17T16:45:30.000Z
---

## Summary

Add a GitHub Actions CI workflow that runs build, typecheck, and lint checks on pushes to `main` and all pull requests, testing across multiple Node.js versions (18, 20, 22) with npm dependency caching.

## Tasks

- [x] Create `.github/workflows/` directory structure
- [ ] Create `ci.yml` workflow with trigger on `push` to `main` and `pull_request` events
- [ ] Configure Node.js version matrix (18, 20, 22)
- [ ] Add checkout step using `actions/checkout@v4`
- [ ] Add Node.js setup step using `actions/setup-node@v4` with npm caching enabled
- [ ] Add `npm ci` step to install dependencies
- [ ] Add `npm run build` step
- [ ] Add `npm run typecheck` step
- [ ] Add `npm run lint` step

## Files

- `.github/workflows/ci.yml` (new)

## Acceptance Criteria

- CI workflow runs automatically on pushes to `main`
- CI workflow runs automatically on all pull requests
- Workflow tests against Node.js 18, 20, and 22
- npm dependencies are cached between runs
- Build step executes successfully
- Typecheck step executes successfully
- Lint step executes successfully

## Definition of Done

When the CI workflow file exists at `.github/workflows/ci.yml` and successfully runs build, typecheck, and lint across all three Node.js versions on both push-to-main and PR events, with dependency caching enabled.
