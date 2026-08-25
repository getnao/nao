import '../src/env';

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import s from '../src/db/abstractSchema';
import { db } from '../src/db/db';
import { getAssistantMessageIdByMattermostPost } from '../src/queries/chat.queries';

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
const MATTERMOST_POST_ID = 'mattermost-post';
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
			mattermostPostId: MATTERMOST_POST_ID,
		});
	});

	afterAll(() => {
		db.$client.close();
	});

	it('only returns the assistant message for its project', async () => {
		await expect(getAssistantMessageIdByMattermostPost(MATTERMOST_POST_ID, SOURCE_PROJECT_ID)).resolves.toBe(
			ASSISTANT_MESSAGE_ID,
		);
		await expect(getAssistantMessageIdByMattermostPost(MATTERMOST_POST_ID, OTHER_PROJECT_ID)).resolves.toBeNull();
	});
});
