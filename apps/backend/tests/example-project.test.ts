import { LOCAL_DATABASE_ID } from '@nao/shared/tools';
import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, it, vi } from 'vitest';

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

import s from '../src/db/abstractSchema';
import { db } from '../src/db/db';
import { JAFFLE_SHOP_STORY } from '../src/fixtures/jaffle-shop-story';
import {
	SYSTEM_EXAMPLE_CHAT_ID,
	SYSTEM_EXAMPLE_STORY_ID,
	SYSTEM_EXAMPLE_USER_ID,
	upsertSystemExampleStory,
} from '../src/queries/example-story.queries';
import { getLatestSqlQueryDataByIds } from '../src/queries/execute-sql.queries';
import { upsertSystemExampleProject } from '../src/queries/project.queries';
import { upsertSystemExampleSavedPrompts } from '../src/queries/project-saved-prompt.queries';

describe('system example project', () => {
	afterAll(() => db.$client.close());

	it('upserts the project with one fully granted default group', async () => {
		await upsertSystemExampleProject('/tmp/example-a');
		const stored = await upsertSystemExampleProject('/tmp/example-b');
		const groups = await db.select().from(s.userGroup).where(eq(s.userGroup.projectId, 'system-example-project'));

		expect(stored).toMatchObject({ id: 'system-example-project', path: '/tmp/example-b' });
		expect(groups).toHaveLength(1);
		expect(groups[0]).toMatchObject({
			name: 'All Users',
			isDefault: true,
			featureGrants: {
				version: 2,
				features: ['storyCreation', 'customStoryCreation', 'automationCreation'],
			},
			contextGrants: {
				version: 6,
				databaseAccess: { mode: 'all', strict: false },
				docsAccess: { mode: 'all' },
				mcpAccess: { mode: 'all' },
			},
		});
	});

	it('upserts one pinned Jaffle Shop story owned by the system user', async () => {
		await upsertSystemExampleProject('/tmp/example');
		await upsertSystemExampleStory();
		await upsertSystemExampleStory();

		const [users, chats, stories, versions, shares, parts] = await Promise.all([
			db.select().from(s.user).where(eq(s.user.id, SYSTEM_EXAMPLE_USER_ID)),
			db.select().from(s.chat).where(eq(s.chat.id, SYSTEM_EXAMPLE_CHAT_ID)),
			db.select().from(s.story).where(eq(s.story.id, SYSTEM_EXAMPLE_STORY_ID)),
			db.select().from(s.storyVersion).where(eq(s.storyVersion.storyId, SYSTEM_EXAMPLE_STORY_ID)),
			db.select().from(s.sharedStory).where(eq(s.sharedStory.storyId, SYSTEM_EXAMPLE_STORY_ID)),
			db
				.select({ toolInput: s.messagePart.toolInput, toolOutput: s.messagePart.toolOutput })
				.from(s.messagePart)
				.innerJoin(s.chatMessage, eq(s.chatMessage.id, s.messagePart.messageId))
				.where(eq(s.chatMessage.chatId, SYSTEM_EXAMPLE_CHAT_ID)),
		]);

		expect(users).toHaveLength(1);
		expect(users[0]).toMatchObject({ name: 'Nao', email: 'system-example@getnao.invalid' });
		expect(chats).toHaveLength(1);
		expect(stories).toHaveLength(1);
		expect(stories[0]).toMatchObject({
			slug: JAFFLE_SHOP_STORY.slug,
			title: JAFFLE_SHOP_STORY.title,
		});
		expect(versions).toHaveLength(1);
		expect(versions[0].code).toBe(JAFFLE_SHOP_STORY.code);
		expect(shares).toHaveLength(1);
		expect(shares[0]).toMatchObject({ visibility: 'project', isPinned: true });
		expect(parts.map(({ toolOutput }) => (toolOutput as { id: string }).id).sort()).toEqual(
			Object.keys(JAFFLE_SHOP_STORY.queries).sort(),
		);
		expect(
			parts.every(({ toolInput }) => (toolInput as { database_id?: string }).database_id === LOCAL_DATABASE_ID),
		).toBe(true);

		const queryData = await getLatestSqlQueryDataByIds(
			SYSTEM_EXAMPLE_CHAT_ID,
			new Set(Object.keys(JAFFLE_SHOP_STORY.queries)),
		);
		expect(Object.keys(queryData).sort()).toEqual(Object.keys(JAFFLE_SHOP_STORY.queries).sort());
	});

	it('upserts the Jaffle Shop saved prompts', async () => {
		await upsertSystemExampleProject('/tmp/example');
		await upsertSystemExampleSavedPrompts();
		await upsertSystemExampleSavedPrompts();

		const prompts = await db
			.select()
			.from(s.projectSavedPrompt)
			.where(eq(s.projectSavedPrompt.projectId, 'system-example-project'));

		expect(prompts).toHaveLength(3);
		expect(prompts.map(({ title }) => title)).toEqual(
			expect.arrayContaining([
				'How is monthly revenue trending?',
				'Make a chart of our top 5 customers by total revenue.',
				'Create a story, using chart blocks, summarizing our sales performance and key customer trends.',
			]),
		);
	});
});
