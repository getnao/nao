# 🪄 Contributing to nao

Thank you for your interest in contributing to nao! 🎉. This guide exists to save both sides time.

# One rule

**You must understand your code.** If you cannot explain what your changes do and how they interact with the rest of the system, your PR will be closed.

Using AI to write code is fine. Submitting AI-generated slop without understanding it is not. As nao is a tool that connects to third party services (warehouses, LLMs, etc.), it's crucial that you have tested your changes against the real services in order for your PR to be at least reviewed.

If you use an agent, run it from nao root directory so it picks up CLAUDE.md. Your agent must follow the rules and guidelines in that file.

# Contribution gate

All issues and PRs from new contributors are auto-closed by default.

Maintainers review auto-closed issues daily and reopen worthwhile ones. Issues that do not meet the quality bar below will not be reopened or receive a reply.

Approval happens through maintainer replies on issues:

- `lgtmi`: your future issues will not be auto-closed
- `lgtm`: your future issues and PRs will not be auto-closed

`lgtmi` does not grant rights to submit PRs. Only `lgtm` grants rights to submit PRs.

# Quality bar for issues

If you open an issue, keep it short, concrete, and worth reading.

- Keep it concise. If it does not fit on one screen, it is too long (except for bugs and tracebacks).
- Write in your own voice.
- State the bug or request clearly.
- Explain why it matters.
- If you want to implement the change yourself, say so.

If the issue is real and written well, a maintainer may reopen it, reply `lgtmi`, or reply `lgtm`.

# Quality bar for PRs

Every PR has to be attached to an issue. If a PR is not attached to an issue, it will be closed and you will be asked to open an issue first to get a `lgtmi` or `lgtm` reply.

When submitting a PR, we ask you to write a blurb of what you did in the PR, it should be dead simple and self-explanatory. Like for the issues, write it in your own voice.

We also ask you to share the model id that you used to write the code. For instance if you used Claude Sonnet 4.6, you should add in your PR description:

```
This PR was written using Claude Sonnet 4.6 (claude-sonnet-4-6).
```

# Blocking

If you ignore this document twice, or if you spam the tracker with agent-generated issues, your GitHub account will be permanently blocked.

## Getting Started

### Node and npm versions

The repo pins Node to the version in `.nvmrc` and npm to the exact version in the
`packageManager` field of the root `package.json`. npm refuses to install with any
other version (`engine-strict`), because npm releases disagree on the
`dev`/`peer`/`optional` flags they write into `package-lock.json`, so every install
would rewrite the file and the diff would flip back and forth forever.

```bash
nvm use
npm run npm:pin
```

If you touched dependencies, normalise the lockfile before committing:

```bash
npm run lock:normalize
```

### Running the project

At the root of the project, run:

```bash
npm run dev
```

This will start the project in development mode. It will start the frontend and backend in development mode.

### Local Metabase migration fixture

The isolated fixture runs Metabase at `http://localhost:3001` and its analytics PostgreSQL database at
`localhost:5434`. It does not modify the normal development Compose stack or the example context.

```bash
npm run metabase:start
npm run metabase:verify-data
npm run metabase:bootstrap
```

The first bootstrap prints a `METABASE_API_KEY`. Copy it to `.env`; it is not stored in the repository and
Metabase will not display it again. If it is lost, run `npm run metabase:reset` and bootstrap the clean fixture
again. Bootstrap is idempotent, so normal reruns update the named fixture assets without duplicating them.

Use the fixture context when starting nao:

```bash
export NAO_DEFAULT_PROJECT_PATH="$PWD/docker/metabase/context"
export METABASE_URL=http://localhost:3001
export METABASE_API_KEY="<key printed by metabase:bootstrap>"
export METABASE_ANALYTICS_HOST=localhost
export METABASE_ANALYTICS_PORT=5434
export METABASE_ANALYTICS_DATABASE=analytics
export METABASE_ANALYTICS_USER=analytics
export METABASE_ANALYTICS_PASSWORD=analytics
export BETA_STORY_FILTERS_ENABLED=true
npm run dev:backend
```

Omit `BETA_STORY_FILTERS_ENABLED` to verify that migration still creates an unfiltered partial story when
interactive story filters are disabled.

If port 3001 is occupied, set both `METABASE_PORT` and `METABASE_URL`, for example:

```bash
METABASE_PORT=3002 npm run metabase:start
METABASE_URL=http://localhost:3002 npm run metabase:bootstrap
```

