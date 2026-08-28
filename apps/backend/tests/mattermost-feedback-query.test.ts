import '../src/env';

import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import s from '../src/db/abstractSchema';
import { db } from '../src/db/db';
import { isAssistantMessageInProject } from '../src/queries/chat.queries';
import { deleteFeedbackVote, upsertFeedback } from '../src/queries/feedback.queries';

vi.mock('../src/db/db', async () => {
	const { default: Database } = await import('better-sqlite3');
	const { drizzle } = await import('drizzle-orm/better-sqlite3');
	const { generateSQLiteDrizzleJson, generateSQLiteMigration } = await import('drizzle-kit/api');
	const sqliteSchema = await import('../src/db/sqlite-schema');

	const sqlite = new Database(':memory:');
	const statements = await generateSQLiteMigration(
		await generateSQLiteDrizzleJson({}),
		await generateSQLiteDrizzleJson(sqliteSchema),
	);
	for (const statement of statements) {
		sqlite.exec(statement);
	}
	sqlite.pragma('foreign_keys = ON');

	return { db: drizzle(sqlite, { schema: sqliteSchema }) };
});

const SOURCE_PROJECT_ID = 'mattermost-source-project';
const OTHER_PROJECT_ID = 'mattermost-other-project';
const ASSISTANT_MESSAGE_ID = 'mattermost-assistant-message';

describe('Mattermost feedback query', () => {
	beforeAll(async () => {
		await db.insert(s.user).values({
			id: 'mattermost-feedback-user',
			name: 'Mattermost Feedback User',
			email: 'mattermost-feedback@example.com',
		});
		await db.insert(s.project).values([
			{
				id: SOURCE_PROJECT_ID,
				name: 'Mattermost Source Project',
				type: 'local',
				path: '/tmp/mattermost-source-project',
			},
			{
				id: OTHER_PROJECT_ID,
				name: 'Mattermost Other Project',
				type: 'local',
				path: '/tmp/mattermost-other-project',
			},
		]);
		await db.insert(s.chat).values([
			{
				id: 'mattermost-source-chat',
				projectId: SOURCE_PROJECT_ID,
				userId: 'mattermost-feedback-user',
			},
			{
				id: 'mattermost-other-chat',
				projectId: OTHER_PROJECT_ID,
				userId: 'mattermost-feedback-user',
			},
		]);
		await db.insert(s.chatMessage).values({
			id: ASSISTANT_MESSAGE_ID,
			chatId: 'mattermost-source-chat',
			role: 'assistant',
		});
	});

	beforeEach(async () => {
		await db.delete(s.messageFeedback);
	});

	afterAll(() => {
		db.$client.close();
	});

	it('only accepts an assistant message from the configured project', async () => {
		await expect(isAssistantMessageInProject(ASSISTANT_MESSAGE_ID, SOURCE_PROJECT_ID)).resolves.toBe(true);
		await expect(isAssistantMessageInProject(ASSISTANT_MESSAGE_ID, OTHER_PROJECT_ID)).resolves.toBe(false);
	});

	it.each([
		['up', 'up'],
		['down', 'down'],
	] as const)('persists a %s vote through message_feedback', async (_name, vote) => {
		await upsertFeedback({ messageId: ASSISTANT_MESSAGE_ID, vote });

		const [feedback] = await db
			.select()
			.from(s.messageFeedback)
			.where(eq(s.messageFeedback.messageId, ASSISTANT_MESSAGE_ID));
		expect(feedback?.vote).toBe(vote);
	});

	it('deletes a matching reaction vote', async () => {
		await upsertFeedback({ messageId: ASSISTANT_MESSAGE_ID, vote: 'up' });
		await deleteFeedbackVote(ASSISTANT_MESSAGE_ID, 'up');

		const feedback = await db
			.select()
			.from(s.messageFeedback)
			.where(eq(s.messageFeedback.messageId, ASSISTANT_MESSAGE_ID));
		expect(feedback).toEqual([]);
	});
});
