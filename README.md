# nao Chat

nao Chat is a chat interface for nao. It is a monorepo that contains the frontend, backend and CLI for nao Chat.

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

## Development
### Running the project

At the root of the project, run:

```bash
npm run dev
```

This will start the project in development mode. It will start the frontend and backend in development mode.

### Publishing to PyPI

```bash
npm run publish
```

By default, this will publish a patch version. You can specify a different version bump with:

```bash
npm run publish <major|minor|patch>
```

## What do we use?

### Backend

- Fastify: https://fastify.dev/docs/latest/
- Drizzle: https://orm.drizzle.team/docs/get-started
- tRPC router: https://trpc.io/docs/server/routers

### Frontend

- tRPC client: https://trpc.io/docs/client/tanstack-react-query/usage
- Tanstack Query: https://tanstack.com/query/latest/docs/framework/react/overview
- Shadcn: https://ui.shadcn.com/docs/components
