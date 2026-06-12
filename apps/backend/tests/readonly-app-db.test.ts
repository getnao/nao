import '../src/env';

import { eq, inArray } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';

import { runScopedAppDbQuery } from '../src/db/readonly-app-db';
import * as sqliteSchema from '../src/db/sqlite-schema';
import { chat, chatMessage, messagePart, organization, project, user } from '../src/db/sqlite-schema';

const db = drizzle('./db.sqlite', { schema: sqliteSchema });

const ORG_ID = 'ro-test-org';
const USER_ID = 'ro-test-user';
const PROJECT_A = 'ro-test-project-a';
const PROJECT_B = 'ro-test-project-b';
const CHAT_IDS = ['ro-chat-a', 'ro-chat-b'];
const MESSAGE_IDS = ['ro-msg-a', 'ro-msg-b'];
const PART_IDS = ['ro-part-a', 'ro-part-b'];

async function cleanup() {
	// Child -> parent so the cleanup works even without cascading FKs.
	await db.delete(messagePart).where(inArray(messagePart.id, PART_IDS));
	await db.delete(chatMessage).where(inArray(chatMessage.id, MESSAGE_IDS));
	await db.delete(chat).where(inArray(chat.id, CHAT_IDS));
	await db.delete(project).where(inArray(project.id, [PROJECT_A, PROJECT_B]));
	await db.delete(organization).where(eq(organization.id, ORG_ID));
	await db.delete(user).where(eq(user.id, USER_ID));
}

describe('runScopedAppDbQuery', () => {
	beforeEach(async () => {
		await cleanup();
		await db.insert(organization).values({ id: ORG_ID, name: 'RO', slug: 'ro-test-org' });
		await db.insert(user).values({ id: USER_ID, name: 'RO', email: 'ro@example.com' });
		await db.insert(project).values([
			{ id: PROJECT_A, orgId: ORG_ID, name: 'A', type: 'local', path: '/tmp/ro-a' },
			{ id: PROJECT_B, orgId: ORG_ID, name: 'B', type: 'local', path: '/tmp/ro-b' },
		]);
		await db.insert(chat).values([
			{ id: 'ro-chat-a', userId: USER_ID, projectId: PROJECT_A, title: 'A chat' },
			{ id: 'ro-chat-b', userId: USER_ID, projectId: PROJECT_B, title: 'B chat' },
		]);
		await db.insert(chatMessage).values([
			{ id: 'ro-msg-a', chatId: 'ro-chat-a', role: 'user' },
			{ id: 'ro-msg-b', chatId: 'ro-chat-b', role: 'user' },
		]);
		await db.insert(messagePart).values([
			{ id: 'ro-part-a', messageId: 'ro-msg-a', order: 0, type: 'text', text: 'hello a' },
			{ id: 'ro-part-b', messageId: 'ro-msg-b', order: 0, type: 'text', text: 'hello b' },
		]);
	});

	afterEach(cleanup);

	afterAll(() => {
		db.$client.close();
	});

	it('returns only the scoped project rows', async () => {
		const { rows } = await runScopedAppDbQuery(PROJECT_A, 'SELECT chat_id, title FROM v_messages');
		expect(rows.map((r) => r.chat_id)).toEqual(['ro-chat-a']);
	});

	it('does not leak another project', async () => {
		const { rows } = await runScopedAppDbQuery(PROJECT_B, 'SELECT chat_id FROM v_messages');
		expect(rows.map((r) => r.chat_id)).toEqual(['ro-chat-b']);
	});

	it('does not expose PII columns (email is not on the view)', async () => {
		await expect(runScopedAppDbQuery(PROJECT_A, 'SELECT email FROM v_messages')).rejects.toThrow();
	});

	it('blocks writes to the underlying tables', async () => {
		await expect(runScopedAppDbQuery(PROJECT_A, "UPDATE chat SET title = 'hacked'")).rejects.toThrow();
		const rows = await db.select().from(chat).where(eq(chat.id, 'ro-chat-a'));
		expect(rows[0].title).toBe('A chat');
	});
});
