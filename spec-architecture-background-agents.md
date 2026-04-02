---
title: Background Agents with pg-boss
version: 1.0
date_created: 2026-04-02
owner: NaoLabs
tags: [architecture, infrastructure, process, backend]
---

# Introduction

This specification defines the architecture and implementation requirements for running AI agents outside the HTTP request/response cycle. Background agents are triggered by cron schedules or external webhooks, execute `agent.generate()`, and persist results to the existing `chat` / `chat_message` / `message_part` tables. The frontend consumes results via existing tRPC routes.

---

## 1. Purpose & Scope

**Purpose:** Enable asynchronous agent execution triggered by time-based schedules (cron) or external HTTP webhooks. Results are written to the database and are available to the frontend without any changes to the existing chat UI.

**Scope:**

- Backend only (`apps/backend/src/`)
- New files: `services/boss.ts`, `workers/agent.worker.ts`, `workers/save-agent-result.ts`, `workers/worker.ts`, `routes/trigger.ts`, `trpc/agent-schedule.routes.ts`, `trpc/agent-trigger.routes.ts`, `queries/agent-schedule.queries.ts`, `queries/agent-trigger.queries.ts`
- Modified files: `db/pg-schema.ts`, `db/sqlite-schema.ts`, `db/abstractSchema.ts`, `app.ts`, `trpc/router.ts`, `apps/backend/package.json`, `docker/supervisord.conf`

**Out of scope:** Frontend UI pages for managing schedules/triggers (future); real-time SSE push of background results (future).

**Assumptions:**

- The app already supports both SQLite (dev) and PostgreSQL (prod) via `db/abstractSchema.ts`
- `AgentManager.generate()` already exists in `services/agent.ts` and returns `AgentRunResult`
- `chatQueries.upsertMessage()` already accepts the full message shape including `tokenUsage`, `llmProvider`, `llmModelId`
- `memoryService.safeScheduleMemoryExtraction()` already exists in `services/memory.ts`

---

## 2. Inter-Process Communication Model

The Fastify server and the worker process never communicate directly. PostgreSQL is the sole bus between them.

- **Fastify server** — holds a pg-boss instance in "enqueue only" mode. Calls `boss.send()`, `boss.schedule()`, and `boss.unschedule()`. Writes jobs to `pgboss.job` and schedules to `pgboss.schedule`.
- **Worker process** — holds a separate pg-boss instance. Calls `boss.work()` to poll `pgboss.job` and consume jobs. Has no network connection to the Fastify process.
- **PostgreSQL** — the shared state. Both instances connect to the same database. pg-boss uses row-level locking to ensure a job is claimed by exactly one worker at a time.

This means the two processes can be on the same machine or on different machines, as long as they share the same PostgreSQL instance.

---

## 3. Definitions

| Term                       | Definition                                                                                                                                                  |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **pg-boss**                | A PostgreSQL-backed job queue library. Creates and manages its own `pgboss` schema tables.                                                                  |
| **AgentManager**           | Class in `services/agent.ts` that wraps a `ToolLoopAgent` and exposes `stream()` and `generate()`                                                           |
| **AgentRunResult**         | Return type of `AgentManager.generate()`: `{ text, usage, cost, finishReason, durationMs, responseMessages, steps }`                                        |
| **bossService**            | Singleton instance of `BossService` (`services/boss.ts`). Used by the Fastify server to enqueue jobs.                                                       |
| **worker process**         | A standalone Node.js process (`workers/worker.ts`) that connects to pg-boss and processes `agent.run` jobs. It is separate from the Fastify server process. |
| **agent.run**              | The pg-boss queue name for background agent jobs.                                                                                                           |
| **schedule**               | A named cron job stored in `agent_schedule`. Enqueues an `agent.run` job on a recurring pg-boss schedule.                                                   |
| **trigger**                | A named webhook stored in `agent_trigger`. Enqueues an `agent.run` job when `POST /api/webhooks/trigger/:triggerId` is called with a valid `secretToken`.   |
| **singletonKey**           | A pg-boss option that prevents two jobs with the same key from running in parallel. Used to avoid two agents operating on the same `chatId` simultaneously. |
| **at-least-once delivery** | pg-boss guarantees a job will be executed at least once. Jobs may re-execute after a crash. All writes must be idempotent.                                  |
| **SQLite**                 | Default database for local dev. pg-boss does NOT work with SQLite.                                                                                          |
| **PostgreSQL**             | Production database. Required for pg-boss.                                                                                                                  |

