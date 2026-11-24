import '../../src/env';

import { beforeAll, describe, expect, it, vi } from 'vitest';

import s from '../../src/db/abstractSchema';
import { db } from '../../src/db/db';
import { deleteExpiredStreams, getStreamChunksAfter, upsertStreamRun } from '../../src/queries/agent-stream.queries';

vi.mock('../../src/db/db', async () => {
	const { createInMemoryDb } = await import('../helpers/in-memory-db');
	return { db: createInMemoryDb() };
});

const HOUR_MS = 60 * 60_000;

describe('deleteExpiredStreams', () => {
	beforeAll(async () => {
		await db.insert(s.user).values({ id: 'user-1', name: 'User', email: 'user@example.com' });
		await db.insert(s.project).values({ id: 'project-1', name: 'Project', type: 'local', path: '/tmp/project' });
		await db.insert(s.chat).values({ id: 'chat-running', projectId: 'project-1', userId: 'user-1' });
	});

	it('keeps the old chunks of a run still going, and clears the ones no run holds anymore', async () => {
		const twoHoursAgo = new Date(Date.now() - 2 * HOUR_MS);
		await upsertStreamRun('chat-running', 'stream-running');
		await db.insert(s.agentStreamChunk).values(
			['stream-running', 'stream-abandoned'].map((streamId) => ({
				streamId,
				seq: 0,
				chunks: [{ type: 'start' }],
				createdAt: twoHoursAgo,
			})),
		);

		await deleteExpiredStreams(HOUR_MS);

		expect(await getStreamChunksAfter('stream-running', -1)).toHaveLength(1);
		expect(await getStreamChunksAfter('stream-abandoned', -1)).toHaveLength(0);
	});
});
