# Kubik review

Reviewed on September 16, 2026.

Kubik found 10 findings (3 blocking).

## Findings

### 1. High — Arbitrary URL can receive the Metabase API key

- **Location:** `cli/nao_core/commands/metabase.py:273-285, 312-320, 553-560`
- **Evidence:** URL inputs control the request host, which then receives `METABASE_API_KEY`.
- **Impact:** A malicious dashboard URL can exfiltrate credentials.
- **Recommendation:** Require URL origins to match normalized `METABASE_URL`.
- **Confidence:** High

### 2. High — In-app MBQL migration cannot obtain SQL

- **Location:** `apps/backend/src/agents/skills/metabase-dashboard.skill.ts:17-28`, `apps/backend/src/agents/tools/metabase-dashboard-metadata.ts:289-319`
- **Evidence:** Metadata returns SQL only for native questions. The skill expects `execute_question` to return compiled SQL, but that tool returns rows and metadata.
- **Impact:** Normal Metabase query-builder cards cannot be migrated.
- **Recommendation:** Add an authorized SQL-compilation endpoint or explicitly mark MBQL unsupported.
- **Confidence:** High

### 3. High — Filtered placements share the first compiled query

- **Location:** `cli/nao_core/commands/metabase.py:403-439, 640-727`
- **Evidence:** Compilation is deduplicated and stored only by question ID, despite placements having different filter mappings.
- **Impact:** Repeated cards may use another placement's SQL or parameter bindings.
- **Recommendation:** Key compiled queries by question ID plus canonical filter context.
- **Confidence:** High

### 4. Medium — Parameter overrides can be silently ignored

- **Location:** `cli/nao_core/commands/metabase.py:151-165, 412-419, 511-543`
- **Evidence:** Unknown IDs are never reported, and native questions bypass parameter processing entirely.
- **Impact:** A typo or native question can appear successful while using unintended defaults or unresolved SQL.
- **Recommendation:** Track consumed overrides and reject or report every unmatched value.
- **Confidence:** High

### 5. Medium — Premature empty collection pages report success

- **Location:** `cli/nao_core/commands/metabase.py:390-400`
- **Evidence:** An empty page returns immediately even when `offset < total`.
- **Impact:** Dashboards can be silently omitted from a collection import.
- **Recommendation:** Treat an early empty page as a pagination error.
- **Confidence:** High

### 6. Medium — Collection discovery failures produce no batch manifest

- **Location:** `cli/nao_core/commands/metabase.py:102-120`, `skills/import-metabase-dashboard/SKILL.md:44`
- **Evidence:** Discovery exceptions jump directly to `UI.error`, despite the documented every-command batch contract.
- **Impact:** JSON consumers receive no structured failure for inaccessible collections.
- **Recommendation:** Emit an empty batch containing the collection failure before exiting.
- **Confidence:** High

### 7. Medium — Trailing slash breaks generated MCP configuration

- **Location:** `cli/nao_core/config/mcp/template.py:4-11`, `apps/backend/src/agents/tools/metabase-dashboard-metadata.ts:171-200`
- **Evidence:** A trailing slash creates `//api/metabase-mcp`; URL comparison preserves that duplicate slash.
- **Impact:** A valid Metabase URL can fail server authorization checks.
- **Recommendation:** Trim trailing slashes before appending the MCP path.
- **Confidence:** High

### 8. Medium — Gauge formatting is discarded

- **Location:** `apps/shared/src/chart-builder.tsx:390-449`
- **Evidence:** Values and boundaries always use plain numeric formatting, ignoring `series.value_format`.
- **Impact:** Currency, percentage, unit, and precision formatting is lost.
- **Recommendation:** Apply the existing series value formatter to values and boundaries.
- **Confidence:** High

### 9. Low — Generic chart schema accepts malformed gauges

- **Location:** `apps/shared/src/tools/display-chart.ts:159-252, 373-376`
- **Evidence:** `ChartInputSchema` and the first `BuiltinChartInput` union arm accept gauge charts without required segments or exactly one series.
- **Impact:** Callers bypassing `InputSchema` can construct invalid gauges.
- **Recommendation:** Exclude `gauge` from the generic chart type.
- **Confidence:** High

### 10. Low — Metabase skill is outside the README table

- **Location:** `skills/README.md:20-22`
- **Evidence:** A blank line terminates the Markdown table before the new row.
- **Impact:** The skill index renders incorrectly.
- **Recommendation:** Move the row directly above the blank line.
- **Confidence:** High

## Checks run

- `npm run lint`: passed.
- Focused backend tests: 47 passed.
- Focused CLI tests: 57 passed.
- CLI lint and `git diff --check`: passed.
- Shared tests: 555 passed, with one pre-existing axis-width failure.
- Full backend and CLI suites were limited by unavailable native SQLite/Bun and ODBC dependencies.

## Residual risks

No authenticated, live Metabase import was executed.

## Change summary

The overall import architecture is reasonable, but credential routing, MBQL support, and filter-context identity should block merge.
