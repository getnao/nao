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

### Running the project

At the root of the project, run:

```bash
npm run dev
```

This will start the project in development mode. It will start the frontend and backend in development mode.

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

- Ask on [Slack](https://join.slack.com/t/naolabs/shared_invite/zt-3cgdql4up-Az9FxGkTb8Qr34z2Dxp9TQ)