Stop the containers without removing fixture state with `npm run metabase:stop`. A clean reset deletes both
fixture volumes, so start and bootstrap again afterward:

```bash
npm run metabase:reset
npm run metabase:start
npm run metabase:verify-data
npm run metabase:bootstrap
```

The reset creates a new API key. Replace the old `METABASE_API_KEY` before restarting the nao backend.

The bootstrap creates five targeted dashboards plus one combined acceptance dashboard:

- `Native SQL Basics`: native SQL, tabs, text, scalar, line, bar, table, and an unsupported funnel.
- `Layout and Tabs`: multiple tabs, source rows, mixed widths, text, and visual cards.
- `Filters and Templates`: supported category wiring plus unsupported date/default behavior for partial-report checks.
- `GUI Query and Reusable Objects`: MBQL, model, metric, and segment references.
- `Visualization Breadth`: pie, donut, stacked area, combo, scatter, map, formatting, and horizontal bars.
- `Full Migration Acceptance`: all 20 unique fixture cards grouped into four tabs with filter wiring preserved.

### Migration CLI primitives

Run the commands from `cli/` against a running nao backend. Source commands are read-only.

```bash
cd cli
BACKEND_URL=http://localhost:5005 uv run nao metabase collections --json
BACKEND_URL=http://localhost:5005 uv run nao metabase dashboards --collection-id 6 --json
BACKEND_URL=http://localhost:5005 uv run nao metabase dashboard "Visualization Breadth" --json
BACKEND_URL=http://localhost:5005 uv run nao metabase card <card-id> --json
BACKEND_URL=http://localhost:5005 uv run nao metabase compile-card <card-id> --json
BACKEND_URL=http://localhost:5005 uv run nao metabase execute-card <card-id> --json
```

IDs are stable only within one fixture instance. Read collection, dashboard, card, folder, and story IDs from
the preceding JSON response instead of copying IDs from another reset.

Create and update a story explicitly:

```bash
printf '# Fixture acceptance\n' > /tmp/metabase-story.md
BACKEND_URL=http://localhost:5005 uv run nao stories folders --json
BACKEND_URL=http://localhost:5005 uv run nao stories create-folder "Metabase imports" --json
BACKEND_URL=http://localhost:5005 uv run nao stories create \
  --title "Fixture acceptance" \
  --content-file /tmp/metabase-story.md \
  --folder-id <folder-id> \
  --json
BACKEND_URL=http://localhost:5005 uv run nao stories update <story-id> \
  --title "Fixture acceptance updated" \
  --content-file /tmp/metabase-story.md \
  --json
BACKEND_URL=http://localhost:5005 uv run nao stories move <story-id> --folder-id <folder-id> --json
```

The story UUID returned by `create` is required by `update` and `move`. Titles are never used to guess an
existing target.

### Direct nao MCP primitives

The same normalized source operations are available to MCP clients. Example tool arguments:

```text
list_metabase_collections {}
list_metabase_dashboards {"collection_id": 6}
get_metabase_dashboard {"dashboard_id": 5}
get_metabase_card {"card_id": 60}
compile_metabase_card_query {"card_id": 60}
execute_metabase_card {"card_id": 60}
list_story_folders {}
create_story_folder {"name": "Metabase imports"}
move_story_to_folder {"story_id": "<story-uuid>", "folder_id": "<folder-uuid>"}
```

Use IDs returned by your own fixture. Use the existing `create_story` and `update_story` tools for story
content, then `move_story_to_folder` for placement.

### Agent-driven migration

`ask_nao` is the recommended entry point. A complete acceptance prompt is:

```text
Migrate the Metabase dashboard "Full Migration Acceptance" from the configured "metabase" server.
Map its analytics database to the only matching nao PostgreSQL database.
Create a story in the "Metabase imports" folder, execute and compare every source card,
and finish with the complete migration report. Do not write to Metabase.
```

For a follow-up, include the returned story UUID and say `update this story`; do not ask for another import by
title. Run the other four fixture dashboards the same way to cover native SQL, layouts, filters, MBQL, and
reusable objects.

Database IDs are not assumed to match between Metabase and nao. The migration maps one source database to one
configured nao database only when the connection is unambiguous; otherwise it asks for the target database
instead of probing candidates.

