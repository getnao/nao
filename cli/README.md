# nao CLI

Command-line interface for nao chat.

## Installation

Install the core package (lightweight, no database or LLM dependencies):

```bash
pip install nao-core
```

Then add only the providers you need:

```bash
# Database backends
pip install 'nao-core[postgres]'
pip install 'nao-core[bigquery]'
pip install 'nao-core[snowflake]'
pip install 'nao-core[duckdb]'
pip install 'nao-core[clickhouse]'
pip install 'nao-core[databricks]'
pip install 'nao-core[mysql]'
pip install 'nao-core[mssql]'
pip install 'nao-core[athena]'
pip install 'nao-core[trino]'
pip install 'nao-core[redshift]'
pip install 'nao-core[fabric]'
pip install 'nao-core[starrocks]'

# LLM providers
pip install 'nao-core[openai]'
pip install 'nao-core[anthropic]'
pip install 'nao-core[mistral]'
pip install 'nao-core[gemini]'
pip install 'nao-core[ollama]'

# Integrations
pip install 'nao-core[notion]'
```

Combine multiple extras in a single install:

```bash
pip install 'nao-core[postgres,openai]'
pip install 'nao-core[snowflake,bigquery,anthropic]'
```

Or install everything at once (equivalent to the previous default):

```bash
pip install 'nao-core[all]'
```

Convenience groups are also available:

```bash
pip install 'nao-core[all-databases]'  # all database backends
pip install 'nao-core[all-llms]'       # all LLM providers
```

## Usage

```bash
nao --help
Usage: nao COMMAND

╭─ Commands ────────────────────────────────────────────────────────────────╮
│ chat         Start the nao chat UI.                                       │
│ debug        Test connectivity to configured resources.                   │
│ init         Initialize a new nao project.                                │
│ sync         Sync resources to local files.                               │
│ test         Run and explore nao tests.                                   │
│ --help (-h)  Display this message and exit.                               │
│ --version    Display application version.                                 │
╰───────────────────────────────────────────────────────────────────────────╯
```

### Initialize a new nao project

```bash
nao init
```

This will create a new nao project in the current directory. It will prompt you for a project name and ask you to configure:

- **Database connections** (BigQuery, DuckDB, MotherDuck, Databricks, Snowflake, PostgreSQL, Redshift, MSSQL, Trino, StarRocks)
- **Git repositories** to sync
- **LLM provider** (OpenAI, Anthropic, Mistral, Gemini, OpenRouter, Ollama)
- **`ai_summary` template + model** (prompted only when you enable `ai_summary` for databases)
- **Slack integration**
- **Notion integration**

The resulting project structure looks like:

```
<project>/
├── nao_config.yaml
├── .naoignore
├── RULES.md
├── databases/
├── queries/
├── docs/
├── semantics/
├── repos/
├── agent/
│   ├── tools/
│   └── mcps/
└── tests/
```

Options:

- `--force` / `-f`: Force re-initialization even if the project already exists
- `--yes` / `-y` / `--no-tty`: Run non-interactively. Skips all prompts and uses sensible defaults — useful for AI agents and automation scripts. When combined with a pre-written `nao_config.yaml` (e.g. written by an agent skill), only scaffolds the folder structure.
- `--name` / `-n`: Project name. When set without an existing `nao_config.yaml`, this is used as the project name (and folder). In `--yes` mode without `--name`, the current directory name is used and the project is initialized in place.

#### Non-interactive (agent-friendly) mode

For LLM agents and automation, run `nao init` without any prompts:

```bash
# Initialize the current directory as a nao project (uses the directory name)
nao init --yes

# Or create a new sub-folder named "my-project"
nao init --yes --name my-project

# Pre-write nao_config.yaml then scaffold folders without prompting
cat > nao_config.yaml <<'YAML'
project_name: my-project
databases:
  - type: duckdb
    name: local
    path: ":memory:"
YAML
nao init --yes

# MotherDuck (DuckDB-compatible cloud) — token via env recommended
cat > nao_config.yaml <<'YAML'
project_name: my-project
databases:
  - type: motherduck
    name: md-analytics
    database: my_db
    token: "{{ env('MOTHERDUCK_TOKEN') }}"
YAML
nao init --yes
```

In non-interactive mode, `nao init` never asks for input. Configure databases, LLM provider, and integrations by editing `nao_config.yaml` directly (or by pre-writing it before `nao init`).

### Start the nao chat UI

```bash
nao chat
```

This will start the nao chat UI. It will open the chat interface in your browser at `http://localhost:5005`.

To let the agent run code in a micro-VM, download the sandbox runtime once with `nao chat --sandbox`, then enable
Sandboxes in Settings → Experimental. The runtime and the DuckDB engine used by `nao test` are ~100 MB each, so they
are not shipped in the package: nao fetches them on first use and caches them in `~/.nao/native`. Set
`NAO_NATIVE_REGISTRY` to download them from an npm mirror instead of `registry.npmjs.org`.

### Test connectivity

```bash
nao debug
```

Tests connectivity to all configured databases and LLM providers. Displays a summary table showing connection status and details for each resource.

