# MCP scratch directory (`NAO_MCP_SCRATCH_DIR`)

Lets an MCP server (or any colocated process) write result files to a fixed folder
that `execute_sql` can then query with DuckDB, without those files needing to live in
nao's permanent `/home` storage.

## Why this exists

Some MCP tools return large result sets. Instead of pushing all that data back through
the model (which bloats context), the MCP writes the result to a file on disk and hands
back a path. The agent then runs `execute_sql` over that file with DuckDB.

By default DuckDB is locked down: it may only read from `context.projectFolder`, the
directories backing any `/home` storage paths referenced in the query, and a private
staging directory used by `save_to`. A file an MCP drops anywhere else is rejected.

`NAO_MCP_SCRATCH_DIR` adds one operator-controlled directory to that allowlist, so an
MCP can write to a fixed path and the agent can read it back by its absolute path.

## Configuration

| Variable              | Required | Default | Description                                                                                                                                                             |
| --------------------- | -------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `NAO_MCP_SCRATCH_DIR` | No       | _unset_ | Absolute path to a directory DuckDB (`execute_sql`) is allowed to read from, in addition to the project folder and `/home` storage. When unset, behaviour is unchanged. |

Notes:

- **Use an absolute path.** A relative path resolves against the backend process's
  working directory, which is rarely what you expect.
- The directory (and its subdirectories) becomes readable by every `execute_sql` call.
- Both the MCP (writing) and the nao backend (reading via DuckDB) must see the **same**
  directory — i.e. a shared filesystem or a shared mounted volume.

## How to use it

1. Set the env var to a directory the backend can read:

    ```bash
    NAO_MCP_SCRATCH_DIR=/tmp/nao-mcp-scratch
    ```

2. Have the MCP write its output there, e.g. `/tmp/nao-mcp-scratch/<uuid>.json`.

3. In chat, the agent queries it by **absolute path**:

    ```sql
    SELECT * FROM read_json_auto('/tmp/nao-mcp-scratch/<uuid>.json')
    ```

### Local development

```bash
cd apps/backend
NAO_DEFAULT_PROJECT_PATH="/path/to/your/project" \
NAO_MCP_SCRATCH_DIR=/tmp/nao-mcp-scratch \
bun run dev
```

### Docker / deployment

Add the variable to your environment (e.g. `docker-compose.yml` or Helm values) and make
sure the path is a shared, writable volume both the MCP and the backend can access:

```yaml
environment:
    NAO_MCP_SCRATCH_DIR: /mnt/mcp-scratch
```

## Cleanup / making files temporary

These files are **not** deleted automatically by nao. They never enter permanent storage,
but they will sit in the scratch directory until something removes them. Pick one:

- **Object-store lifecycle rule (recommended when the scratch dir is a mounted bucket).**
  e.g. a GCS/S3 lifecycle rule that deletes objects under the scratch prefix after N days.
  Note GCS lifecycle granularity is a minimum of 1 day.
- **A periodic cleanup job:**

    ```bash
    find /path/to/scratch -type f -mmin +60 -delete
    ```

- **`/tmp` on the host** is cleared on reboot and macOS purges old files after ~3 days —
  fine for local dev, too loose for production.

Do not delete files immediately after the first query: the agent often runs several
queries against the same file within one conversation, so pick a retention window that
outlives a chat session.

## Security note

The scratch directory is **shared across all projects and users** — it is not scoped per
tenant. Any project's `execute_sql` call can read any file in it if it knows the filename.
With random (e.g. UUID) filenames and short lifetimes this is low risk, but if you host
multiple tenants and need strict isolation, have the MCP write into per-project
subdirectories (e.g. `<scratch>/<projectId>/`) — which requires the MCP to know the
project id.

## What changed in the code

- `apps/backend/src/env.ts` — added the optional `NAO_MCP_SCRATCH_DIR` env var.
- `apps/backend/src/services/local-query.service.ts` — when set, the scratch directory is
  appended to the `allowedDirectories` list passed to `runLocalQuery`. When unset, nothing
  changes (fully backward-compatible). No other part of the DuckDB lockdown is affected:
  queries stay read-only and external access remains disabled.
