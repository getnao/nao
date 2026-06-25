# nao TypeScript SDK

Official TypeScript/JavaScript SDK for the [nao](https://github.com/getnao/nao) analytics agent. Ask questions in natural language and get data insights back — programmatically.

## Installation

```bash
npm install @nao/sdk
```

Requires Node.js 18+ (uses the global `fetch`).

## Quickstart

```ts
import { Nao } from '@nao/sdk';

const client = new Nao({ apiKey: 'nao_...', baseUrl: 'https://your-nao-instance.com' });

// One-shot run — resolves once the agent is done.
const result = await client.run('How many orders were placed last month?');
console.log(result.text);
console.log(result.chatId); // reuse to continue the conversation
```

### Streaming

```ts
for await (const event of client.stream('What were our top 5 products by revenue?')) {
	if (event.type === 'text') {
		process.stdout.write(event.text);
	} else if (event.type === 'tool') {
		console.log(`\n[running ${event.name}]`);
	}
}
```

### Continuing a conversation

```ts
const first = await client.run('How many customers do we have?');
const followUp = await client.run('And how many are returning?', { chatId: first.chatId });
```

### Picking a model

Only models activated for the project can be selected.

```ts
// List the activated models
const models = await client.models();

// Select one — as a "provider:model-id" string or a { provider, modelId } object
await client.run('Summarise revenue trends', { model: 'openai:gpt-4o' });
await client.run('Summarise revenue trends', { model: { provider: 'openai', modelId: 'gpt-4o' } });
```

### Selecting a project

If your organization has multiple projects, pass `projectId` (or set it on the client).

```ts
const client = new Nao({ apiKey: 'nao_...', projectId: '<project-uuid>' });
console.log(await client.projects());
```

## Authentication

Create an organization API key from the nao app (Settings → API keys). Keys start with `nao_`.

## API

| Method                                              | Description                                          |
| --------------------------------------------------- | ---------------------------------------------------- |
| `new Nao({ apiKey, baseUrl?, projectId?, model? })` | Create a client                                      |
| `client.run(prompt, options?)`                      | Run and resolve with the full response (`RunResult`) |
| `client.stream(prompt, options?)`                   | Stream the response as `StreamEvent`s                |
| `client.models({ projectId? })`                     | List activated models                                |
| `client.projects()`                                 | List projects for the org                            |
