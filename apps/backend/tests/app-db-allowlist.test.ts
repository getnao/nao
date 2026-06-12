import { describe, expect, it } from 'vitest';

import { validateAppDbQuery } from '../src/utils/app-db-allowlist';

describe('validateAppDbQuery', () => {
	it('allows a SELECT over an allowlisted view', async () => {
		expect((await validateAppDbQuery('SELECT chat_id FROM v_messages')).ok).toBe(true);
	});

	it('allows a JOIN across allowlisted views', async () => {
		const sql = 'SELECT m.chat_id FROM v_messages m JOIN v_memories mem ON mem.chat_id = m.chat_id';
		expect((await validateAppDbQuery(sql)).ok).toBe(true);
	});

	it('allows a CTE over allowlisted views', async () => {
		const sql = 'WITH t AS (SELECT chat_id FROM v_messages) SELECT * FROM t';
		expect((await validateAppDbQuery(sql)).ok).toBe(true);
	});

	it('rejects a write', async () => {
		expect((await validateAppDbQuery("UPDATE v_messages SET title = 'x'")).ok).toBe(false);
	});

	it('rejects a base table (not a view)', async () => {
		const res = await validateAppDbQuery('SELECT * FROM chat');
		expect(res.ok).toBe(false);
		expect(res.reason).toContain('chat');
	});

	it('rejects an auth/PII table', async () => {
		expect((await validateAppDbQuery('SELECT password FROM account')).ok).toBe(false);
	});

	it('rejects unparseable SQL', async () => {
		expect((await validateAppDbQuery('SELECT FROM WHERE )(')).ok).toBe(false);
	});
});
