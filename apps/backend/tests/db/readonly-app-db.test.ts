import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { runScopedAppDbQuery } from '../../src/db/readonly-app-db';
import {
	chat,
	chatMessage,
	messagePart,
	organization,
	project,
	story,
	storyFeedback,
	testRun,
	testRunResult,
	user,
} from '../../src/db/sqlite-schema';
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
const REVIEWER_ID = 'ro-test-reviewer';

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
		const projectA = await runScopedAppDbQuery(PROJECT_A, 'SELECT chat_id, title FROM v_messages');
		const projectB = await runScopedAppDbQuery(PROJECT_B, 'SELECT chat_id FROM v_messages');

		expect(projectA.rows.map((r) => r.chat_id)).toEqual(['ro-chat-a']);
		expect(projectB.rows.map((r) => r.chat_id)).toEqual(['ro-chat-b']);
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

	it('exposes story feedback scoped to the story project, with the owner and the reviewer', async () => {
		await db.insert(user).values({ id: REVIEWER_ID, name: 'Reviewer', email: 'reviewer@example.com' });
		await db.insert(story).values([
			{ id: 'ro-story-a', chatId: 'ro-chat-a', slug: 'a', title: 'Chat story' },
			{ id: 'ro-story-b', projectId: PROJECT_B, userId: USER_ID, slug: 'b', title: 'Standalone story' },
		]);
		await db.insert(storyFeedback).values([
			{ storyId: 'ro-story-a', userId: REVIEWER_ID, vote: 'down', explanation: 'Wrong totals' },
			{ storyId: 'ro-story-b', userId: REVIEWER_ID, vote: 'up' },
		]);

		const projectA = await runScopedAppDbQuery(
			PROJECT_A,
			'SELECT story_id, story_title, story_owner_name, user_name, vote, explanation FROM v_story_feedback',
		);
		const projectB = await runScopedAppDbQuery(PROJECT_B, 'SELECT story_id, vote FROM v_story_feedback');

		expect(projectA.rows).toEqual([
			{
				story_id: 'ro-story-a',
				story_title: 'Chat story',
				story_owner_name: 'RO',
				user_name: 'Reviewer',
				vote: 'down',
				explanation: 'Wrong totals',
			},
		]);
		expect(projectB.rows).toEqual([{ story_id: 'ro-story-b', vote: 'up' }]);
	});

	it('exposes test runs and their results scoped to the project', async () => {
		const model = { provider: 'openai' as const, modelId: 'gpt-5' };
		await db.insert(testRun).values([
			{ id: 'ro-run-a', projectId: PROJECT_A, triggeredByUserId: USER_ID, status: 'completed', models: [model] },
			{ id: 'ro-run-b', projectId: PROJECT_B, status: 'completed', models: [model] },
		]);
		const result = { testHash: 'hash', llmProvider: 'openai' as const, llmModelId: 'gpt-5', attempt: 1 };
		await db.insert(testRunResult).values([
			{ ...result, runId: 'ro-run-a', testPath: 'tests/a.yml', testName: 'A', passed: true, message: 'ok' },
			{ ...result, runId: 'ro-run-b', testPath: 'tests/b.yml', testName: 'B', passed: false, message: 'ko' },
		]);

		const runs = await runScopedAppDbQuery(
			PROJECT_A,
			'SELECT id, trigger, status, triggered_by_user_name FROM v_test_runs',
		);
		const results = await runScopedAppDbQuery(
			PROJECT_A,
			'SELECT run_id, run_trigger, test_path, llm_model_id, passed FROM v_test_results',
		);

		expect(runs.rows).toEqual([
			{ id: 'ro-run-a', trigger: 'manual', status: 'completed', triggered_by_user_name: 'RO' },
		]);
		expect(results.rows).toEqual([
			{ run_id: 'ro-run-a', run_trigger: 'manual', test_path: 'tests/a.yml', llm_model_id: 'gpt-5', passed: 1 },
		]);
	});

	it('blocks writes to the underlying tables', async () => {
		await expect(runScopedAppDbQuery(PROJECT_A, "UPDATE chat SET title = 'hacked'")).rejects.toThrow();
		const rows = await db.select().from(chat).where(eq(chat.id, 'ro-chat-a'));
		expect(rows[0].title).toBe('A chat');
	});
});