---

## 4. Requirements, Constraints & Guidelines

### Database

- **CON-001**: pg-boss requires PostgreSQL. It must not start when `DB_URI` does not begin with `postgres://` or `postgresql://`.
- **REQ-001**: When pg-boss is disabled (non-postgres), all `bossService` methods must be no-ops and must not throw. The rest of the app must be unaffected.
- **REQ-002**: `agent_schedule` and `agent_trigger` tables must exist in both `pg-schema.ts` (using `pgTable`, `boolean`, `timestamp`, `jsonb`) and `sqlite-schema.ts` (using `sqliteTable`, `integer({mode:'boolean'})`, `integer({mode:'timestamp_ms'})`, `text({mode:'json'})`). Follow the exact patterns already in each file.

### Job Queue

- **REQ-003**: The Fastify server process must start pg-boss and create the `agent.run` queue with `{ retryLimit: 3, retryDelay: 60, expireInSeconds: 600 }`. It must NOT register any workers (`boss.work()`).
- **REQ-004**: The worker process (`workers/worker.ts`) must be a standalone script that creates its own pg-boss instance (no shared memory with Fastify), starts it, calls `boss.createQueue(...)` with the same config, and registers a worker with `localConcurrency: 5`.
- **REQ-005**: All `bossService.send()` calls must include a `singletonKey` to prevent duplicate parallel executions on the same chat.
- **REQ-006**: The worker handler must be idempotent. Use `chatQueries.upsertMessage()` (never insert-only) to handle job re-execution after crashes.
- **CON-002**: `AgentManager.generate()` is used in the worker — not `stream()`. The worker must call `saveAgentResult()` manually after `generate()`.
- **GUD-001**: If `generate()` or any setup step throws, let the error propagate — pg-boss catches it and marks the job `failed`, then retries per queue config.

### Concurrency

- **REQ-007**: `mcpService.initializeMcpState()` and `skillService.initializeSkills()` are called once per job. These are the same calls made per HTTP request. Validate they are concurrency-safe before deploying; if not, add appropriate locks.
- **REQ-008**: Only one job may run per `chatId` at a time. Enforce using `singletonKey: data.chatId` in `boss.send()`. For jobs without a `chatId`, use a unique key (e.g., `` `new-${projectId}-${Date.now()}` ``).

### Persistence

- **REQ-009**: `saveAgentResult()` must call `chatQueries.upsertMessage()` with: `role: 'assistant'`, the result text, `finishReason`, `tokenUsage`, `llmProvider`, `llmModelId`. This mirrors the shape used in `AgentManager.stream()`'s `onFinish` callback (`services/agent.ts` line 296).
- **REQ-010**: `saveAgentResult()` must call `memoryService.safeScheduleMemoryExtraction()` with `{ userId, projectId, chatId, messages, provider }`. This is non-blocking.

### HTTP Webhook

- **REQ-011**: `POST /api/webhooks/trigger/:triggerId` must authenticate using `Authorization: Bearer <secretToken>`. Return 401 on mismatch, 404 if trigger not found or disabled.
- **REQ-012**: The webhook must update `agent_trigger.lastTriggeredAt` after enqueuing.
- **REQ-013**: The webhook response must include `{ jobId }`.

### tRPC Routes

- **REQ-014**: All tRPC procedures for schedules and triggers must use `adminProtectedProcedure` (defined in `trpc/trpc.ts`). Regular users cannot manage schedules or triggers.
- **REQ-015**: On `agentSchedule.create` and `agentSchedule.update`, sync the pg-boss schedule: call `bossService.schedule()` if enabled, `bossService.unschedule()` if `enabled = false`.
- **REQ-016**: On `agentSchedule.delete`, call `bossService.unschedule()` before deleting from DB.
- **REQ-017**: `agentTrigger.create` must generate a `secretToken` using `crypto.randomUUID().replace(/-/g, '')`. Return the full token in the response — this is the only time it is shown.
- **REQ-018**: `agentTrigger.regenerateToken` generates a new token and returns the updated trigger including the new token.
- **GUD-002**: For ownership checks in mutations, verify `existing.projectId === ctx.project.id`. Throw `TRPCError NOT_FOUND` on mismatch (do not reveal existence to unauthorized callers).

