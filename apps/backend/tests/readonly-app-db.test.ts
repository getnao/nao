import '../src/env';

import { eq, inArray } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';

import { runScopedAppDbQuery } from '../src/db/readonly-app-db';
import * as sqliteSchema from '../src/db/sqlite-schema';
import {
	chat,
	chatMessage,
	messagePart,
	organization,
	project,
	story,
	storyFeedback,
	user,
} from '../src/db/sqlite-schema';

const db = drizzle('./db.sqlite', { schema: sqliteSchema });

const ORG_ID = 'ro-test-org';
const USER_ID = 'ro-test-user';
const PROJECT_A = 'ro-test-project-a';
const PROJECT_B = 'ro-test-project-b';
const CHAT_IDS = ['ro-chat-a', 'ro-chat-b'];
const MESSAGE_IDS = ['ro-msg-a', 'ro-msg-b'];
const PART_IDS = ['ro-part-a', 'ro-part-b'];
const PART_A_TIME = new Date('2024-06-23T08:15:00Z');
const REVIEWER_ID = 'ro-test-reviewer';
const STORY_IDS = ['ro-story-a', 'ro-story-b'];

async function cleanup() {
	// Child -> parent so the cleanup works even without cascading FKs.
	await db.delete(storyFeedback).where(inArray(storyFeedback.storyId, STORY_IDS));
	await db.delete(story).where(inArray(story.id, STORY_IDS));
	await db.delete(user).where(eq(user.id, REVIEWER_ID));
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
			{ id: 'ro-part-a', messageId: 'ro-msg-a', order: 0, type: 'text', text: 'hello a', createdAt: PART_A_TIME },
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

	it('blocks writes to the underlying tables', async () => {
		await expect(runScopedAppDbQuery(PROJECT_A, "UPDATE chat SET title = 'hacked'")).rejects.toThrow();
		const rows = await db.select().from(chat).where(eq(chat.id, 'ro-chat-a'));
		expect(rows[0].title).toBe('A chat');
	});
});
