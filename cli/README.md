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
│ init         Initialize a new nao project.                                │
│ --help (-h)  Display this message and exit.                               │
│ --version    Display application version.                                 │
╰───────────────────────────────────────────────────────────────────────────╯
```

### Initialize a new nao project

```bash
nao init
```

This will create a new nao project in the current directory. It will prompt you for a project name and ask you if you want to set up an LLM configuration.

### Start the nao chat UI

```bash
nao chat
```

This will start the nao chat UI. It will open the chat interface in your browser at `http://localhost:5005`.

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

╭─ Commands ────────────────────────────────────────────────────────────────────────────────────────────────╮
│ --help (-h)  Display this message and exit.                                                               │
│ --version    Display application version.                                                                 │
╰───────────────────────────────────────────────────────────────────────────────────────────────────────────╯
╭─ Parameters ──────────────────────────────────────────────────────────────────────────────────────────────╮
│ --force -f --no-force              Force rebuild the server binary [default: False]                       │
│ --skip-server -s --no-skip-server  Skip server build, only build Python package [default: False]          │
│ --bump                             Bump version before building (patch, minor, major) [choices: patch,    │
│                                    minor, major]                                                          │
╰───────────────────────────────────────────────────────────────────────────────────────────────────────────╯
```

This will:
1. Build the frontend with Vite
2. Compile the backend with Bun into a standalone binary
3. Bundle everything into a Python wheel in `dist/`

Options:
- `--force` / `-f`: Force rebuild the server binary
- `--skip-server`: Skip server build, only build Python package
- `--bump`: Bump version before building (patch, minor, major)

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
nao-chat-server (Bun-compiled binary)
    ↓ serves
Backend API + Frontend Static Files
    ↓
Browser at http://localhost:5005
```
