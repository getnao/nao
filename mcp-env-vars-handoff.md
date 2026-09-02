# MCP Environment Variables: Issue And Fix

This document explains the MCP environment variable issue and the fix in beginner-friendly terms.

The goal is to help you come back to this tomorrow and understand:

- What the bug was
- Why it happened
- Which files are involved
- What we changed
- How to test it

## 1. The Feature In Plain English

`nao deploy` copies a nao project to nao Cloud.

Some projects need secret values, such as:

- database passwords
- API keys
- access tokens
- MCP server tokens

Those secrets should not be committed to git. Instead, the project config contains placeholders.

For example:

```text
I need a secret called DBT_TOKEN, but I do not want to write the real value in the file.
```

So the config file contains this:

```json
"DBT_TOKEN": "${DBT_TOKEN}"
```

Then nao Cloud should:

1. Detect that the project needs `DBT_TOKEN`.
2. Show `DBT_TOKEN` in the settings UI.
3. Let an admin enter the real value.
4. Save that value.
5. Use that value when starting the MCP server.

## 2. The Two Config Files

There are two important config files for this issue.

### `nao_config.yaml`

This is the main nao project config.

It already supported env placeholders like this:

```yaml
password: "{{ env('DB_PASSWORD') }}"
```

Before this fix, nao Cloud knew how to discover this variable and show it in the UI.

### `agent/mcps/mcp.json`

This is the MCP config file.

It can contain MCP servers and their environment variables.

Example:

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

Before this fix, nao Cloud did not discover `DBT_TOKEN` if it only appeared in `mcp.json`.

## 3. The Original Bug

The user had this in `agent/mcps/mcp.json`:

```json
"DBT_TOKEN": "${DBT_TOKEN}"
```

But `DBT_TOKEN` did not appear in the Cloud UI.

That meant:

```text
The user could not enter DBT_TOKEN.
The value was never saved.
The MCP server started with the literal string "${DBT_TOKEN}".
The MCP server failed.
```

## 4. The Most Important Concept

There are two separate steps.

```text
Discovery: figure out which env vars the UI should show.
Runtime: replace placeholders with real values when the app runs.
```

This issue needed both steps fixed.

## 5. Step One: Discovery

Discovery answers this question:

```text
Which env vars does this project require?
```

The UI does not let users create arbitrary env var names.

Instead, the UI asks the backend:

```text
What env vars should I show?
```

That backend logic lives in:

```text
apps/backend/src/utils/nao-config.ts
```

The function is:

```ts
extractRequiredEnvVars(projectFolder)
```

Before the fix, it only looked at:

```text
nao_config.yaml
```

and only understood placeholders like:

```text
{{ env('DB_PASSWORD') }}
```

So it completely ignored:

```text
agent/mcps/mcp.json
```

and did not understand:

```text
${DBT_TOKEN}
```

### What Changed

`extractRequiredEnvVars` now scans both files:

```text
nao_config.yaml
agent/mcps/mcp.json
```

It uses one pattern for `nao_config.yaml`:

```ts
const NAO_CONFIG_ENV_PATTERN = /\$?\{\{\s*env\(['"]([^'"]+)['"]\)\s*\}\}/g;
```

This finds values like:

```text
{{ env('DB_PASSWORD') }}
${{ env('DB_PASSWORD') }}
```

It uses another pattern for `mcp.json`:

```ts
const MCP_CONFIG_ENV_PATTERN = /\$\{(\w+)\}/g;
```

This finds values like:

```text
${DBT_TOKEN}
${METABASE_API_KEY}
```

The function puts everything into a `Set`.

A `Set` is useful because it automatically removes duplicates.

So if both files mention `DBT_TOKEN`, the UI still only shows it once.

## 6. Step Two: Saving Values To The DB

Once the UI knows about `DBT_TOKEN`, the user can enter a real value.

That happens in:

```text
apps/frontend/src/components/settings/env-vars-section.tsx
```

