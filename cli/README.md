# nao CLI

Command-line interface for nao chat.

## Installation

```bash
pip install nao-core
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

- **Database connections** (BigQuery, DuckDB, Databricks, Snowflake, PostgreSQL)
- **Git repositories** to sync
- **LLM provider** (OpenAI, Anthropic, Mistral, Gemini)
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

### Start the nao chat UI

```bash
nao chat
```

This will start the nao chat UI. It will open the chat interface in your browser at `http://localhost:5005`.

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

- **Databases** — generates markdown docs (`columns.md`, `preview.md`, `description.md`, `profiling.md`) for each table into `databases/`
- **Git repositories** — clones or pulls repos into `repos/`
- **Notion pages** — exports pages as markdown into `docs/notion/`

After syncing, any Jinja templates (`*.j2` files) in the project directory are rendered with the nao context.

### Run tests

```bash
nao test
```

Runs test cases defined as YAML files in `tests/`. Each test has a `name`, `prompt`, and expected `sql`. Results are saved to `tests/outputs/`.

Options:

- `--model` / `-m`: Models to test against (default: `openai:gpt-4.1`). Can be specified multiple times.
- `--threads` / `-t`: Number of parallel threads (default: `1`)

Examples:

```bash
nao test -m openai:gpt-4.1
nao test -m openai:gpt-4.1 -m anthropic:claude-sonnet-4-20250514
nao test --threads 4
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
pip install -e .
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
