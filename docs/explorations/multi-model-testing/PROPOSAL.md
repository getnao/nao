# Multi-model testing in the File Explorer, and dropping the Tests page

Exploration on `explore/testing-multi-model` (checkpoint of `feat/testing-draft-comparison` + its uncommitted WIP).
Screenshots: `screens/*.png`, built from `build.py` (`python3 -I build.py`, needs Google Chrome). They use the app's
light theme tokens from `apps/frontend/src/styles.css`.

## What the code already gives us

- **Runs already support several models.** `startRun` / `startComparisonRun` accept `models[]` (max 10,
  `MAX_TEST_RUN_MODELS`) and `buildAttemptJobs` interleaves test → model → attempt → variant. No UI passes `models`,
  so today the models come from `nao_config.yaml` `test.models`, else the default chat model.
- **Per-attempt metrics are stored** on `test_run_result`: `total_cost`, `total_tokens`, `duration_ms`,
  `tool_call_count`. Nothing aggregates them per model yet.
- **The CLI is ahead of the web UI.** `cli/nao_core/commands/test/summary.py` has `summarize_by_model` (pass rate,
  cost, tokens, avg tool calls, avg duration, pass@1 / pass@k / pass^k, ranked by pass rate then cost), and the
  `nao test` results server shows "Performance by Model" and a test × model matrix. The web UI should use the same
  definitions so the CLI and the app agree.

## Problems to fix along the way

1. **Verification uses the model under test.** `evaluateTestAttempt` → `runVerification(..., modelSelection)` asks
   the tested model to write the DuckDB verification query. In a benchmark, a weaker model can then fail because of
   the verification step, not because of its answer. For multi-model runs, verify with one fixed model (the project
   default) for every attempt. Its cost is not recorded today, which is fine: it should stay out of `$/question`.
2. **The latest outcome mixes models.** `listLatestCompletedOutcomes` sums every attempt of the latest run, so after
   a 3-model run a test says "7/9 passed" with no model. Group it by model (screen 6 shows one dot per model).
3. **Concurrency is 3 for the whole run** (`TEST_RUN_CONCURRENCY`), and only one run can be active per project.
   6 tests × 3 models × 3 attempts = 54 attempts, which run in about 18 waves. Providers rate-limit independently,
   so use a per-model limit, for example 3 per model.
4. **Comparison × models multiplies quickly**: tests × models × k × 2. Show the estimate before starting (screen 1).

## Workflow

1. In the drawer's tab row, a **model chip** sits next to Run (screen 1). It is a multi-select of the project's
   available models (`useModelSelection().availableModels`) with an attempts (k) stepper. Each model shows the
   average $/question and time from past runs, and the popover shows an estimate of attempts, cost and time.
   The default comes from `nao_config.yaml` `test.models` / `test.k`, and the choice is remembered per project in
   localStorage. **Save as project default** writes `test.models` and `test.k` to `nao_config.yaml` in the user's
   draft, so it shows up as a context change like any other edit.
   With one model the button reads "Run 6 tests" (same as today). With several it reads "Benchmark 6 tests".
2. **Multi-model run** (screen 2) shows a leaderboard first, then a test × model matrix with one dot per attempt.
   Filters: All / Models disagree / Failed. Clicking a cell opens that test's tab on that model. A maximize button
   on the drawer bar gives the leaderboard full height.
3. **Test tab** (screen 4) replaces the "model #n" attempt chips with a model strip that also works as a picker. The
   attempt header shows the time, tool calls, tokens and cost of that attempt. A new **Tool calls** tab lists the
   tool names in order, which explains a high tool-call count.
4. **Single-model runs show performance too** (screen 5): a stat strip with the change since the previous completed
   run of the same model, plus cost, tools and time for each test. Outliers are highlighted.

### Drawer layout: actions in the tab row

The toolbar line under the tabs goes away. Without context changes it only repeated the test count.

- The actions follow the shown tab, like VS Code's panel bar: on "All tests", the model chip and "Run 6 tests" (or
  "Benchmark" with several models). On a test tab, the model chip and "Run test". They sit on the right of the tab
  row, where the active run's progress already shows.
- They stay usable while the drawer is collapsed (screen 7). Starting a run opens the drawer on it. While a run is
  active, the button becomes Cancel.
- With context changes, a split button replaces the two buttons: "Compare with production", with "Run on production
  only" in its menu.
- A notice row only appears when it has something to say: the changed context files and draft warnings, a start
  error, or "Invalid test: …" on a test tab.
- Run filters (All / Failed / Models disagree / Fixed / Broken) and the Table / Chart toggle stay in the run view's
  own header row.

### Before / after chart (screens 3 and 4)

The CursorBench-style cost frontier fits nao best when every model is one arrow: from its production point (hollow
dot) to its "your changes" point (filled dot).

- y = accuracy (pass@1). x = average cost per question, reversed so that up and right is better. A toggle swaps the
  x axis for tokens, tool calls or time, always one axis at a time.
- Each arrow answers "did my context change make this model more accurate, and cheaper?" Up means more accurate,
  right means cheaper. Arrows pointing down flag regressions (gemini-3-pro in screen 3).
- Direct labels show the change (`+11 pts · −11% $`), and there is a legend plus a Table view. The hover tooltip
  shows both points, and clicking an arrow filters the tests to that model.
- In a test tab (screen 4), the same chart uses the attempts that pass (0/3 … 3/3) as its y axis, next to the model
  table.
- A benchmark on production has no "before", so the chart shows one dot per model: the plain cost frontier.
- Model colors are fixed per model across the drawer (picker, leaderboard, matrix, chart): blue, orange, violet,
  yellow, which pass the dataviz palette validator for color vision deficiency. Green and red stay reserved for
  pass / fail.

