# nao - The #1 Open-Source Analytics Agent

nao is a framework to build and deploy analytics agents. Create context for your analytics agent with the nao-core CLI, then deploy a chat UI for anyone to interact with your data.

🌐 [Website](https://getnao.io) · 📚 [Documentation](https://docs.getnao.io) · 💬 [Slack](https://join.slack.com/t/naolabs/shared_invite/zt-3cgdql4up-Az9FxGkTb8Qr34z2Dxp9TQ) · 🐙 [GitHub](https://github.com/getnao/nao)

## Docker

### Supported Tags

- `latest` - Latest stable release
- `commit-hash` - Specific commit hash tags

### Supported Architectures

- `linux/amd64`

### Base Image

- Python 3.12 (slim) with Node.js 24 and Bun

## Quick Start

### Using Docker Run (SQLite database)

```bash
docker run -d \
  --name nao \
  -p 5005:5005 \
  -e OPENAI_API_KEY=sk-... \
  -v /path/to/your/project:/app/project \
  getnao/nao:latest
```

## Environment Variables

| Variable                   | Required | Description                                           |
| -------------------------- | -------- | ----------------------------------------------------- |
| `NAO_DEFAULT_PROJECT_PATH` | Yes      | Path to your nao project (default: `/app/example`)    |
| `OPENAI_API_KEY`           | No\*     | OpenAI API key                                        |
| `ANTHROPIC_API_KEY`        | No\*     | Anthropic API key                                     |
| `BETTER_AUTH_SECRET`       | No       | Secret key for authentication                         |
| `DB_URI`                   | No       | PostgreSQL connection string (uses SQLite if not set) |
| `SLACK_BOT_TOKEN`          | No       | Slack bot token for Slack integration                 |
| `SLACK_SIGNING_SECRET`     | No       | Slack signing secret                                  |
| `SERVER_PORT`              | No       | Port to listen to                                     |

\* At least one LLM API key is required to make AI queries.

## Ports

| Port   | Description                                                        |
| ------ | ------------------------------------------------------------------ |
| `5005` | Web UI and API, can be set via `$SERVER_PORT` environment variable |

## Volumes

Mount your nao project directory to make it available to the agent:

```bash
-v /path/to/your/nao-project:/app/project
```

Then set `NAO_DEFAULT_PROJECT_PATH=/app/project`, you can also use the example project by setting `NAO_DEFAULT_PROJECT_PATH=/app/example`.

## Docker run example

```bash
docker run -d \
  --name nao \
  -p 5005:5005 \
  -e NAO_DEFAULT_PROJECT_PATH=/app/project \
  getnao/nao:latest
```

Then navigate to http://localhost:5005 to access the UI (or to any URL you configured).

## Key Features

- 🧱 **Open Context Builder** — Create file-system context for your agent
- 🏳️ **Data Stack Agnostic** — Works with any data warehouse, stack, LLM
- 🔒 **Self-hosted & Secure** — Use your own LLM keys for maximum data security
- 🤖 **Natural Language to Insights** — Ask questions in plain English
- 📊 **Native Data Visualization** — Create visualizations directly in chat

## License

Apache 2.0 - See [LICENSE](https://github.com/naolabs/chat/blob/main/LICENSE)
