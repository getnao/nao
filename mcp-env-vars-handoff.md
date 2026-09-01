# MCP Env Vars Handoff

This note explains the MCP environment variable fix in simple terms.

## The Problem

After `nao deploy`, nao Cloud shows required environment variables in the UI so admins can fill in secret values.

This already worked for variables in `nao_config.yaml`:

```yaml
password: "{{ env('DB_PASSWORD') }}"
```

But it did not work for variables that only appeared in `agent/mcps/mcp.json`:

```json
{
	"mcpServers": {
		"dbt": {
			"command": "npx",
			"env": {
				"DBT_TOKEN": "${DBT_TOKEN}"
			}
		}
	}
}
```

In that case, `DBT_TOKEN` did not appear in the UI, so users had no way to fill it in.

## The Simple Mental Model

There are two steps:

```text
Discovery: find which env vars the UI should show.
Runtime: replace placeholders with real values when the app runs.
```

The bug needed fixes in both places.

## Step 1: Discovery

The UI asks the backend:

```text
Which env vars does this project need?
```

The backend answers from `extractRequiredEnvVars` in:

```text
apps/backend/src/utils/nao-config.ts
```

Before the fix, this function only scanned:

```text
nao_config.yaml
```

It only understood placeholders like:

```text
{{ env('DB_PASSWORD') }}
```

Now it also scans:

```text
agent/mcps/mcp.json
```

and understands MCP placeholders like:

```text
${DBT_TOKEN}
```

So the UI can now show `DBT_TOKEN`.

## Step 2: Runtime

Showing the variable in the UI is not enough.

After the admin fills in `DBT_TOKEN`, the value is stored in the project database as:

```text
project.envVars
```

When MCP starts, nao reads:

```text
agent/mcps/mcp.json
```

Before the runtime fix, MCP only replaced `${DBT_TOKEN}` from:

```text
process.env
```

That means it only worked if the backend server itself already had `DBT_TOKEN` set.

Now MCP also reads the saved project env vars from the database and passes them into `replaceEnvVars`.

The flow is now:

```text
mcp.json has "${DBT_TOKEN}"
        ↓
UI shows DBT_TOKEN
        ↓
admin enters the real value
        ↓
value is saved in project.envVars
        ↓
MCP loads mcp.json
        ↓
"${DBT_TOKEN}" becomes the real value
        ↓
MCP server starts with the correct env var
```

## Files Changed

### `apps/backend/src/utils/nao-config.ts`

This is the discovery fix.

It now:

- Scans `nao_config.yaml` for `{{ env('VAR') }}`
- Scans `agent/mcps/mcp.json` for `${VAR}`
- Returns one combined list of required env vars

### `apps/backend/src/utils/utils.ts`

This is the replacement helper.

`replaceEnvVars` now accepts an optional `extraEnv` object:

```ts
replaceEnvVars(fileContent, extraEnv);
```

It resolves placeholders in this order:

```text
1. saved project env vars from the UI
2. process.env from the backend machine
3. the original placeholder if nothing is found
```

### `apps/backend/src/services/mcp.ts`

This is the runtime fix.

MCP now fetches saved env vars before parsing `mcp.json`:

```ts
const envVars = this._projectId ? await getEnvVars(this._projectId) : {};
const resolved = replaceEnvVars(fileContent, envVars);
```

### `apps/backend/tests/nao-config.test.ts`

Tests that MCP placeholders are discovered from `mcp.json`.

### `apps/backend/tests/utils.test.ts`

Tests that `replaceEnvVars` uses saved project env vars before `process.env`.

### `example/agent/mcps/mcp.json`

Adds a simple DBT-style example:

```json
"DBT_TOKEN": "${DBT_TOKEN}"
```

## How To Test

Run the focused tests:

```bash
npm run -w @nao/backend test -- tests/nao-config.test.ts tests/utils.test.ts
```

Run lint:

```bash
npm run lint
```

For a local UI check, run the app with the example project:

```bash
NAO_DEFAULT_PROJECT_PATH=/Users/thibault/nao/example npm run dev:backend
```

In another terminal:

```bash
npm run dev:frontend
```

Then open:

```text
Settings -> Project -> Environment Variables
```

You should see:

```text
METABASE_URL
METABASE_API_KEY
DBT_TOKEN
```

## Important Note

Seeing `DBT_TOKEN` in the UI proves discovery works.

Saving a value and having MCP use it proves runtime replacement works.

The example `dbt` MCP server is only a placeholder, so it is good for testing UI discovery. For a full runtime test, use a real MCP server that actually reads `DBT_TOKEN`.
