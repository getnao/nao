import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { runScopedAppDbQuery } from '../../src/db/readonly-app-db';
import { chat, chatMessage, messagePart, organization, project, user } from '../../src/db/sqlite-schema';
import { getTemporaryFileDb, removeTemporaryFileDb } from '../helpers/in-memory-db';

vi.mock('../../src/db/dbConfig', async (importOriginal) => {
	const actual = await importOriginal<typeof import('../../src/db/dbConfig')>();
	const { getTemporaryFileDb } = await import('../helpers/in-memory-db');
	return { ...actual, default: { ...actual.default, dbUrl: getTemporaryFileDb().path } };
});

const { db } = getTemporaryFileDb();

const ORG_ID = 'ro-test-org';
const USER_ID = 'ro-test-user';
const PROJECT_A = 'ro-test-project-a';
const PROJECT_B = 'ro-test-project-b';
const PART_A_TIME = new Date('2024-06-23T08:15:00Z');

describe('runScopedAppDbQuery', () => {
	beforeAll(async () => {
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
			{ id: 'ro-part-a', messageId: 'ro-msg-a', order: 0, type: 'text', text: 'hello a', createdAt: PART_A_TIME },
			{ id: 'ro-part-b', messageId: 'ro-msg-b', order: 0, type: 'text', text: 'hello b' },
		]);
	});

	afterAll(removeTemporaryFileDb);

	it('returns only the scoped project rows', async () => {
		const { rows } = await runScopedAppDbQuery(PROJECT_A, 'SELECT chat_id, title FROM v_messages');
		expect(rows.map((r) => r.chat_id)).toEqual(['ro-chat-a']);
	});

	it('exposes timestamps as datetimes the date functions accept', async () => {
		const { rows } = await runScopedAppDbQuery(
			PROJECT_A,
			"SELECT date(created_at) AS day FROM v_messages WHERE created_at >= datetime('2024-06-01')",
		);
		expect(rows).toEqual([{ day: '2024-06-23' }]);
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
