---
name: audit-context
description: Diagnose the health of a nao context at any stage of its lifecycle. Use when the user wants a structured review of what's been synced, how RULES.md compares to the target structure, whether every table is documented, whether the data model is MECE, whether tests exist and what their failures reveal, and whether context files are bloated. Outputs a structured audit report with ranked recommendations. Do not use for first-time setup (setup-context) or routine rule writing (write-context-rules).
---

# audit-context

Diagnose a nao context. Find gaps, MECE violations, failure root causes, and bloat. Output is a short in-conversation report ending in a prioritized plan. **Diagnose only — never fix.** Route fixes to `write-context-rules` / `add-semantic-layer` / `create-context-tests`.

Run any time: right after `setup-context`, mid-build, before a release, or when the agent's behavior gets surprising.

## Six checks (run in order)

### 1. Synced context

Read `nao_config.yaml`. What's wired in (warehouse, repos, Notion, semantic layer, MCPs)? What's **missing** (dbt repo, ETL configs, BI repo, internal docs)? Has `nao sync` run — are `databases/`, `repos/`, `docs/`, `semantics/` populated?

Scope check: **<100 tables** is the hard ceiling, **≤20** is the target. Better 12 well-documented tables than 80 half-documented ones. Flag oversized scope explicitly — it's the biggest predictor of reliability failure.

### 2. `RULES.md` vs target structure

Six standard sections (from `write-context-rules`): Business overview, Data architecture, Core data models (Most Used + Tables detail), Key Metrics Reference, Date filtering, Analysis Process. Per section, mark **present / missing / thin**. Flag placeholders, `TODO:` markers, and metric entries with no source-of-truth pointer.

### 3. Context coverage (per table)

For every table in `databases/`: is it in `## Most Used Tables`? Does it have a `## Tables detail` block? Is there dbt context (`repos/<dbt>/models/**/schema.yml`)? Any extra `.md`?

Then per-table gaps: undocumented columns the agent will reference, calculated fields with no explanation, foreign keys with no relation, common WHERE filters not mentioned anywhere. **A table with no docs anywhere is a high-priority finding.**

### 4. Data model consistency (MECE)

- **Mutually exclusive?** Two tables computing the same metric differently (worst issue — the agent picks one unpredictably).
- **Collectively exhaustive?** Asked metrics that no in-scope table can answer.
- **Duplicated columns?** Same logical field under different names (`user_id` / `customer_id` / `account_id`).
- **Ambiguous columns?** `amount` without unit, `status` without enum values.

### 5. Test coverage

If `tests/` is empty → recommend `create-context-tests`. Otherwise read `tests/outputs/` (most recent run) and categorize each failure:

| Category              | Looks like                       | Fix                                                        |
| --------------------- | -------------------------------- | ---------------------------------------------------------- |
| **Data model**        | Wrong column / wrong table       | Add column descriptions; clarify granularity               |
| **Date selection**    | Wrong period / week start        | Add DO/DON'T SQL in `## Date filtering`                    |
| **Test issue**        | Test SQL itself is wrong         | Fix the test, not the context                              |
| **Interpretation**    | Reasonable but different reading | Add to naming conventions or `## Key Metrics Reference`    |
| **Metric definition** | Wrong formula / source           | Tighten `## Key Metrics Reference` or add a semantic layer |

Propose the **smallest** rule change per failure. Sort by impact (tests affected).

### 6. Token optimization

- Files >40KB (flag).
- `## Tables detail` blocks exceeding the 10-column cap.
- Duplication between `RULES.md` and `databases/<table>.md`.
- In-scope tables with no mention in any test or recent question (trim candidates).
- Raw / staging tables that snuck into scope.

If `RULES.md` is bloated, suggest moving per-table detail to `databases/<table>.md` and keeping only the one-line pointer in `## Most Used Tables`. For multi-domain bloat, propose a per-domain file map referenced from `RULES.md`. Show the proposed structure before moving anything.

## Output (in conversation, not a file)

**Lead with a one-paragraph summary:** sync state | scope wideness (N tables vs ≤100 ceiling) | rules quality (N/6 sections substantive) | test coverage (N tests, X% passing).

**Then deep-dive only the sections with findings.** Skip clean ones. Format hints:

- Synced / RULES.md / token bloat → bulleted gaps.
- Context coverage → table: `Table | RULES.md | dbt docs | Extra .md | Gap`.
- MECE → bullets.
- Test failures → table: `Test | Category | Proposed fix`.

**End with a prioritized plan** (easiest-win → biggest-work), each item naming the skill that does the work:

```
## Plan
1. (easy / 5 min) ... → write-context-rules
2. (small / 30 min) ... → create-context-tests
3. (medium / 1-2 hr) ... → audit-context (rerun after)
4. (large / multi-session) ... → add-semantic-layer
```

## Guardrails

- **Apply one change at a time.** Re-run tests between fixes.
- **Tests are the source of truth.** If the user says "it's working," ask for the latest pass rate first.
- **Don't move or split files without confirmation.** Show the file map first.
- **Don't fix in this skill** — diagnose only.