### Deployment

- **REQ-019**: The `dev` script in `apps/backend/package.json` must launch server and worker in parallel using `npm-run-all2`. Add `npm-run-all2` as a devDependency if not present.
- **REQ-020**: Add `[program:worker]` to `docker/supervisord.conf` with `autostart=true` and `autorestart=true`, following the same pattern as `[program:backend]`.

### TypeScript & Code Style

- **REQ-021**: After each implementation step, `tsc --noEmit` must pass with zero errors.
- **GUD-003**: File names use kebab-case (`boss.ts`, `agent.worker.ts`, `save-agent-result.ts`).
- **GUD-004**: High-level functions go first in each file, private/helper functions below.
- **GUD-005**: Do not add `AgentManager.getModelSelection()` if it does not exist — check `services/agent.ts` first. Currently only `getModelId()` exists (line 630), so add a `getModelSelection(): ModelSelection` getter that returns `this._modelSelection`.

---

## 5. Interfaces & Data Contracts

### Job Payload

```typescript
// Exported from services/boss.ts
export type AgentJobQueue = 'agent.run';

export type AgentRunJobData = {
	projectId: string;
	userId: string;
	chatId?: string; // If absent, a new chat is created by the worker
	message: string; // The user message text sent to the agent
	model?: ModelSelection; // Optional model override; falls back to project config
	source: 'cron' | 'trigger' | 'api';
	scheduleName?: string; // Populated when triggered by a cron schedule
	triggerName?: string; // Populated when triggered by a webhook
};
```

### BossService Interface

```typescript
// services/boss.ts
interface BossService {
	readonly isEnabled: boolean;
	start(): Promise<void>;
	stop(): Promise<void>;
	send(
		queue: AgentJobQueue,
		data: AgentRunJobData,
		opts?: { singletonKey?: string; priority?: number },
	): Promise<string | null>; // Returns jobId or null when disabled
	schedule(name: string, cron: string, data: AgentRunJobData): Promise<void>;
	unschedule(name: string): Promise<void>;
}

export const bossService: BossService;
```

### saveAgentResult Helper

```typescript
// workers/save-agent-result.ts
export const saveAgentResult = async (
  chat: AgentChat,
  result: AgentRunResult,
  modelSelection: ModelSelection,
  uiMessages: UIMessage[],
): Promise<void>;
```

Calls:

1. `chatQueries.upsertMessage({ role: 'assistant', chatId: chat.id, parts: [...], stopReason: result.finishReason, tokenUsage: result.usage, llmProvider: modelSelection.provider, llmModelId: modelSelection.modelId })`
2. `memoryService.safeScheduleMemoryExtraction({ userId: chat.userId, projectId: chat.projectId, chatId: chat.id, messages: uiMessages, provider: modelSelection.provider })`

### DB Tables

#### `agent_schedule` (PostgreSQL)

```typescript
export const agentSchedule = pgTable('agent_schedule', {
	id: text('id').primaryKey(),
	projectId: text('project_id')
		.notNull()
		.references(() => project.id),
	userId: text('user_id')
		.notNull()
		.references(() => user.id),
	name: text('name').notNull(),
	cronExpression: text('cron_expression').notNull(),
	message: text('message').notNull(),
	model: jsonb('model').$type<ModelSelection>(),
	enabled: boolean('enabled').default(true).notNull(),
	createdAt: timestamp('created_at').defaultNow().notNull(),
	updatedAt: timestamp('updated_at')
		.defaultNow()
		.$onUpdate(() => new Date())
		.notNull(),
});
```

#### `agent_trigger` (PostgreSQL)

