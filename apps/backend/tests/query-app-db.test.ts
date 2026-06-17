import '../src/env';

import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';

import { queryAppDb } from '../src/agents/tools/query-app-db';
import * as sqliteSchema from '../src/db/sqlite-schema';
import { chat, chatMessage, messagePart, organization, project, user } from '../src/db/sqlite-schema';

const db = drizzle('./db.sqlite', { schema: sqliteSchema });

const ORG_ID = 'q-org';
const USER_ID = 'q-user';
const PROJECT_ID = 'q-project';

async function cleanup() {
	await db.delete(messagePart).where(eq(messagePart.id, 'q-part'));
	await db.delete(chatMessage).where(eq(chatMessage.id, 'q-msg'));
	await db.delete(chat).where(eq(chat.id, 'q-chat'));
	await db.delete(project).where(eq(project.id, PROJECT_ID));
	await db.delete(organization).where(eq(organization.id, ORG_ID));
	await db.delete(user).where(eq(user.id, USER_ID));
}

describe('queryAppDb', () => {
	beforeEach(async () => {
		await cleanup();
		await db.insert(organization).values({ id: ORG_ID, name: 'Q', slug: 'q-org' });
		await db.insert(user).values({ id: USER_ID, name: 'Q', email: 'q@example.com' });
		await db.insert(project).values({ id: PROJECT_ID, orgId: ORG_ID, name: 'Q', type: 'local', path: '/tmp/q' });
		await db.insert(chat).values({ id: 'q-chat', userId: USER_ID, projectId: PROJECT_ID, title: 'hi' });
		await db.insert(chatMessage).values({ id: 'q-msg', chatId: 'q-chat', role: 'user' });
		await db.insert(messagePart).values({ id: 'q-part', messageId: 'q-msg', order: 0, type: 'text', text: 'hi' });
	});

	afterEach(cleanup);

	afterAll(() => db.$client.close());

	it('runs an allowlisted read-only query', async () => {
		const out = await queryAppDb(PROJECT_ID, 'SELECT chat_id FROM v_messages');
		expect(out.rowCount).toBe(1);
		expect(out.rows[0].chat_id).toBe('q-chat');
	});

	it('rejects a write', async () => {
		await expect(queryAppDb(PROJECT_ID, 'DELETE FROM v_messages')).rejects.toThrow(/read-only/i);
	});

	it('rejects a base table', async () => {
		await expect(queryAppDb(PROJECT_ID, 'SELECT * FROM chat')).rejects.toThrow(/allowlist/i);
	});

	it('rejects an auth table', async () => {
		await expect(queryAppDb(PROJECT_ID, 'SELECT * FROM account')).rejects.toThrow(/allowlist/i);
	});
});
