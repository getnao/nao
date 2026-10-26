import '../src/env';

import { eq, inArray } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { db as appDb } from '../src/db/db';
import * as sqliteSchema from '../src/db/sqlite-schema';
import { chat, chatMessage, project, user } from '../src/db/sqlite-schema';
import { listProjectChats } from '../src/queries/project.queries';

vi.mock('../src/db/db', async () => {
	const { drizzle } = await import('drizzle-orm/better-sqlite3');
	const schema = await import('../src/db/sqlite-schema');
	return { db: drizzle('./db.sqlite', { schema }) };
});

const db = drizzle('./db.sqlite', { schema: sqliteSchema });
const projectId = 'project-chats-filters-project';
const userIds = ['project-chats-filters-alice', 'project-chats-filters-bob'];
const chatIds = ['project-chats-filters-short', 'project-chats-filters-long'];

async function cleanup() {
	await db.delete(chatMessage).where(inArray(chatMessage.chatId, chatIds));
	await db.delete(chat).where(inArray(chat.id, chatIds));
	await db.delete(project).where(eq(project.id, projectId));
	await db.delete(user).where(inArray(user.id, userIds));
}

describe('listProjectChats author and message count filters', () => {
	beforeEach(async () => {
		await cleanup();
		await db.insert(user).values([
			{ id: userIds[0], name: 'Alice Martin', email: 'alice@acme.test' },
			{ id: userIds[1], name: 'Bob Stone', email: 'bob@globex.test' },
		]);
		await db
			.insert(project)
			.values({ id: projectId, name: 'Chat filters', type: 'local', path: '/tmp/chat-filters' });
		await db.insert(chat).values([
			{ id: chatIds[0], userId: userIds[0], projectId, title: 'Short chat' },
			{ id: chatIds[1], userId: userIds[1], projectId, title: 'Long chat' },
		]);
		await db.insert(chatMessage).values([...buildMessages(chatIds[0], 2), ...buildMessages(chatIds[1], 6)]);
	});

	afterEach(cleanup);

	afterAll(() => {
		appDb.$client.close();
		db.$client.close();
	});

	it('matches the author by a case-insensitive part of their name', async () => {
		const { chats } = await listProjectChats(projectId, { author: 'MARTIN' });

		expect(chats.map(({ id }) => id)).toEqual([chatIds[0]]);
	});

	it('matches the author by a part of their email', async () => {
		const { chats } = await listProjectChats(projectId, { author: 'globex' });

		expect(chats.map(({ id }) => id)).toEqual([chatIds[1]]);
	});

	it('keeps chats within the message count bounds', async () => {
		const atLeastThree = await listProjectChats(projectId, { messageCount: { min: 3 } });
		const atMostThree = await listProjectChats(projectId, { messageCount: { max: 3 } });

		expect(atLeastThree.chats.map(({ id }) => id)).toEqual([chatIds[1]]);
		expect(atLeastThree.total).toBe(1);
		expect(atMostThree.chats.map(({ id }) => id)).toEqual([chatIds[0]]);
	});
});

function buildMessages(chatId: string, count: number) {
	return Array.from({ length: count }, (_, index) => ({
		id: `${chatId}-message-${index}`,
		chatId,
		role: index % 2 === 0 ? ('user' as const) : ('assistant' as const),
	}));
}
