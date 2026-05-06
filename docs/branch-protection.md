# Branch protection setup

One-time GitHub configuration so the laptop can't push broken code directly to
`main`, while the Mac mini's scheduler can still push data commits.

## What's already in the repo

- `.github/workflows/build.yml` — runs `npm run build` on every PR and on every
  push to `main`. This is the CI check that branch protection will require.
- `.githooks/pre-push` — local guard that runs `npm run build` before any push
  that touches code (skips data-only pushes from the Mac mini).
  Activate per clone with: `git config core.hooksPath .githooks`

## Configure on GitHub (browser)

1. Open https://github.com/btheis15/stock-game/settings/branches
2. Click **Add branch protection rule**
3. Branch name pattern: `main`
4. Enable:
   - **Require a pull request before merging**
     - Require approvals: not needed for solo
   - **Require status checks to pass before merging**
     - Require branches to be up to date before merging: yes
     - Status checks: select `build` (it'll appear after the workflow has run at
       least once)
   - **Do not allow bypassing the above settings**
     - Then add `btheis15` to the bypass list (so the Mac mini's scheduler — which
       authenticates as you — can still push data commits to main)
5. Save

## Day-to-day from the laptop

```bash
git checkout -b feat/something
# … edit, save, commit …
git push -u origin feat/something    # pre-push hook runs npm run build
gh pr create                          # or open in the GitHub UI
# Vercel auto-creates a preview deploy. Inspect it.
# When CI is green and preview looks right, merge the PR.
# The webhook deploys main to production.
```

## Day-to-day on the Mac mini

Don't push code from here. The scheduler will keep doing its thing:

- Pulls `origin/main` (rebases) before each refresh
- Commits only `public/data/prices.json`
- Pushes to main; pre-push hook detects data-only and skips the build for speed
- Webhook redeploys

To pause the schedule cleanly without closing the UI:

```bash
touch scripts/.pause   # halts
rm scripts/.pause      # resumes
```

## If you ever disconnect the GitHub→Vercel webhook

Re-add `vercel deploy --prod --yes` to the end of `scripts/cron-update.sh` and
the Mac mini will deploy directly again. The current setup relies on the
webhook so the Mac mini doesn't need Vercel CLI auth maintained.
