# CI status: temporarily disabled

**Effective date:** 2026-10-19  
**Status:** Automatic GitHub Actions CI is paused until the repository owner explicitly requests reactivation.

## What changed

- The active GitHub Actions workflow `.github/workflows/ci.yml` has been removed from `main`.
- Its former contents are retained at `docs/ci-workflow.yml.disabled` for restoration.
- There is no automatic `push` or `pull_request` build/test workflow from this project configuration.
- Disabling CI does **not** remove project scripts or change acceptance criteria. Existing historical workflow runs, if any, may remain visible in GitHub Actions.
- This repository change does not toggle repository-wide GitHub Actions settings, nor disable workflows added separately in the future.

## Local verification (required during the pause)

After `npm install` (or `npm ci` when a lockfile is present), run:

```bash
npm run typecheck
npm test
npm run build
```

Record outcomes in the relevant pull request or development summary. Do not claim the checks passed unless actually run. If the environment cannot run them, record `not verified` and why.

## How to re-enable CI (only after owner authorization)

```bash
git mv docs/ci-workflow.yml.disabled .github/workflows/ci.yml
git add README.md AGENTS.md docs/ROADMAP.md docs/CI.md
git commit -m "chore(ci): restore GitHub Actions CI"
git push
```

Update CI status references in the docs in the same change. Restoration of the archived file reinstates the original `push`/`pull_request` triggers; review dependencies and Actions permissions before enabling it.

## Scope and reasoning

This is a temporary pause of **automatic remote validation**, not a decision to stop writing tests. Developers and coding agents must continue to run local verification before claiming milestones complete.