When the user clicks save, the frontend sends an object like this:

```ts
{
  DBT_TOKEN: "real-secret-value"
}
```

The backend receives that in:

```text
apps/backend/src/trpc/project.routes.ts
```

The route is:

```ts
project.updateEnvVars
```

That route calls:

```ts
projectQueries.updateEnvVars(ctx.project.id, input.envVars)
```

The DB write happens in:

```text
apps/backend/src/queries/project.queries.ts
```

The function is:

```ts
updateEnvVars(projectId, envVars)
```

The values are stored on the project row in:

```text
project.envVars
```

Important point:

```text
MCP vars are not stored separately.
They become normal project env vars.
```

## 7. Step Three: Runtime Replacement

Runtime means:

```text
What happens when the backend is actually running and MCP is about to start?
```

At runtime, nao reads:

```text
agent/mcps/mcp.json
```

That happens in:

```text
apps/backend/src/services/mcp.ts
```

The method is:

```ts
_loadConfig()
```

Before the fix, MCP did this:

```text
Read mcp.json.
Replace ${VAR} using process.env only.
Parse the JSON.
Start the MCP server.
```

The problem was `process.env`.

`process.env` means environment variables from the backend machine itself.

But the values entered in the Cloud UI are stored in the database, not automatically in `process.env`.

So if the user entered `DBT_TOKEN` in the UI, MCP still did not see it.

### What Changed

MCP now loads saved project env vars before parsing `mcp.json`:

```ts
const envVars = this._projectId ? await getEnvVars(this._projectId) : {};
const resolved = replaceEnvVars(fileContent, envVars);
```

This means:

```text
Read mcp.json.
Load saved env vars from the DB.
Replace ${VAR} using saved project env vars.
If not found there, fall back to process.env.
Parse the JSON.
Start the MCP server.
```

The replacement helper lives in:

```text
apps/backend/src/utils/utils.ts
```

It now works like this:

```ts
export const replaceEnvVars = (fileContent: string, extraEnv: Record<string, string> = {}) => {
  const replaced = fileContent.replace(/\$\{(\w+)\}/g, (match, varName) => {
    return extraEnv[varName] || process.env[varName] || match;
  });
  return replaced;
};
```

Read that as:

```text
If the saved project env vars contain DBT_TOKEN, use that.
Otherwise, if process.env contains DBT_TOKEN, use that.
Otherwise, leave ${DBT_TOKEN} unchanged.
```

## 8. Step Four: Refreshing MCP After Save

There was one more subtle problem.

MCP keeps its config in memory.

That means this could happen:

```text
MCP loads mcp.json before DBT_TOKEN is saved.
MCP stores the unresolved config in memory.
User saves DBT_TOKEN in the UI.
MCP still has the old config in memory.
```

So even after saving the value, MCP might not notice it.

### What Changed

After env vars are saved, the backend now tells MCP:

```text
Refresh your project config.
```

This happens in:

```text
apps/backend/src/trpc/project.routes.ts
```

After:

```ts
await projectQueries.updateEnvVars(ctx.project.id, input.envVars);
```

we now call:

```ts
await mcpService.refreshProjectConfig(ctx.project.id);
```

The refresh method lives in:

```text
apps/backend/src/services/mcp.ts
```

It reloads the MCP config for the current project if MCP had already been initialized.

In plain English:

```text
When the user saves env vars, MCP forgets the old in-memory config and reloads with the new values.
```

## 9. Full Flow After The Fix

Here is the final intended behavior:

```text
Project has agent/mcps/mcp.json
        ↓
mcp.json contains "${DBT_TOKEN}"
        ↓
Backend discovers DBT_TOKEN
        ↓
Cloud UI shows DBT_TOKEN
        ↓
Admin enters the real token
        ↓
Backend saves it in project.envVars
        ↓
Backend tells MCP to refresh config
        ↓
MCP reloads mcp.json
        ↓
replaceEnvVars turns "${DBT_TOKEN}" into the real token
        ↓
MCP server starts with DBT_TOKEN available
```