```typescript
export const agentTrigger = pgTable('agent_trigger', {
	id: text('id').primaryKey(),
	projectId: text('project_id')
		.notNull()
		.references(() => project.id),
	userId: text('user_id')
		.notNull()
		.references(() => user.id),
	name: text('name').notNull(),
	secretToken: text('secret_token').notNull(),
	message: text('message').notNull(),
	model: jsonb('model').$type<ModelSelection>(),
	enabled: boolean('enabled').default(true).notNull(),
	lastTriggeredAt: timestamp('last_triggered_at'),
	createdAt: timestamp('created_at').defaultNow().notNull(),
});
```

SQLite equivalents use `integer({mode:'boolean'})` for booleans, `integer({mode:'timestamp_ms'})` for timestamps, and `text({mode:'json'})` for jsonb.

### abstractSchema.ts additions

```typescript
export type DBAgentSchedule = typeof sqliteSchema.agentSchedule.$inferSelect;
export type NewAgentSchedule = typeof sqliteSchema.agentSchedule.$inferInsert;
export type DBAgentTrigger = typeof sqliteSchema.agentTrigger.$inferSelect;
export type NewAgentTrigger = typeof sqliteSchema.agentTrigger.$inferInsert;
```

### Webhook HTTP Contract

```
POST /api/webhooks/trigger/:triggerId
Authorization: Bearer <secretToken>
Content-Type: application/json

Body (all optional):
{ "message": "string" }  // overrides trigger.message if provided

Response 200:
{ "jobId": "string" }

Response 401: { "error": "Unauthorized" }
Response 404: { "error": "Not Found" }
```

### tRPC Procedures

```typescript
// trpc/agent-schedule.routes.ts
agentSchedule.list; // query   → DBAgentSchedule[]
agentSchedule.create; // mutation input: { name, cronExpression, message, model? }
agentSchedule.update; // mutation input: { scheduleId, name?, cronExpression?, message?, enabled? }
agentSchedule.delete; // mutation input: { scheduleId }
agentSchedule.triggerNow; // mutation input: { scheduleId } → { jobId }

// trpc/agent-trigger.routes.ts
agentTrigger.list; // query   → DBAgentTrigger[]
agentTrigger.create; // mutation input: { name, message, model? } → DBAgentTrigger (includes token)
agentTrigger.regenerateToken; // mutation input: { triggerId } → DBAgentTrigger (includes new token)
agentTrigger.delete; // mutation input: { triggerId }
```

---

## 6. Acceptance Criteria

- **AC-001**: Given `DB_URI` is `sqlite:./db.sqlite`, when the server starts, then `bossService.isEnabled === false`, pg-boss is not instantiated, and no error is thrown.
- **AC-002**: Given `DB_URI` is `postgres://...`, when the server starts, then pg-boss starts and the `agent.run` queue is created with `retryLimit: 3`.
- **AC-003**: Given a valid `POST /api/webhooks/trigger/:triggerId` with correct `Authorization` header, when processed, then a job is enqueued and `{ jobId }` is returned.
- **AC-004**: Given an `Authorization` header with an incorrect token, when `POST /api/webhooks/trigger/:triggerId`, then the response is 401.
- **AC-005**: Given a schedule with `enabled: true`, when `agentSchedule.create` is called, then `bossService.schedule()` is called with the `cronExpression` and job data.
- **AC-006**: Given an existing schedule, when `agentSchedule.update({ enabled: false })`, then `bossService.unschedule()` is called for that schedule.
- **AC-007**: Given a worker receives an `agent.run` job with no `chatId`, when processed, then a new chat is created and the agent runs with the provided `message`.
- **AC-008**: Given a worker receives an `agent.run` job with a `chatId`, when processed, then the existing chat is loaded and the agent continues that conversation.
- **AC-009**: Given `agent.generate()` completes, when `saveAgentResult()` is called, then `chatQueries.upsertMessage()` is called with `role: 'assistant'` and the result data.
- **AC-010**: Given `saveAgentResult()` is called, then `memoryService.safeScheduleMemoryExtraction()` is called (non-blocking).
- **AC-011**: Given a worker crashes mid-execution, when it restarts and the job's `expireIn` elapses, then pg-boss re-enqueues the job and `upsertMessage` prevents duplicate messages.
- **AC-012**: Given the server starts with SQLite, when the full test suite runs, then all tests pass with no pg-boss-related errors.

