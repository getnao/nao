import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { queryAppDb } from '../../src/agents/tools/query-app-db';
import { chat, chatMessage, messagePart, organization, project, user } from '../../src/db/sqlite-schema';
import { explainAppDbError } from '../../src/utils/app-db-errors';
import { getTemporaryFileDb, removeTemporaryFileDb } from '../helpers/in-memory-db';

vi.mock('../../src/db/dbConfig', async (importOriginal) => {
	const actual = await importOriginal<typeof import('../../src/db/dbConfig')>();
	const { getTemporaryFileDb } = await import('../helpers/in-memory-db');
	return { ...actual, default: { ...actual.default, dbUrl: getTemporaryFileDb().path } };
});

const { db } = getTemporaryFileDb();

const ORG_ID = 'q-org';
const USER_ID = 'q-user';
const PROJECT_ID = 'q-project';

describe('queryAppDb', () => {
	beforeAll(async () => {
		await db.insert(organization).values({ id: ORG_ID, name: 'Q', slug: 'q-org' });
		await db.insert(user).values({ id: USER_ID, name: 'Q', email: 'q@example.com' });
		await db.insert(project).values({ id: PROJECT_ID, orgId: ORG_ID, name: 'Q', type: 'local', path: '/tmp/q' });
		await db.insert(chat).values({ id: 'q-chat', userId: USER_ID, projectId: PROJECT_ID, title: 'hi' });
		await db.insert(chatMessage).values({ id: 'q-msg', chatId: 'q-chat', role: 'user' });
		await db.insert(messagePart).values({ id: 'q-part', messageId: 'q-msg', order: 0, type: 'text', text: 'hi' });
	});

	afterAll(removeTemporaryFileDb);

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

describe('explainAppDbError', () => {
	it('tells the model how timestamps are stored when it compares one to an epoch', () => {
		const explained = explainAppDbError(
			new Error('operator does not exist: timestamp without time zone >= integer'),
		);
		expect(explained).toContain('not Unix epochs');
		expect(explained).toContain("date_trunc('day', created_at)");
	});

	it('adds the same hint when the model converts a timestamp with to_timestamp', () => {
		const explained = explainAppDbError(
			new Error('function to_timestamp(timestamp without time zone) does not exist'),
		);
		expect(explained).toContain('not Unix epochs');
	});

	it('leaves unrelated errors untouched', () => {
		expect(explainAppDbError(new Error('column "nope" does not exist'))).toBe('column "nope" does not exist');
	});
});
