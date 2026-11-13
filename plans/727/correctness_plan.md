# Correctness Eval Plan (Plan B)

Reference-based correctness evals for nao chat answers, proposed for
[getnao/nao#727](https://github.com/getnao/nao/issues/727).

This plan is meant to be read side by side with the
[RAG triad plan](rag_triad_plan.MD). Both plans use the same three kwwhat EV charging
questions so their signals and implementation trade-offs are easier to compare.

---

## 1. Background and Problem

nao's SQL tests check deterministic answers and query correctness. They cannot catch
**context drift** in the final answer: the agent can return a numerically correct
result while ignoring configured context (`rules.md`, semantic definitions, framing,
or terminology).

As a nao user curating project context, I want to know when a context change makes the
agent hallucinate, use the wrong terminology, or ignore my configuration, even when
the SQL result is correct.

Plan B adds a **reference-based** check alongside existing SQL tests:

```text
input -> nao agent -> actual_output <-> expected_output -> Correctness judge
                                                        -> score / pass / reason
```

Exact numeric assertions remain in deterministic SQL tests. `nao evals` covers
semantic and context-related failures in the final answer.

---

## 2. Approach: Reference-Based Correctness

Plan B compares the final answer directly with a user-maintained `expected_output`
using DeepEval `GEval`.

The Correctness rubric checks that the answer:

- is factually consistent with the reference;
- contains the required facts, entities, values, and relationships;
- uses the required terminology and framing;
- does not add contradictions, unsupported claims, or misleading details.

**Assumption:** if the final answer matches the reference, the configured context was
probably good.

**Strength:** Correctness directly tests whether the user-visible result matches the
expected answer. It does not need tool-result or retrieval-context capture.

**Limitations:**

- It does not verify which context the agent used.
- It gives less insight into whether a failure came from irrelevant context,
  grounding, or answer relevance.
- It can penalize extra details because it cannot determine whether they are grounded
  in context that was not passed to the judge.
- Every case requires a reviewed and maintained `expected_output`.

---

## 3. Architecture: What Exists Today

`nao test` already runs the agent through the backend and returns the final answer:

- `POST /api/test/run` runs the agent non-streaming and returns
  `{ text, usage, cost, duration, tool_calls }`.
- `AgentClient` in `cli/nao_core/commands/test/client.py` already wraps the request,
  handles authentication, and returns a typed result.

Plan B reuses this path to obtain `actual_output` and run one Correctness metric.

---

## 4. Backend Changes: None

Plan B requires no new backend route and no changes to agent internals:

- no tool-result extraction or serialization;
- no content-bearing tool allowlist to maintain;
- no retrieval/context field in the response;
- no changes to existing SQL tests.

The runner sends each eval through the existing `POST /api/test/run` with an empty
`sql` field. An optional request timeout can be added to the existing client without
changing current `nao test` behavior.

This is the main implementation advantage of Plan B: the change is contained in the
CLI and user-owned eval data.

---

## 5. Directory Layout

```text
# nao_core package (framework, shipped with nao)
cli/nao_core/commands/evals/
  case.py          # dataset discovery and JSONL validation
  correctness.py   # Correctness rubric and judge resolution
  runner.py        # execution, reporting, CLI command

# User project (data, owned by the team)
{project}/tests/evals/
  golden_dataset.jsonl
{project}/tests/outputs/
  evals_results_<timestamp>.json
```

Eval cases live in the project alongside existing `tests/*.yml` SQL tests.

### Why validate the dataset before running

Current `nao test` discovery does not perform a separate schema-validation pass; a
malformed YAML test fails when it is parsed. Plan B proposes preflight validation
because eval runs invoke paid agent and judge calls. `case.py` validates every JSONL
row, required field, and duplicate ID before the first model call, then reports all
file/line errors together. This prevents a malformed later row from wasting an
otherwise valid partial run.

---

## 6. Golden Dataset

Plan B uses the same IDs and questions as the RAG triad plan, adding only the
`expected_output` required by Correctness:

```jsonl
{"id": "q001", "input": "How many ports are currently decommissioned?", "expected_output": "There are currently 4 decommissioned ports."}
{"id": "q002", "input": "What is the overall uptime percentage of my EV charging network for the full history?", "expected_output": "The overall uptime is 99.71% for the full available history."}
{"id": "q003", "input": "What is the charge point availability index?", "expected_output": "The metric \"charge point availability index\" is not defined in the semantic model. The closest available metric is uptime. Would you like that instead?"}
```

Dataset quality is part of the eval design. Reference answers should be reviewed and
versioned like code; vague or stale references make the score unreliable.

---

## 7. Eval Flow

```text
for each record in golden_dataset.jsonl:
  1. AgentClient.run_test(input, sql="", model, timeout)
       -> actual_output + usage metadata
  2. LLMTestCase(actual_output, expected_output)
  3. GEval(Correctness).measure(test_case)
       -> score / pass / reason
  4. collect result

after all records:
  5. write evals_results_<timestamp>.json
  6. exit non-zero if any case failed or errored
```

Errors are separated from answer-quality failures:

- agent timeout -> `error_type: "timeout"`; judge is not called;
- backend error -> `error_type: "backend_error"`; judge is not called;
- judge error -> `error_type: "metric_error"`;
- completed judge result below threshold -> normal eval failure.

---

## 8. Correctness Metric

The metric is a DeepEval `GEval` instance named `Correctness`.

```python
correctness_metric = GEval(
    name="Correctness",
    evaluation_steps=[
        "Compare the actual output directly with the expected output for factual accuracy.",
        "Verify that every required fact, entity, value, and relationship is present and correctly represented.",
        "Verify that the required naming, terminology, and framing are used.",
        "Penalize contradictions, unsupported additions, and misleading details.",
    ],
    evaluation_params=[
        SingleTurnParams.ACTUAL_OUTPUT,
        SingleTurnParams.EXPECTED_OUTPUT,
    ],
)
```

Plan B supplies explicit `evaluation_steps` instead of asking DeepEval to generate
them from broad `criteria` on each run. This makes the project-specific definition of
Correctness visible, reviewable, and stable; changes to the steps can be versioned
like other test logic.

`INPUT` and retrieval/context fields are intentionally excluded. This is a
reference-based result check, not a grounding check.

### Threshold

The initial threshold is `0.5`. It must be calibrated through repeated runs and human
review before it becomes a blocking gate.

### Judge Model

`--judge-model` selects the model used by DeepEval. It may be the same as the chat
model or an independent judge. Using the same model introduces self-evaluation bias,
so the runner should keep these model choices separate.

---

## 9. Runner Components

- **`case.py`**
  - parse and validate `id`, `input`, and `expected_output`;
  - reject duplicate IDs and report row-level errors.
- **`correctness.py`**
  - define the Correctness evaluation steps;
  - build `LLMTestCase` and `GEval`;
  - resolve the requested judge model.
- **`runner.py`**
  - discover and filter cases;
  - run the agent once per case;
  - handle timeout/backend/judge errors;
  - save score, pass/fail, and reason;
  - return a non-zero exit code when any case fails.

The initial implementation uses one default Correctness rubric. `correctness.py`
owns rubric construction and selection so the runner does not need question-type
conditionals if reviewed cases later justify more than one rubric.

DeepEval should be imported lazily so normal nao commands do not require it at module
load time. Whether it is a core dependency or an optional `nao-core[evals]` extra is a
maintainer decision.

---

## 10. Running the Evals

```bash
# All cases
nao evals \
  -m anthropic:claude-sonnet-4-6 \
  --judge-model anthropic:claude-sonnet-4-6 \
  --timeout 300

# One case
nao evals \
  -s q001 \
  -m anthropic:claude-sonnet-4-6 \
  --judge-model anthropic:claude-sonnet-4-6 \
  --timeout 120
```

Relevant parameters:

- `-m`, `--model`: chat model being evaluated (`provider:model_id`);
- `--judge-model`: DeepEval judge model (`provider:model_id`);
- `--timeout`: maximum seconds for each agent request;
- `-s`, `--select`: eval ID filter;
- `--threshold`: minimum Correctness score required to pass.

The proposed report stores `input`, `actual_output`, `expected_output`, score,
threshold, pass/fail, reason, `judge_model`, `rubric_version`, `deepeval_version`, usage
metadata, and any error type. Recording the judge, rubric, and framework versions
prevents scores produced by different evaluation configurations from being treated as
directly comparable. Judge usage should be reported separately when the selected
DeepEval adapter exposes it.

`rubric_version` is a short content hash of the nao-owned rubric profile, evaluation
steps, and parameters. `deepeval_version` records the framework version separately
because its internal scoring behavior may change without changing nao's rubric.

---

## 11. Example Outputs on the Shared RAG Cases

The following dry run uses the same `q001`-`q003` questions as the RAG plan:

- chat model: `anthropic:claude-sonnet-4-6`;
- judge model: `claude-sonnet-4-6`;
- Correctness threshold: `0.5`.

### q001: Decommissioned Ports

**Input**

> How many ports are currently decommissioned?

**Expected output**

> There are currently 4 decommissioned ports.

**Actual output**

```text
There are currently <citation-number id="query_ff4f05a4" column="decommissioned_ports">4</citation-number> ports that have been decommissioned (i.e., have a non-null `decommissioned_ts`).
```

**Correctness:** `0.90`, pass.

The count matches. The citation markup and schema explanation do not contradict the
reference.

### q002: Full-History Uptime

**Input**

> What is the overall uptime percentage of my EV charging network for the full
> history?

**Expected output**

> The overall uptime is 99.71% for the full available history.

**Actual output**

```text
Your EV charging network has an **overall uptime of <citation-number id="query_9e9a8fad" column="overall_uptime_pct">99.7</citation-number>%** across its full history.

Here's the context behind that figure:

| Metric | Value |
|---|---|
| Overall Uptime | **99.7%** |
| Period | Oct 1, 2025 – Jul 2, 2026 |
| Charge Points | 2 |
| Ports Monitored | 2 |
| Port-Day Records | 578 |

**Methodology:** Uptime is calculated as *(commissioned minutes − outage minutes) / commissioned minutes* per port per day, then averaged across all port-days — consistent with the `fact_uptime` semantic model definition. Only OFFLINE-type outages are currently tracked in the downtime data.
```

**Correctness:** `0.70`, pass.

The judge treated `99.7%` as a rounded form of the expected `99.71%`. However, this
run used a later data snapshot than the RAG example, so the difference may also show
reference staleness rather than answer error. The first attempt exceeded a 120-second
request timeout; the completed retry used a 300-second limit. The timeout is an
execution issue, not a metric failure.

### q003: Undefined Availability Index

**Input**

> What is the charge point availability index?

**Expected output**

> The metric "charge point availability index" is not defined in the semantic model.
> The closest available metric is uptime. Would you like that instead?

**Actual output**

```text
The metric **"charge point availability index"** is not defined in the semantic model. The closest defined metric is **`uptime`** — which measures the average fraction of commissioned time that charge points were not in an outage (i.e., availability at the port level).

Here's what is defined and relevant:

| Metric | Definition |
|---|---|
| **uptime** | Average port uptime = (commissioned minutes − outage minutes) / commissioned minutes. Ranges from 0 to 1 (0% = fully down, 100% = fully up). Sourced from `fact_uptime`. |

There is no metric explicitly named "charge point availability index" in the semantic model. If you're looking for something specific — such as the percentage of charge points that were available (not faulted/unavailable) at a point in time, or a composite index — that metric would need to be defined or derived.

Would you like me to:
1. **Report on uptime** (the closest existing availability metric) for the last 7 days?
2. **Build a custom availability index** based on `dim_ports` latest statuses or downtime data?
```

**Correctness:** `0.70`, pass.

The core refusal, terminology, and uptime redirect match the reference. The score is
reduced because the response adds substantial explanation and extra follow-up options.

### Comparison with the RAG Triad Plan

| Case | RAG triad result | Correctness result | Difference in signal |
|---|---|---|---|
| `q001` | Pass: Faithfulness `1.0`, Contextual Relevancy `0.8333`, Answer Relevancy `1.0` | Pass: `0.90` | Both approaches accept the answer. The triad describes the context-to-answer path; Correctness confirms the expected count. |
| `q002` | Pass: Faithfulness `0.8889`, Contextual Relevancy `0.507`, Answer Relevancy `0.8182` | Pass: `0.70` | The triad surfaces context dilution; Correctness surfaces a reference mismatch that may be rounding or reference staleness. |
| `q003` | Fail: Faithfulness `1.0`, Contextual Relevancy `0.0`, Answer Relevancy `0.5714` | Pass: `0.70` | The triad rejects the context/relevance path, while Correctness accepts that the final answer follows the expected refusal and uptime redirect. |

These are **illustrative**, not controlled A/B results. The plans use the same
questions, model family, and project, but the agent generated a separate response for
each run and `q002` used a later data snapshot. A controlled comparison would apply
both metric strategies to the same saved agent response and data snapshot.

The key design trade-off is visible in `q003`: the RAG triad provides context-path
diagnostics, while Correctness directly checks the required user-visible behavior.

---

## 12. CI

LLM evals should not block every PR by default because they are slower,
non-deterministic, and cost money. The runner should remain CI-friendly through a
non-zero exit code, while teams choose whether to run it manually, on a schedule, or
as a calibrated gate.

---

## 13. Proposed Implementation Sequence

1. Add `case.py`, `correctness.py`, and `runner.py` under
   `cli/nao_core/commands/evals/`.
2. Register `nao evals` without changing existing `nao test` behavior.
3. Reuse `AgentClient` and add an optional backward-compatible request timeout.
4. Add lazy DeepEval imports and decide whether eval dependencies are core or
   optional.
5. Validate JSONL cases and write stable JSON results with score, pass/fail, reason,
   judge model, rubric version, DeepEval version, and error type.
6. Add focused tests for dataset validation, selection, timeout/backend errors,
   metric failures, and exit codes.
7. Calibrate the rubric and threshold on reviewed project cases before enabling any
   blocking CI gate.

### Possible later extension: rubric profiles

The initial implementation keeps one default rubric. If observed cases later require
different criteria, the dataset can add an optional `rubric_profile`, for example:

```jsonl
{"id":"q002","input":"What is the overall uptime?","expected_output":"The overall uptime is 99.71%.","rubric_profile":"reported_value"}
{"id":"q003","input":"What is the charge point availability index?","expected_output":"The metric is not defined; offer uptime instead.","rubric_profile":"semantic"}
```

The corresponding metrics would differ in their evaluation steps:

```python
reported_value_correctness = GEval(
    name="Reported Value Correctness",
    evaluation_steps=[
        "Compare every reported numeric value with the expected output.",
        "Require the expected precision and penalize contradictory values.",
    ],
    evaluation_params=[
        SingleTurnParams.ACTUAL_OUTPUT,
        SingleTurnParams.EXPECTED_OUTPUT,
    ],
)

semantic_correctness = GEval(
    name="Semantic Correctness",
    evaluation_steps=[
        "Verify that the answer preserves the expected intent, terminology, and framing.",
        "Allow equivalent wording; penalize contradictions and unsupported additions.",
    ],
    evaluation_params=[
        SingleTurnParams.ACTUAL_OUTPUT,
        SingleTurnParams.EXPECTED_OUTPUT,
    ],
)
```

`correctness.py` would select the metric from `rubric_profile`; dataset loading and
runner orchestration would remain unchanged. Each result would record the selected
profile, rubric version, and DeepEval version. This extension should be driven by
calibrated cases rather than added upfront.

The reported-value profile would check whether the final answer preserves a verified
number and its required precision. Deterministic SQL tests remain the factual source
of truth and are not replaced by this semantic check.

After the eval schema is approved, a `create-evals` skill could generate and validate
Plan B golden records (`id`, `input`, and `expected_output`), similar to
`create-context-tests`. I can contribute this follow-up if useful.
