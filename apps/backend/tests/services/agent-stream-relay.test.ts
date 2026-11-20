import '../../src/env';

import { beforeAll, describe, expect, it, vi } from 'vitest';

import s from '../../src/db/abstractSchema';
import { db } from '../../src/db/db';
import type { DatabaseNotifications } from '../../src/db/postgres-notifications';
import { getLiveStreamId } from '../../src/queries/agent-stream.queries';
import {
	AgentStreamRelay,
	type AgentStreamRelayTimings,
	INTERRUPTED_RUN_MESSAGE,
	type UIMessageChunk,
} from '../../src/services/agent-stream-relay';
import { ChunkBuffer } from '../../src/utils/chunk-buffer';

vi.mock('../../src/db/db', async () => {
	const { createInMemoryDb } = await import('../helpers/in-memory-db');
	return { db: createInMemoryDb() };
});
vi.mock('../../src/utils/logger', () => import('../helpers/logger-mock'));

const TIMINGS: AgentStreamRelayTimings = {
	flushIntervalMs: 5,
	heartbeatIntervalMs: 20,
	heartbeatTtlMs: 200,
	readPollMs: 20,
	chunkRetentionMs: 50,
	sweepIntervalMs: 2 ** 31 - 1,
};

const START: UIMessageChunk = { type: 'start', messageId: 'assistant-message' };
const TEXT: UIMessageChunk = { type: 'text-delta', id: 'text-1', delta: 'Revenue grew.' };
const FINISH: UIMessageChunk = { type: 'finish' };

describe('AgentStreamRelay', () => {
	beforeAll(async () => {
		await db.insert(s.user).values({ id: 'user-1', name: 'User', email: 'user@example.com' });
		await db.insert(s.project).values({ id: 'project-1', name: 'Project', type: 'local', path: '/tmp/project' });
		await db.insert(s.chat).values(
			['chat-relayed', 'chat-relay-failed', 'chat-replaced', 'chat-ended', 'chat-stale', 'chat-stopped'].map(
				(id) => ({
					id,
					projectId: 'project-1',
					userId: 'user-1',
				}),
			),
		);
	});

	it('lets a reader on another instance replay the run and follow it to the end', async () => {
		const { runningInstance, readingInstance } = createInstances();
		const buffer = new ChunkBuffer<UIMessageChunk>();
		buffer.push(START);
		const published = await runningInstance.publish('chat-relayed', 'stream-relayed', buffer);

		expect(await readingInstance.listLiveChatIds('user-1')).toEqual(['chat-relayed']);
		expect(await readingInstance.listLiveChatIds('user-2')).toEqual([]);

		const stream = await readingInstance.read('chat-relayed');
		const reading = Array.fromAsync(stream!);
		buffer.push(TEXT);
		buffer.push(FINISH);
		buffer.close();

		expect(await reading).toEqual([START, TEXT, FINISH]);
		await published.end();
	});

	it('picks the relay up where it failed, so the reader still gets the whole run', async () => {
		const { runningInstance, readingInstance } = createInstances({ failingChunkNotifications: 1 });
		const buffer = new ChunkBuffer<UIMessageChunk>();
		buffer.push(START);
		const published = await runningInstance.publish('chat-relay-failed', 'stream-relay-failed', buffer);

		const stream = await readingInstance.read('chat-relay-failed');
		const reading = Array.fromAsync(stream!);
		await new Promise((resolve) => setTimeout(resolve, TIMINGS.readPollMs * 3));
		buffer.push(TEXT);
		buffer.push(FINISH);
		buffer.close();
		await published.end();

		expect(await reading).toEqual([START, TEXT, FINISH]);
	});

	it('leaves the chat to its newer run when the run it replaced ends', async () => {
		const { runningInstance } = createInstances();
		const buffers = [new ChunkBuffer<UIMessageChunk>(), new ChunkBuffer<UIMessageChunk>()];
		const replaced = await runningInstance.publish('chat-replaced', 'stream-replaced', buffers[0]);
		const newer = await runningInstance.publish('chat-replaced', 'stream-newer', buffers[1]);

		buffers[0].close();
		await replaced.end();
		expect(await getLiveStreamId('chat-replaced', TIMINGS.heartbeatTtlMs)).toBe('stream-newer');

		buffers[1].close();
		await newer.end();
	});

	it('has no stream for a chat without a live run, including one whose run ended', async () => {
		const { runningInstance, readingInstance } = createInstances();
		const buffer = new ChunkBuffer<UIMessageChunk>();
		const published = await runningInstance.publish('chat-ended', 'stream-ended', buffer);
		buffer.close();
		await published.end();

		expect(await readingInstance.read('chat-ended')).toBeNull();
		expect(await readingInstance.listLiveChatIds('user-1')).not.toContain('chat-ended');
		expect(await readingInstance.read('chat-without-run')).toBeNull();
	});

	it('ends the reader stream with an error when the instance running the run stops beating', async () => {
		const { runningInstance, readingInstance } = createInstances({ runningHeartbeatIntervalMs: 60_000 });
		const buffer = new ChunkBuffer<UIMessageChunk>();
		buffer.push(START);
		const published = await runningInstance.publish('chat-stale', 'stream-stale', buffer);

		const stream = await readingInstance.read('chat-stale');

		expect(await Array.fromAsync(stream!)).toEqual([START, { type: 'error', errorText: INTERRUPTED_RUN_MESSAGE }]);
		buffer.close();
		await published.end();
	});

	it('asks the instance running the run to stop it', async () => {
		const { runningInstance, readingInstance, stopOnRunningInstance } = createInstances();
		const buffer = new ChunkBuffer<UIMessageChunk>();
		const published = await runningInstance.publish('chat-stopped', 'stream-stopped', buffer);

		expect(await readingInstance.requestStop('chat-stopped')).toBe(true);
		await vi.waitFor(() => expect(stopOnRunningInstance).toHaveBeenCalledWith('chat-stopped'));

		buffer.close();
		await published.end();
		expect(await readingInstance.requestStop('chat-stopped')).toBe(false);
	});
});

/** Two backend instances sharing one database and one notification bus. */
function createInstances({
	runningHeartbeatIntervalMs = TIMINGS.heartbeatIntervalMs,
	failingChunkNotifications = 0,
} = {}) {
	const listeners = new Map<string, Set<(payload: string) => void>>();
	let chunkNotificationsToFail = failingChunkNotifications;
	const notifications: DatabaseNotifications = {
		listen: async (channel, onNotify) => {
			listeners.set(channel, (listeners.get(channel) ?? new Set()).add(onNotify));
		},
		notify: async (channel, payload) => {
			if (channel === 'agent_stream_chunks' && chunkNotificationsToFail > 0) {
				chunkNotificationsToFail--;
				throw new Error('Notification failed');
			}
			setTimeout(() => listeners.get(channel)?.forEach((onNotify) => onNotify(payload)));
		},
	};
	const stopOnRunningInstance = vi.fn();
	const runningInstance = new AgentStreamRelay(notifications, stopOnRunningInstance, {
		...TIMINGS,
		heartbeatIntervalMs: runningHeartbeatIntervalMs,
	});
	const readingInstance = new AgentStreamRelay(notifications, vi.fn(), TIMINGS);
	return { runningInstance, readingInstance, stopOnRunningInstance };
}