Supported direct mappings include KPI, line, bar, horizontal/stacked bar, area, pie/donut, combo, scatter,
table, point or supported-region maps, and optional string equality filters. Supported formatting is copied
only when nao has an exact equivalent. Date-range filters, pivot flattening, layout changes, required/default
filter behavior, and reusable-object inlining are reported as approximations or unsupported behavior. Funnel,
gauge, progress, sankey, drill-through, click actions, navigation, custom JavaScript, subscriptions, and alerts
are skipped unless an explicit supported approximation is accepted.

Migration reports are `complete`, `partial`, or `failed`. A report is `partial` whenever an item, interaction,
format, filter behavior, or reusable semantic definition was skipped, approximated, or not verified. A
successful query comparison does not claim pixel-identical rendering.

### Fixture troubleshooting

- `authentication`: confirm `METABASE_API_KEY` came from the current fixture reset and restart the backend.
- `missing_tool` or an empty generated tool folder: confirm the pinned MCP package can run with `npx`, then
  reconnect the Metabase MCP server. Restart a development backend after changing MCP configuration.
- `ambiguous_server`: pass `--server-name` in the CLI or `server_name` to the MCP tool.
- `ambiguous database`: identify the nao database explicitly; do not edit Metabase IDs.
- Missing `data.native_form.query`: confirm the fixture uses the pinned Metabase/MCP versions; MBQL migration
  requires SQL compiled by Metabase.
- Category-filter output differs: check dashboard parameter mappings, template-tag names, and
  `BETA_STORY_FILTERS_ENABLED`. Date ranges, defaults, and required behavior are currently reported rather than
  preserved.
- Source and target rows differ: verify the database mapping and run `npm run metabase:verify-data`. Do not
  rewrite valid source SQL to force a match.
- A live-story refresh references `query_*`: recreate or update it with the durable warehouse query ID; local
  result-table IDs are temporary.

### Maintainer visual review

Automated checks validate source values and story configuration, not pixel equivalence. Before approval:

- Compare story titles, descriptions, tab order, reading order, and relative grid widths.
- Check axes, series, labels, colors, currency/precision, stacking, and data-label visibility.
- Check table readability and translated conditional formatting.
- Check map coordinates, labels, and marker sizing.
- Confirm every unsupported interaction or approximation appears in the report.

## Project Structure

```
chat/
├── apps/
│   ├── backend/     # Bun + Fastify + tRPC API server
│   └── frontend/    # React + Vite + TanStack Router
└── cli/             # Python CLI (nao-core package)
```

### Enterprise Edition (EE)

Some files in this repo are part of the commercial nao Enterprise Edition.
They are clearly marked with `/* @license Enterprise */` at the top of the
file and are subject to the commercial terms in [LICENSE](LICENSE) rather
than Apache 2.0.

Every EE feature is gated behind a signed `NAO_LICENSE` token (JWS / Ed25519),
verified offline against a bundled public key. When `NAO_LICENSE` is not
configured, the EE code paths stay dormant and the app runs in OSS mode.

External contributors are welcome to read, propose changes to, and submit
PRs against EE-marked files just like the rest of the codebase.

## Development Commands

| Command                         | Description                          |
| ------------------------------- | ------------------------------------ |
| `npm run dev`                   | Start backend + frontend in dev mode |
| `npm run dev:backend`           | Backend only (Bun on :5005)          |
| `npm run dev:frontend`          | Frontend only (Vite on :3000)        |
| `npm run lint`                  | Run ESLint on both apps              |
| `npm run lint:fix`              | Fix lint issues                      |
| `npm run format`                | Format with Prettier                 |
| `npm run -w @nao/backend test`  | Run backend tests                    |
| `npm run -w @nao/frontend test` | Run frontend tests                   |

### Database Commands

| Command                               | Description                         |
| ------------------------------------- | ----------------------------------- |
| `npm run pg:start`                    | Start PostgreSQL via docker-compose |
| `npm run pg:stop`                     | Stop PostgreSQL                     |
| `npm run -w @nao/backend db:generate` | Generate migrations                 |
| `npm run -w @nao/backend db:migrate`  | Apply migrations                    |
| `npm run -w @nao/backend db:studio`   | Open Drizzle Studio GUI             |

## Making Changes

### Code Style

- Run `npm run lint:fix` before committing
- Run `npm run format` to format code with Prettier
- Follow existing patterns in the codebase

## Questions?

- Ask on [Slack](https://join.slack.com/t/naolabs/shared_invite/zt-4080jlm79-nm52x5nZhG2N1ben8zwpiQ)