### Metric definitions (same as the CLI)

| Metric        | Definition                                                                       |
| ------------- | -------------------------------------------------------------------------------- |
| Accuracy      | passed attempts / attempts (pass@1)                                              |
| Reliable      | tests where all k attempts passed (pass^k). Hidden when k = 1                    |
| $/question    | Σ cost / attempts (agent only, without verification)                             |
| **$/correct** | Σ cost / passed attempts. The value metric: cheap but wrong models score badly   |
| Tools         | mean `tool_call_count`                                                           |
| Time          | median `duration_ms` (p90 in a tooltip), because one slow attempt skews the mean |
| Tokens        | mean `total_tokens`. Shown in the test tab, in a tooltip in the leaderboard      |

Ranking: accuracy, then $/correct (like `summarize_by_model`). Badges: **Most accurate** and **Best value** (lowest
$/correct). Best values are shown in green. When a model has fewer than about 10 attempts, show a "small sample"
hint so that a one-test difference is not read as a real gap. A model with no pricing shows `—` and never wins a
cost metric.

## Backend changes (none need a schema migration)

- `utils/test-model-summary.ts`: port `summarize_by_model` and pass^k. `getRun` returns `modelSummaries`
  (one row for single-model runs, which feeds the stat strip) and `previousSummaries` for the deltas.
  `listRuns` adds `modelCount` and the best model for the nav labels.
- `listTests.latestOutcomes` grouped by `llmModelId`.
- `startDraftRun` accepts `models` and `attempts`, like `startRun` and `startComparisonRun` already do.
- `estimateRun` query: per-model averages of cost and duration over the last N results (null when there is no
  history).
- A fixed verification model for multi-model runs, and a per-model concurrency limit.
- `details` jsonb gets `toolCalls: string[]` (names only) and `usage` (input / output / cache / reasoning split).
  Both are optional, so old rows still render.

## Removing the Tests page: recommended

Both pages use the same guard (`requireContextAdminOrAdmin`), and the drawer already covers most of what the page
does:

| Tests page feature                | Drawer today                   | Action                                                                       |
| --------------------------------- | ------------------------------ | ---------------------------------------------------------------------------- |
| Run all / compare with production | ✅                             | —                                                                            |
| Invalid files and settings errors | ✅                             | —                                                                            |
| Tag filter + run a selection      | ❌                             | Tag chip + row checkboxes (screen 6)                                         |
| Run history with author and cost  | partly (10 runs, no author)    | Author in the subtitle, "Show all runs…"                                     |
| Per-attempt results table         | ✅ better (grouped, data diff) | —                                                                            |
| `?run=` deep link                 | ❌                             | Add `run` to the context-explorer search params, and have it open the drawer |

To update:

- `hooks/use-replay-origin.ts`: "back" goes to `/settings/context-explorer?run=…`, and the label changes from Tests
  to File Explorer.
- "Open in Tests" links in `test-suite-panel.tsx` and `test-workbench.tsx`: remove them.
- `sidebar-settings-nav.tsx` (Tests entry), and `settings-search-index.ts`: point the entries to the File Explorer
  with the keywords tests, evaluation, benchmark, models.
- Keep `/settings/tests` as a redirect for old links.
- Delete: `_sidebar-layout.settings.tests.tsx`, `tests-table.tsx`, `test-runs-table.tsx`, `test-run-results.tsx`
  (first move `AttemptChatLink`, `DetailBlock` and `TestFileLink`), and the card part of `draft-comparison-card.tsx`
  and `test-comparison-results.tsx` (keep `DraftContextWarnings`, `ComparisonChangeBadge`, `ContextChangeItem` and
  `VariantOutcomeCell`, which the drawer uses).

Risk: tests become harder to find. The search index entry and the deep link make up for it.

## Suggested PRs

1. Per-model summary util + the stat strip and per-test metrics (screen 5). Backend aggregation only.
2. Model picker + leaderboard / matrix + model strip in the test tab + per-model latest outcomes + fixed
   verification model (screens 1–4, 7).
3. Remove the Tests page (screen 6: tag filter, selection, `?run=`, redirect).
4. Optional: tool names / token split in `details`, estimates, per-model concurrency.

## Open questions

- Verification model for benchmarks: a fixed model (recommended) or the tested model, as today?
- Allow comparison runs × several models in v1, or production only when several models are selected?
- Is "Save as project default" writing `nao_config.yaml` through the draft the right place for this?

## Implementation status

Done on `explore/testing-multi-model`:

- `ec2fd97c6` Per-model summaries in `getRun`, previous-run summaries, per-model run totals and latest outcomes,
  `getModelStats`, models and attempts for `startDraftRun`, a fixed verification model and per-model concurrency.
- `a05aa67f4` Drawer: actions in the tab row (also while collapsed), model picker with estimate, leaderboard and
  matrix, before / after chart for comparisons, stat strip, model strip in the test tab, tag filter and selection.
- `4994de161` Tests page removed: `/settings/tests?run=` redirects to the File Explorer with the run open.

Open questions, decided by default until reviewed:

- Verification model: the project default chat model verifies every attempt when several models run; a single model
  still verifies its own answers.
- Comparison × several models is allowed; the picker shows the attempt count and estimate before starting.
- "Save as project default" (writing `nao_config.yaml`) is not built: the picker remembers the choice per project
  in the browser, with a link back to the project defaults.

Not done yet: tool names and token split in `details` (the "Tool calls" tab), a chart view for production-only
benchmarks, and opening a matrix cell on its model.