---

## 7. Test Automation Strategy

- **Test Levels**: Unit tests for `saveAgentResult` and `BossService` constructor logic. Integration tests are out of scope for this spec (require a live Postgres).
- **Frameworks**: Vitest (already used in `apps/backend`)
- **Unit test — BossService**: When `DB_URI = 'sqlite:./db.sqlite'`, assert `isEnabled === false` and `send()` returns `null` without throwing.
- **Unit test — saveAgentResult**: Mock `chatQueries.upsertMessage` and `memoryService.safeScheduleMemoryExtraction`. Assert both are called with the correct shape.
- **Coverage**: Both new functions must be covered by unit tests before the feature is considered complete.
- **CI**: Run existing `npm test` — no new CI configuration needed.

---

## 8. Process Lifecycle & Crash Recovery

### Job State Machine

```
created → active → completed
active  → retry  → active   (if retryLimit > 0)
active  → failed            (if retryLimit exhausted)
active  → cancelled         (manual cancellation)
```

### Hard crash (kill -9, OOM)

1. The job stays stuck in `active` state.
2. On restart, `boss.start()` triggers the pg-boss maintenance loop.
3. Maintenance detects `active` jobs whose `expireIn` has elapsed → moves them to `retry` or `failed`.
4. The worker automatically picks up jobs in `retry`.

If the worker restarts **before** `expireIn` elapses, the job re-executes from the beginning. This is **at-least-once delivery**: a job may run more than once. The worker handler must therefore be idempotent — use `upsertMessage`, never insert-only.

### Graceful shutdown (SIGTERM)

`boss.stop()` drains in-flight `active` jobs before the process exits. Jobs currently running are not interrupted. Register `SIGTERM` and `SIGINT` handlers in both the Fastify server and the worker process that call `boss.stop()`.

### supervisord autorestart

`autorestart=true` in `docker/supervisord.conf` restarts the worker process automatically after any crash. On restart, `boss.start()` resumes the maintenance loop and re-queues expired jobs.

---

## 9. Rationale & Context

**Why `generate()` instead of `stream()`?** `stream()` triggers persistence via its `onFinish` side effect, which is designed for HTTP response consumers. In a worker, there is no real consumer — draining the stream is a workaround. `generate()` is a direct API that returns the full result synchronously. The explicit `saveAgentResult()` helper makes the persistence contract visible and testable.

**Why a separate worker process?** pg-boss workers hold a long-lived database connection and poll continuously. Running this inside the Fastify process would couple lifecycle concerns and make horizontal scaling harder. A separate process can be scaled, restarted, and monitored independently.

**Why `singletonKey` per `chatId`?** `agentService.create()` disposes any existing agent for the same `chatId` (`_disposeAgent`). Two concurrent jobs on the same chat would race to create and dispose each other's agents, corrupting the conversation state.

**Why idempotent writes?** pg-boss guarantees at-least-once delivery. A job may re-run after a crash. `upsertMessage` (which already exists in `chatQueries`) prevents duplicate assistant messages.

**Why `adminProtectedProcedure` for CRUD?** Schedules and triggers are project-level automation that can incur LLM costs. Only project admins should be able to create, modify, or delete them.

---

## 10. Dependencies & External Integrations

### External Systems

- **EXT-001**: PostgreSQL — required for pg-boss. The app also supports SQLite; pg-boss is silently disabled when SQLite is detected.

### Third-Party Services

- **SVC-001**: pg-boss — PostgreSQL job queue. Manages `pgboss.job`, `pgboss.schedule`, and related tables internally.

### Infrastructure Dependencies

- **INF-001**: The worker process must have network access to the same PostgreSQL instance as the Fastify server.
- **INF-002**: supervisord (in Docker) manages the worker process lifecycle alongside the backend.

### Technology Platform Dependencies

- **PLT-001**: Bun runtime — used to execute both the Fastify server and the worker process.
- **PLT-002**: `npm-run-all2` — required as a devDependency to run server and worker in parallel during local development.

---

## 11. Examples & Edge Cases

### Worker entrypoint (workers/worker.ts)