## 10. Files Changed

### `apps/backend/src/utils/nao-config.ts`

Purpose:

```text
Find required env vars for the UI.
```

Main change:

```text
Also scan agent/mcps/mcp.json for ${VAR}.
```

### `apps/backend/src/utils/utils.ts`

Purpose:

```text
Replace ${VAR} placeholders with actual values.
```

Main change:

```text
Accept saved project env vars as an extra input.
```

### `apps/backend/src/services/mcp.ts`

Purpose:

```text
Load MCP config and start MCP servers.
```

Main changes:

```text
Load project env vars before parsing mcp.json.
Refresh cached MCP config after env vars are saved.
```

### `apps/backend/src/trpc/project.routes.ts`

Purpose:

```text
Expose backend project APIs to the frontend.
```

Main change:

```text
After saving env vars, tell MCP to refresh.
```

### `apps/frontend/src/components/settings/env-vars-section.tsx`

Purpose:

```text
Show env vars in the Settings UI.
```

Main change:

```text
Update the description to mention both nao_config.yaml and mcp.json.
```

### `apps/backend/tests/nao-config.test.ts`

Purpose:

```text
Test env var discovery.
```

Main change:

```text
Tests that ${VAR} placeholders in mcp.json are discovered.
```

### `apps/backend/tests/utils.test.ts`

Purpose:

```text
Test utility functions.
```

Main change:

```text
Tests that replaceEnvVars uses saved project env vars before process.env.
```

### `apps/backend/tests/mcp-review-fixes.test.ts`

Purpose:

```text
Test MCP edge cases and fixes.
```

Main change:

```text
Tests that refreshing MCP clears cached runtime state and reloads config.
```

### `example/agent/mcps/mcp.json`

Purpose:

```text
Example MCP config.
```

Main change:

```text
Adds a DBT_TOKEN placeholder example.
```

## 11. How To Test

Run focused backend tests:

```bash
npm run -w @nao/backend test -- tests/mcp-review-fixes.test.ts tests/nao-config.test.ts tests/utils.test.ts
```

Run lint:

```bash
npm run lint
```

## 12. How To Test In The UI

Run the backend using the example project:

```bash
NAO_DEFAULT_PROJECT_PATH=/Users/thibault/nao/example npm run dev:backend
```

Run the frontend:

```bash
npm run dev:frontend
```

Open the app and go to:

```text
Settings -> Project -> Environment Variables
```

You should see vars from `example/agent/mcps/mcp.json`, including:

```text
METABASE_URL
METABASE_API_KEY
DBT_TOKEN
```

Seeing `DBT_TOKEN` in the UI proves discovery works.

Saving a value proves the UI-to-DB path works.

Having a real MCP server successfully use that value proves runtime replacement works.

## 13. Important Testing Note

The example DBT MCP server is only an example placeholder.

It is good for testing:

```text
Does DBT_TOKEN appear in the UI?
```

It is not enough for testing:

```text
Can a real DBT MCP server authenticate with DBT_TOKEN?
```

For that, use a real MCP server package that actually reads `DBT_TOKEN`.

## 14. What To Say In A PR

A short PR summary could be:

```text
Collect required environment variables from MCP config in addition to nao_config.yaml, and use saved project env vars when loading MCP servers.
```

A slightly longer version:

```text
This fixes deployed MCP servers whose secrets are declared only in agent/mcps/mcp.json. The backend now discovers ${VAR} placeholders from MCP config, exposes them in the existing Environment Variables UI, substitutes saved project env vars when loading MCP config, and refreshes cached MCP state after env vars are updated.
```

## 15. The Whole Fix In One Sentence

Before, MCP env vars were invisible to the UI and ignored at runtime.

Now, MCP env vars are discovered, saved through the existing UI, loaded from the DB, and applied when MCP starts.
