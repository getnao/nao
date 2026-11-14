import '../../src/env';

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import s from '../../src/db/abstractSchema';
import { db } from '../../src/db/db';
import { getContextFileReads } from '../../src/queries/context-file-reads.queries';

vi.mock('../../src/db/db', async () => {
	const { createInMemoryDb } = await import('../helpers/in-memory-db');
	return { db: createInMemoryDb() };
});

const PROJECT_ID = 'reads-project';
const OTHER_PROJECT_ID = 'reads-other-project';
const USER_ID = 'reads-user';
const SINCE = new Date('2026-10-01T00:00:00Z');
const RECENT = new Date('2026-10-15T00:00:00Z');

interface ReadPart {
	chatId: string;
	filePath: string;
	toolName?: string;
	toolState?: string;
	createdAt?: Date;
	isForked?: boolean;
	source?: 'test';
}

describe('getContextFileReads', () => {
	beforeAll(seedReads);

	afterAll(() => {
		db.$client.close();
	});

	it('counts the reads and chats of each file in users’ chats since the date, most read first', async () => {
		expect(await getContextFileReads(PROJECT_ID, SINCE, 10)).toEqual([
			{ filePath: 'RULES.md', readCount: 3 },
			{ filePath: '/docs/orders.md', readCount: 1 },
		]);
	});

	it('keeps the most read files up to the limit', async () => {
		expect(await getContextFileReads(PROJECT_ID, SINCE, 1)).toEqual([{ filePath: 'RULES.md', readCount: 3 }]);
	});
});

async function seedReads() {
	await db.insert(s.user).values({ id: USER_ID, name: 'Reader', email: 'reader@example.com' });
	await db.insert(s.project).values([
		{ id: PROJECT_ID, name: 'Reads', type: 'local', path: '/tmp/reads' },
		{ id: OTHER_PROJECT_ID, name: 'Other', type: 'local', path: '/tmp/other' },
	]);
	await db.insert(s.chat).values([
		{ id: 'chat-a', userId: USER_ID, projectId: PROJECT_ID },
		{ id: 'chat-b', userId: USER_ID, projectId: PROJECT_ID },
		{ id: 'chat-test', userId: USER_ID, projectId: PROJECT_ID },
		{ id: 'chat-analysis', userId: USER_ID, projectId: PROJECT_ID },
		{ id: 'chat-other', userId: USER_ID, projectId: OTHER_PROJECT_ID },
	]);
	await db.insert(s.contextRecommendationRun).values({ projectId: PROJECT_ID, chatId: 'chat-analysis' });

	const parts: ReadPart[] = [
		{ chatId: 'chat-a', filePath: 'RULES.md' },
		{ chatId: 'chat-a', filePath: 'RULES.md' },
		{ chatId: 'chat-b', filePath: 'RULES.md' },
		{ chatId: 'chat-b', filePath: '/docs/orders.md' },
		{ chatId: 'chat-b', filePath: '/docs/old.md', createdAt: new Date('2026-09-01T00:00:00Z') },
		{ chatId: 'chat-b', filePath: '/docs/failed.md', toolState: 'output-error' },
		{ chatId: 'chat-b', filePath: '/docs/grepped.md', toolName: 'grep' },
		{ chatId: 'chat-b', filePath: '/docs/forked.md', isForked: true },
		{ chatId: 'chat-test', filePath: '/docs/test.md', source: 'test' },
		{ chatId: 'chat-analysis', filePath: '/docs/analysis.md' },
		{ chatId: 'chat-other', filePath: '/docs/other.md' },
	];
	for (const [index, part] of parts.entries()) {
		await insertReadPart(`part-${index}`, part);
	}
}

async function insertReadPart(id: string, part: ReadPart) {
	const toolName = part.toolName ?? 'read';
	await db.insert(s.chatMessage).values({
		id,
		chatId: part.chatId,
		role: 'assistant',
		isForked: part.isForked,
		source: part.source,
	} as typeof s.chatMessage.$inferInsert);
	await db.insert(s.messagePart).values({
		messageId: id,
		order: 0,
		type: `tool-${toolName}`,
		toolName,
		toolCallId: `${id}-call`,
		toolState: part.toolState ?? 'output-available',
		toolInput: { file_path: part.filePath },
		createdAt: part.createdAt ?? RECENT,
	} as typeof s.messagePart.$inferInsert);
}
