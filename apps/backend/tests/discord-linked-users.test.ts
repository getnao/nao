import '../src/env';

import { beforeAll, describe, expect, it, vi } from 'vitest';

import s from '../src/db/abstractSchema';
import { db } from '../src/db/db';
import {
	deleteLinkedDiscordUsers,
	getLinkedDiscordUser,
	upsertLinkedDiscordUser,
} from '../src/queries/project-discord-link.queries';

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

const PROJECT_ID = 'discord-link-project';
const OTHER_PROJECT_ID = 'discord-link-other-project';
const USER_ID = 'discord-link-nao-user';
const OTHER_USER_ID = 'discord-link-nao-other-user';

const link = (discordUserId: string, userId = USER_ID, projectId = PROJECT_ID) =>
	upsertLinkedDiscordUser({ projectId, discordUserId, userId });
const readLink = (discordUserId: string, projectId = PROJECT_ID) => getLinkedDiscordUser(projectId, discordUserId);

describe('Discord account links', () => {
	beforeAll(async () => {
		await db.insert(s.user).values([
			{ id: USER_ID, name: 'Discord Link User', email: 'discord-link@example.com' },
			{ id: OTHER_USER_ID, name: 'Discord Link Other', email: 'discord-link-other@example.com' },
		]);
		await db.insert(s.project).values([
			{ id: PROJECT_ID, name: 'Discord Link Project', type: 'local', path: '/tmp/discord-link-project' },
			{
				id: OTHER_PROJECT_ID,
				name: 'Discord Link Other Project',
				type: 'local',
				path: '/tmp/discord-link-other-project',
			},
		]);
	});

	it('returns null for a Discord user that has never linked', async () => {
		expect(await readLink('discord-user-never-linked')).toBeNull();
	});

	it('reads back a link after the bot that created it is gone', async () => {
		await link('discord-user-read-back');

		expect(await readLink('discord-user-read-back')).toEqual({ userId: USER_ID });
	});

	it('re-points an existing link at the newly linked user', async () => {
		await link('discord-user-repoint');
		await link('discord-user-repoint', OTHER_USER_ID);

		expect(await readLink('discord-user-repoint')).toEqual({ userId: OTHER_USER_ID });
	});

	it('keeps links separate per project', async () => {
		await link('discord-user-in-project');
		await link('discord-user-in-other-project', USER_ID, OTHER_PROJECT_ID);

		expect(await readLink('discord-user-in-other-project')).toBeNull();
		expect(await readLink('discord-user-in-project', OTHER_PROJECT_ID)).toBeNull();
	});

	it('drops every link of a project when the integration is deleted', async () => {
		await link('discord-user-deleted-a');
		await link('discord-user-deleted-b', OTHER_USER_ID);
		await link('discord-user-survives', USER_ID, OTHER_PROJECT_ID);

		await deleteLinkedDiscordUsers(PROJECT_ID);

		expect(await readLink('discord-user-deleted-a')).toBeNull();
		expect(await readLink('discord-user-deleted-b')).toBeNull();
		expect(await readLink('discord-user-survives', OTHER_PROJECT_ID)).toEqual({ userId: USER_ID });
	});
});
