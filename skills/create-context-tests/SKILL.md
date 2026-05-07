---
name: create-context-tests
description: Generate a test suite of natural-language → SQL pairs that becomes the quality benchmark for a nao agent, then run it via `nao test`. Use when the user wants to start measuring agent reliability, extend an existing test suite, or add tests for new metrics. Tests are the only honest answer to "is the context working?". Do not use for writing rules (write-context-rules) or diagnosing failures (audit-context).
---

# create-context-tests

`nao test` runs each natural-language prompt through the agent, executes both the agent's SQL and the test's expected SQL against the warehouse, and **diffs the result data row-by-row**. A test passes only if the actual data matches — same rows, same values. The suite is the reliability benchmark; every change to `RULES.md` is measured against it. Reference: [docs.getnao.io/nao-agent/context-engineering/evaluation](https://docs.getnao.io/nao-agent/context-engineering/evaluation).

## How many tests

**One test per key metric in `## Key Metrics Reference`** is the floor. Then add tests for: time scoping (especially "last 8 weeks" / "last 30 days"), CTE / multi-step queries, edge cases (NULLs, empty windows), and ambiguous wording ("our users", "active") to validate naming-convention rules.

## Two authoring rules — apply to every test

**Rule 1 — Prompts read like real chat.** Vague, short, no table/column/method hints. The test verifies the agent reaches the right answer from a real-user input.

| Bad                                                       | Good                                |
| --------------------------------------------------------- | ----------------------------------- |
| "What was the churn rate from `fct_subscriptions` in Q1?" | "How's churn looking this quarter?" |
| "Compute MRR as SUM(`mrr_amount`) where status='active'"  | "What's our MRR?"                   |

**Rule 2 — Output column names encode format / unit, not source.** A column name communicates how to interpret the value.

| Bad                                 | Good                     |
| ----------------------------------- | ------------------------ |
| `churn_rate_from_fct_subscriptions` | `churn_rate_float_0_1`   |
| `mrr_amount_fct_stripe_mrr`         | `mrr_usd_dollars`        |
| `signup_at_dim_users`               | `signup_date_yyyy_mm_dd` |

Naming patterns: `<metric>_float_0_1` or `<metric>_percentage_0_100` for rates; `<metric>_<currency>_<unit>` for money; `<thing>_count`; `<thing>_date_yyyy_mm_dd`. See `templates/test.yaml`.

## Steps

1. **Ask once:** does the user have trusted source-of-truth queries (Looker, dashboards, prior benchmarks)? If yes, transform each into a test (rewrite SELECT to apply Rule 2; reverse-engineer a Rule 1 prompt). For metrics without a trusted query, draft new tests one per metric.

2. **Save flat under `tests/`** (no subfolders), one YAML file per test. Use `templates/test.yaml`.

3. **Have the user validate** — confirm prompts match their team's phrasing and SQL matches their definition of truth.

4. **Run `nao test`.** Prerequisites:
    - `cd` into the project directory (where `nao_config.yaml` lives).
    - Start `nao chat &` in the background (the test runner reuses the chat server).
    - LLM configured in `nao_config.yaml`.
    - First run prompts for login credentials — let the user type them; don't script around it.
    - If you see `AI_APICallError: Not Found` at `https://api.anthropic.com/messages` (no `/v1/`), run `unset ANTHROPIC_BASE_URL ANTHROPIC_API_KEY` first (parent agent CLI is leaking env vars). See `setup-context` for the full note.

    ```bash
    nao test -m <model_id> -t 10   # -t = parallelism
    ```

5. **Recap results:** pass rate, token cost, wall-clock time. Cite this as the baseline.

6. **Diagnose failures (optional):** read `tests/outputs/` for each failure, identify the rule gap, propose the smallest fix, then route to `write-context-rules` (or `audit-context` for systemic issues). Re-run between fixes so impact is attributable.

## Guardrails

- Tests' SQL must execute as-is — no `<placeholder>` in `FROM`. Use real table / column names.
- Never leak the answer in `prompt` or output column names (Rules 1 + 2).
- One test per metric is the floor; coverage tests come after.
- Apply one context fix at a time between runs.
- If a test contradicts `RULES.md`, stop and ask which is correct — it's a bug in one or the other.

## Templates

- `templates/test.yaml` — single-test format.
