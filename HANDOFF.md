# Chat Error Resilience Handoff

Date: 2026-09-02

## Why this work was started

Users could see a full-page “Can’t reach nao” error after leaving a chat for another page, such as Settings, and then returning.

Three problems were identified:

1. The message was a generic fallback for many unrelated errors.
2. `chat.get` had no automatic retries because the global TanStack Query configuration uses `retry: false`.
3. A failed background refresh replaced an already-loaded chat, even though TanStack still had valid cached data.

## Root cause

TanStack Query distinguishes between:

- An initial load failure with no data: `isLoadingError`.
- A background refresh failure with cached data: `isRefetchError`.

The chat route checked broad `chat.isError`, so both states displayed the full-page error. A brief failed refresh therefore hid valid cached messages.

The chat query can refresh after returning to a stale chat, after an agent finishes, on reconnect or focus when stale, and every 1.5 seconds while an automation is running.

## What was implemented

### Keep usable chats visible

[`apps/frontend/src/lib/chat-error-state.ts`](apps/frontend/src/lib/chat-error-state.ts) decides whether the full-page error is appropriate.

The full-page panel is now shown when:

- The initial load failed and no chat data exists.
- The backend definitively reports `NOT_FOUND`, `UNAUTHORIZED`, or `FORBIDDEN`.

The loaded chat remains visible when a background refresh fails because of a network, timeout, or temporary server error.

Definitive access failures still hide cached data so revoked or invalid access is not accidentally preserved.

[`apps/frontend/src/routes/_sidebar-layout._chat-layout.$chatId.tsx`](apps/frontend/src/routes/_sidebar-layout._chat-layout.$chatId.tsx) now uses that decision and keeps related chat behavior active during non-fatal refresh failures.

### Add fast, selective retries

[`apps/frontend/src/lib/chat-query-retry.ts`](apps/frontend/src/lib/chat-query-retry.ts) defines three retries with delays of:

- 150 ms
- 400 ms
- 1 second

This means one initial request plus up to three retries.

[`apps/frontend/src/queries/use-chat-query.ts`](apps/frontend/src/queries/use-chat-query.ts) applies this policy only to `chat.get`. The global query defaults were intentionally left unchanged.

Retries are allowed for:

- Transport errors without a tRPC code.
- `INTERNAL_SERVER_ERROR`
- `BAD_GATEWAY`
- `SERVICE_UNAVAILABLE`
- `GATEWAY_TIMEOUT`
- `TIMEOUT`

Definitive client, access, missing-resource, conflict, and rate-limit errors are not automatically retried. In particular, `TOO_MANY_REQUESTS` is not retried rapidly because that could worsen rate limiting.

The existing Retry button remains available after automatic attempts are exhausted.

### Improve error messages

[`apps/frontend/src/lib/trpc-error.ts`](apps/frontend/src/lib/trpc-error.ts) now provides shared error classification.

[`apps/frontend/src/components/chat-access-error.tsx`](apps/frontend/src/components/chat-access-error.tsx) distinguishes:

- Network connection failures.
- Timeouts.
- Temporary server failures.
- Rate limiting.
- Unexpected failures.
- Existing not-found, unauthorized, and forbidden states.

Raw backend messages are not displayed because they may contain provider, database, or infrastructure details.

### Tests added

- [`apps/frontend/src/lib/chat-error-state.test.ts`](apps/frontend/src/lib/chat-error-state.test.ts)
- [`apps/frontend/src/lib/chat-query-retry.test.ts`](apps/frontend/src/lib/chat-query-retry.test.ts)
- [`apps/frontend/src/lib/trpc-error.test.ts`](apps/frontend/src/lib/trpc-error.test.ts)

They cover:

- Initial failures displaying the full-page error.
- Background failures retaining the chat.
- Definitive access failures hiding cached data.
- Retry count and delays.
- Retryable and non-retryable tRPC codes.
- User-facing error categories.

## Verification completed

The complete frontend suite passed:

```bash
npm run -w @nao/frontend test
```

Result: 35 test files and 241 tests passed.

The complete TypeScript and ESLint checks passed:

```bash
npm run lint
```

No IDE diagnostics remained in the changed files.

## Suggested manual test

1. Open an existing chat and copy its ID from the URL.
2. In the browser console, run:

```js
const { queryClient, trpc } = await import('/src/main.tsx');
window.chatKey = trpc.chat.get.queryKey({ chatId: 'PASTE_CHAT_ID' });
window.queryClient = queryClient;
```

3. Navigate to Settings.
4. Mark the inactive chat stale without fetching:

```js
await queryClient.invalidateQueries({
	queryKey: chatKey,
	refetchType: 'none',
});
```

5. Set the browser Network panel to Offline.
6. Return to the same chat.

Expected result: the cached chat remains visible instead of being replaced by the full-page error. Restoring the connection should allow the query to continue.

To test an uncached failure, remove the query while on Settings:

```js
queryClient.removeQueries({ queryKey: chatKey });
```

Then return to the chat while `/api/trpc` is blocked. When request blocking is used instead of browser Offline mode, the Network panel should show one initial request and three retries before the categorized error panel appears.

## Deliberately not changed

### Cache lifetime

TanStack’s default inactive-query garbage collection remains unchanged. Increasing `gcTime` would only retain old chat data longer; it would not fix failed requests or incorrect error handling.

### Automatic agent-message resend

The `/api/agent` streaming path was not given automatic resend behavior. Automatically repeating a message after a disconnect could duplicate a request that already reached the server.

### Global retry policy

The application-wide `retry: false` remains unchanged. Only the idempotent `chat.get` query receives retries, keeping the change isolated.

### Backend and database behavior

No backend routes, migrations, or database queries were changed.

## Possible follow-up work

### Add visible non-blocking reconnect status

Background refresh failures currently keep the chat visible silently. A small “Reconnecting…” indicator could improve feedback without replacing the chat.

### Improve stream failure recovery

The separate agent-stream error path still:

- Clears queued messages in `use-agent.ts`.
- Has no direct “Retry last message” action in the inline `ChatError`.
- Invalidates `chat.get` after some disconnect and error outcomes.

A safe next step would be an explicit user-controlled retry action. Automatic resend should require an idempotency mechanism first.

### Isolate automation polling

While an automation runs, `chat.get` reloads the full chat every 1.5 seconds. The backend also calls `failStaleAutomationRuns()` during the automation-status lookup.

A dedicated lightweight automation-status query would reduce database work and isolate polling failures from message loading.

### Add component-level copy tests

The classification and state decisions are tested, but `ChatAccessError` rendering is not directly tested. Component tests could verify the exact title, description, icon, and action for each category.

### Validate real production error shapes

The network classifier covers common browser messages such as `Failed to fetch`, `NetworkError`, and `Load failed`. Production telemetry could confirm whether proxies or supported browsers produce additional safe-to-classify messages.

### Add retry observability

If this remains difficult to diagnose, record retry count, final error category, route, and whether cached data was present. Avoid recording raw error messages or chat contents.

## Current working state

The implementation and tests are present as uncommitted frontend changes. No commit was created.