```typescript
import PgBoss from 'pg-boss';
import { env } from '../env';
import { agentWorkerHandler } from './agent.worker';

const isPostgres = env.DB_URI.startsWith('postgres://') || env.DB_URI.startsWith('postgresql://');

if (!isPostgres) {
	console.log('Worker: non-postgres DB_URI, exiting cleanly.');
	process.exit(0);
}

const boss = new PgBoss({ connectionString: env.DB_URI });
await boss.start();
await boss.createQueue('agent.run', { retryLimit: 3, retryDelay: 60, expireInSeconds: 600 });
await boss.work('agent.run', { localConcurrency: 5 }, agentWorkerHandler);

const handleShutdown = async () => {
	await boss.stop();
	process.exit(0);
};

process.on('SIGINT', handleShutdown);
process.on('SIGTERM', handleShutdown);
```

### Edge case — no chatId in job data

When `data.chatId` is absent, the worker creates a new chat:

```typescript
const title = createChatTitle({ text: data.message });
const newChat: NewChat = { id: crypto.randomUUID(), userId: data.userId, projectId: data.projectId, title };
const newMessage: NewChatMessage = { id: crypto.randomUUID(), chatId: newChat.id, role: 'user', ... };
await chatQueries.createChat(newChat, newMessage);
```

### Edge case — worker crash before saveAgentResult

The job re-runs. `upsertMessage` ensures the assistant message is written exactly once (idempotent by `messageId`). Partial `message_part` rows from the first run are deleted and re-inserted by `upsertMessage`.

### dev script (apps/backend/package.json)

```json
{
	"scripts": {
		"dev": "npm-run-all -lp dev:server dev:worker",
		"dev:server": "bun --watch src/index.ts",
		"dev:worker": "bun --watch src/workers/worker.ts"
	}
}
```

### supervisord worker block (docker/supervisord.conf)

```ini
[program:worker]
command=/bin/bash -c "exec bun run apps/backend/src/workers/worker.ts"
directory=/app
user=nao
environment=HOME="/home/nao"
autostart=true
autorestart=true
stdout_logfile=/dev/stdout
stdout_logfile_maxbytes=0
stderr_logfile=/dev/stderr
stderr_logfile_maxbytes=0
```

---

## 12. Validation Criteria

1. `tsc --noEmit` passes in `apps/backend` after all files are created/modified.
2. `npm run lint` passes in `apps/backend` (TypeScript + ESLint).
3. `npm test` passes — all existing tests green, new unit tests for `BossService` and `saveAgentResult` pass.
4. Server starts cleanly with SQLite (`bun src/index.ts`) — no pg-boss errors or warnings in stdout.
5. With PostgreSQL, the `pgboss` schema tables appear in the database after the server starts.
6. A manual `POST /api/webhooks/trigger/:triggerId` with a valid token returns `{ jobId }` and a row appears in `pgboss.job`.
7. The worker process picks up the job, runs the agent, and a new `chat_message` row with `role = 'assistant'` appears in the database.

---

## 13. Related Specifications / Further Reading

- [SPEC_BG_AGENTS.md](../SPEC_BG_AGENTS.md) — original spec (narrative format)
- [docs/superpowers/plans/2026-03-31-background-agents.md](../docs/superpowers/plans/2026-03-31-background-agents.md) — prior implementation plan
- [apps/backend/src/services/agent.ts](../apps/backend/src/services/agent.ts) — `AgentManager.generate()` and `stream()` implementations
- [apps/backend/src/queries/chat.queries.ts](../apps/backend/src/queries/chat.queries.ts) — `upsertMessage()`, `createChat()`, `loadChat()`
- [apps/backend/src/services/memory.ts](../apps/backend/src/services/memory.ts) — `safeScheduleMemoryExtraction()`
- [apps/backend/src/trpc/trpc.ts](../apps/backend/src/trpc/trpc.ts) — `adminProtectedProcedure`
- [apps/backend/src/app.ts](../apps/backend/src/app.ts) — server startup/shutdown pattern
- [docker/supervisord.conf](../docker/supervisord.conf) — existing supervisor config
- [pg-boss documentation](https://github.com/timgit/pg-boss)