### Sync resources

```bash
nao sync
```

Syncs configured resources to local files:

- **Databases** - generates markdown docs (`columns.md` with table schema, description, row count, and partition/clustering/index metadata, `query_history.md`, and `preview.md`) for each table into `databases/`
- **Git repositories** — clones or pulls repos into `repos/`
- **Notion pages** — exports pages as markdown into `docs/notion/`. Databases are exported as markdown tables, whether configured directly or embedded inline in a page. A database embedded in a page is exported through one of its views — Notion exposes no way to tell which view a page renders, so the first one listed is used — applying that view's filters, sorts and visible columns rather than dumping the whole data source. A database configured by URL exports every row and column, unless the URL carries `?v=<view_id>`, in which case that view applies. When a database cannot be exported, its page fails to sync and the previously synced markdown is left untouched, rather than being rewritten without its table.

After syncing, any Jinja templates (`*.j2` files) in the project directory are rendered with the nao context.

Optional `ai_summary` generation:

- Add `ai_summary` to a database connection `templates` list to render `ai_summary.md`.
- AI summaries use profiling statistics for data-quality and distribution observations. The row preview is a tiny, non-representative shape sample.
- Use `prompt("...")` inside Jinja templates to generate `ai_summary` content.
- `prompt(...)` requires an `llm.providers` entry with an `api_key` (except for ollama), plus `llm.annotation_model`.
- Configure `profiling` and `ai_summary` refreshes independently with `refresh_policy: always`, `once`, or `interval`. Interval policies also accept `interval_days` (default: `7`):

```yaml
databases:
  - type: duckdb
    name: analytics
    path: analytics.duckdb
    templates: [columns, preview, profiling, ai_summary]
    profiling:
      refresh_policy: once
    ai_summary:
      refresh_policy: interval
      interval_days: 7
```

### Run tests

```bash
nao test
```

Runs test cases defined as YAML files in `tests/`. Each test has a `name`, `prompt`, and expected `sql`. Results are saved to `tests/outputs/`.

Options:

- `--model` / `-m`: Models to test against (default: `openai:gpt-4.1`). Can be specified multiple times.
- `--threads` / `-t`: Number of parallel threads (default: `1`)
- `--select` / `-s`: Run only selected tests by name, yaml stem, or subfolder. Comma-separated.
- `--username` / `-u`, `--password`: Credentials for the nao backend. Fall back to `NAO_USERNAME` / `NAO_PASSWORD`.

Examples:

```bash
nao test -m openai:gpt-4.1
nao test -m openai:gpt-4.1 -m anthropic:claude-sonnet-4-20250514
nao test --threads 4
```

Defaults for every run live in the `test` block of `nao_config.yaml`, and the `--model` / `--threads` flags override them:

```yaml
test:
  models:
    - openai:gpt-4.1
    - anthropic:claude-sonnet-4-5
  threads: 4
  comparison:
    rtol: 0.00001
    atol: 0.00000001
    decimals: 2
```

### Explore test results

```bash
nao test server
```

Starts a local web server to explore test results in a browser UI showing pass/fail status, token usage, cost, and detailed data comparisons.

Options:

- `--port` / `-p`: Port to run the server on (default: `8765`)
- `--no-open`: Don't automatically open the browser

### BigQuery service account permissions

When you connect BigQuery during `nao init`, the service account used by `credentials_path`/ADC must be able to list datasets and run read-only queries to generate docs. Grant the account:

- Project: `roles/bigquery.jobUser` (or `roles/bigquery.user`) so the CLI can submit queries
- Each dataset you sync: `roles/bigquery.dataViewer` (or higher) to read tables

The combination above mirrors the typical "BigQuery User" setup and is sufficient for nao's metadata and preview pulls.

### Snowflake authentication

Snowflake supports three authentication methods during `nao init`:

- **SSO**: Browser-based authentication (recommended for organizations with SSO policies)
- **Password**: Traditional username/password
- **Key-pair**: Private key file with optional passphrase

## Development

### Building the package

```bash
cd cli
python build.py --help
Usage: build.py [OPTIONS]

Build and package nao-core CLI.

╭─ Parameters ──────────────────────────────────────────────────────────────────╮
│ --force -f --no-force              Force rebuild the server binary             │
│ --skip-server -s --no-skip-server  Skip server build, only build Python pkg   │
│ --bump                             Bump version (patch, minor, major)          │
╰───────────────────────────────────────────────────────────────────────────────╯
```

This will:
1. Build the frontend with Vite
2. Compile the backend with Bun into a standalone binary
3. Bundle everything into a Python wheel in `dist/`

### Installing for development

```bash
cd cli
pip install -e '.[all]'
```

### Publishing to PyPI

```bash
# Build first
python build.py

# Publish
uv publish dist/*
```

## Architecture

```
nao chat (CLI command)
    ↓ spawns
nao-chat-server (Bun-compiled binary, port 5005)
  + FastAPI server (port 8005)
    ↓ serves
Backend API + Frontend Static Files
    ↓
Browser at http://localhost:5005
```
