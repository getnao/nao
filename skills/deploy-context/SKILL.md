---
name: deploy-context
description: Wire a nao project's context folder to a remote nao instance (Cloud or self-hosted) so every push to `main` automatically runs `nao deploy` via GitHub Actions. Use when the user has a working local nao project versioned in Git and wants their team's deployed instance to always reflect the latest committed context. Covers `nao deploy` usage, the GitHub Actions workflow, organization API keys, GitHub Secrets, `.naoignore`, environment-variable references in `nao_config.yaml`, and create-vs-update behavior. Do not use for first-time project setup (use `setup-context`) or for `nao sync` automation that commits warehouse metadata back to the repo (covered in the docs' synchronization page).
---

# deploy-context

`nao deploy` packages the local project as a `tar.gz` and uploads it to `<nao-url>/api/deploy`. The remote instance extracts the archive, reads `project_name` from `nao_config.yaml`, and either creates the project (first deploy) or **fully replaces** the existing project's context folder (subsequent deploys). There is no merge — every deploy is a full replacement.

Goal of this skill: make every push to `main` trigger that deploy automatically, with **zero secrets in the repo**.

Reference: [docs.getnao.io/nao-agent/cloud/deploy](https://docs.getnao.io/nao-agent/cloud/deploy).

## Prerequisites — confirm in one round

Ask all three at once:

1. **Remote instance URL** — `https://app.getnao.io/` (nao Cloud) or the self-hosted URL (e.g. `https://nao.your-company.com`). It must be reachable from GitHub-hosted runners.
2. **Project repo** — the GitHub repo that holds `nao_config.yaml` at its root (or at a known subpath). Confirm it is committed to `main` and pushed. Most of the time this is the repo in which the CI/CD (GitHub Actions) will run.
3. **Who creates the API key** — only an org admin can. If the user isn't, stop and ask them to get one from an admin before continuing.

## Step 1 — Create the organization API key

In the deployed nao instance:

1. Open **Settings → Organization → Organization API keys**.
2. Click **Generate API key**, name it after the repo (e.g. `gh-actions-<repo>`), copy the value. **It is shown only once** — if it scrolls off, revoke it and create a new one.
3. Each key is scoped to its organization and can deploy to every project in that org. Use one key per repo so revocations stay surgical.

**Never paste the key into chat, into the workflow file, or into `nao_config.yaml`.**

## Step 2 — Add GitHub Secrets

In the GitHub repo: **Settings → Secrets and variables → Actions → New repository secret**.

| Secret        | Value                               | Notes                                                            |
| ------------- | ----------------------------------- | ---------------------------------------------------------------- |
| `NAO_URL`     | `https://app.getnao.io/` (or yours) | Public, but keep as a secret/variable so it's swappable per env. |
| `NAO_API_KEY` | The key from Step 1                 | Required. Never print this in workflow logs.                     |

Optional, only if you want the workflow to also run `nao sync` before deploying (covered in Step 5 below):

- `GCP_SERVICE_ACCOUNT_KEY_JSON`, `SNOWFLAKE_PASSWORD`, `NOTION_API_KEY`, etc. — every env var referenced from `nao_config.yaml` via `{{ env('VAR_NAME') }}`.

## Step 3 — Lock down what gets uploaded

The deploy archive **always excludes**: `.git`, `.venv`, `.env`, `node_modules`, `__pycache__`, `repos`, `*.pyc`. The `repos` exclusion matters: synced clones of dbt / docs repos under `repos/` are rebuilt on the remote by `nao sync` and should not ship in the tarball.

Add a **`.naoignore`** at the project root for anything else that must never reach the remote — secrets files, large data dumps, local-only scratch:

```
# .naoignore
secrets.yaml
credentials/
*.parquet
*.csv
logs/
.DS_Store
```

One pattern per line. `#` for comments. Patterns match against path parts (any directory or file name). `*.<ext>` matches by suffix.

Audit `nao_config.yaml` before the first push: every credential must be `{{ env('VAR_NAME') }}`, never a literal. If you find a literal key, rotate it (assume it's compromised), replace with an env-var reference, and add the secret to GitHub.

## Step 4 — Add the GitHub Actions workflow

Create `.github/workflows/nao-deploy.yml`:

```yaml
name: nao deploy

on:
    push:
        branches: [main]
    workflow_dispatch:

concurrency:
    group: nao-deploy-${{ github.ref }}
    cancel-in-progress: false

jobs:
    deploy:
        runs-on: ubuntu-latest
        timeout-minutes: 10

        steps:
            - name: Checkout repository
              uses: actions/checkout@v4

            - name: Set up Python
              uses: actions/setup-python@v5
              with:
                  python-version: '3.13'

            - name: Install nao CLI
              run: |
                  pip install --upgrade pip
                  pip install nao-core

            - name: nao deploy
              env:
                  NAO_URL: ${{ secrets.NAO_URL }}
                  NAO_API_KEY: ${{ secrets.NAO_API_KEY }}
              run: nao deploy "$NAO_URL" --api-key "$NAO_API_KEY"
```

Why each piece:

- **`on.push.branches: [main]`** — every commit on `main` deploys. Add `workflow_dispatch` to allow manual re-deploys from the Actions tab without a new commit.
- **`concurrency` with `cancel-in-progress: false`** — serializes deploys per branch. Each deploy is a full replacement of the remote context folder; cancelling mid-upload is safe but interleaving two deploys is not.
- **`timeout-minutes: 10`** — guards against a hung upload. Bump if the project archive is large.
- **API key passed via env, not as a CLI literal** — keeps it out of the rendered command line in run logs.
- **No `set-x` / no `echo $NAO_API_KEY`** — GitHub masks registered secrets in logs, but only if the literal value is what hits the log. Don't print it yourself.
- **No `actions/cache` for the API key** — never cache anything that could contain the key.

Commit and push. The first run on `main` will create the project on the remote; subsequent runs update it.

## Step 5 — (Optional) Sync before deploy

If `nao_config.yaml` references env-var-backed credentials and the remote should always see the **freshest synced metadata**, run `nao sync` in the same job before `nao deploy`. Add the warehouse / notion / etc. secrets to GitHub Secrets first (per Step 2), then insert this step before `nao deploy`:

```yaml
- name: nao sync
  env:
      GCP_SERVICE_ACCOUNT_KEY_JSON: ${{ secrets.GCP_SERVICE_ACCOUNT_KEY_JSON }}
      # add any other secrets referenced by nao_config.yaml here
  run: nao sync
```

Trade-off: this couples deploy time to warehouse availability and adds minutes to every push. Most teams keep them separate — a scheduled `nao sync` workflow (see [docs — Synchronization](https://docs.getnao.io/nao-agent/context-builder/synchronization#github-actions)) commits metadata back to the repo, and the push it generates triggers this `nao deploy` workflow. That keeps the deploy job fast and the secret surface narrow.

If they live in the same job, never commit the synced output back from this workflow — that creates a push loop with the scheduled sync workflow.

## Step 6 — Verify end-to-end

1. Merge a tiny no-op change to `main` (or click **Run workflow** on the deploy workflow).
2. Watch the Actions run. The final step should print `Project <name> created` (first run) or `updated` (subsequent runs), plus a `Project ID`.
3. Open the deployed nao instance, navigate to the project, confirm:
    - The project exists with the right `project_name`.
    - Files under `databases/`, `semantics/`, `RULES.md`, etc. match what's on `main`.
    - Chat answers a known-good test question.

If the run fails, jump to the troubleshooting matrix below before changing anything.

## Troubleshooting

| Symptom in CI logs                                  | Cause                                               | Fix                                                                                                                   |
| --------------------------------------------------- | --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `Authentication failed. Check your API key.`        | Key revoked, wrong org, or wrong env var name.      | Recreate key in **Settings → Organization → API Keys**, update `NAO_API_KEY` secret.                                  |
| `No nao_config.yaml found in current directory`     | `nao_config.yaml` not at repo root.                 | Either move it to root, or pass `--path ./subdir` in the workflow's `nao deploy` step.                                |
| `nao_config.yaml is missing a 'project_name' field` | Missing `project_name`.                             | Add `project_name: <name>` at the top of the yaml. Pick the final name carefully — renaming forks the remote project. |
| `Could not connect to <url>`                        | URL wrong, instance down, or blocked from GitHub.   | Curl the URL from a runner-equivalent network. For self-hosted, allow GitHub's egress IPs.                            |
| Deploy "succeeds" but project on remote is empty    | `.naoignore` too aggressive, or context not synced. | Inspect the archive locally with `tar tzf` after running `nao deploy --path ...` once with logging.                   |
| Two deploys racing, second one wins unpredictably   | Two pushes within seconds; concurrency disabled.    | Keep `concurrency.cancel-in-progress: false` (default in Step 4). Don't change to `true`.                             |
| Secret value visible in logs                        | The workflow `echo`s it, or it's interpolated raw.  | Stop printing it. Pass via `env:` only. Rotate the key — once leaked in logs it's compromised.                        |

## Guardrails

- **Never commit secrets.** Every credential in `nao_config.yaml` must be `{{ env('VAR_NAME') }}` (warehouse, Notion, etc.) or `${VAR_NAME}` (LLM keys). Audit before first push.
- **Never paste the API key into chat.** Direct the user to copy it once from the UI and add it straight to GitHub Secrets.
- **One API key per repo / per environment.** Revocations stay surgical.
- **Use GitHub Environments for prod.** Approval gates + scoped secrets. Plain repo secrets are fine for a single staging deploy, not for production.
- **Don't widen the `on:` trigger.** `push: branches: [main]` only. Triggering on PRs from forks would expose the API key to forked code.
- **Don't add `pull_request` to the trigger** without `pull_request_target` + a contributor allowlist — and even then, prefer not to. A wrong PR can deploy bad context to prod.
- **`.naoignore` is not a security boundary.** Treat it as a courtesy filter. The real defense is "no secrets in the repo, ever."
- **Every deploy is a full replacement.** If the remote project has manual edits made through the UI / file explorer, they will be overwritten. Make Git the single source of truth before flipping the switch.
- **Don't deploy from feature branches.** One branch → one environment. Use separate workflows / environments for staging.
- **Pin actions to a major version** (`@v4`, `@v5`) as in the snippet above. Don't pin to `@main` of third-party actions.

## Recommend next steps

- No tests yet → `create-context-tests` so every deploy ships against a measured baseline.
- Multi-env (staging + prod) needed → duplicate the workflow with a different `environment:` and `NAO_URL` / `NAO_API_KEY` per env.
- Want metadata to refresh on a schedule, not on every push → add the scheduled `nao sync` workflow from [docs — Synchronization](https://docs.getnao.io/nao-agent/context-builder/synchronization#github-actions); its commit will trigger this deploy workflow.
