import '../src/env';

import { beforeAll, describe, expect, it, vi } from 'vitest';

import s from '../src/db/abstractSchema';
import { db } from '../src/db/db';
import {
	getProjectDiscordConfig,
	updateProjectDiscordModel,
	upsertProjectDiscordConfig,
} from '../src/queries/project-discord-config.queries';
import { getUserByEmail } from '../src/queries/user.queries';

// `updateProjectDiscordModel` picks its transaction shape from `dbConfig.dialect`, so pin the
// dialect to SQLite here: a runner with `DB_URI=postgres://…` would otherwise take the async path
// against the better-sqlite3 mock below and fail with "Transaction function cannot return a promise".
vi.mock('../src/db/dbConfig', async (importOriginal) => {
	const mod = await importOriginal<typeof import('../src/db/dbConfig')>();
	return { ...mod, default: { ...mod.default, dialect: mod.Dialect.Sqlite } };
});

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

const PROJECT_ID = 'discord-fallback-project';
const FALLBACK_USER_ID = 'discord-fallback-user';
const FALLBACK_EMAIL = 'nao-bot@example.com';

describe('Discord fallback user', () => {
	beforeAll(async () => {
		await db.insert(s.user).values({
			id: FALLBACK_USER_ID,
			name: 'Nao Bot',
			email: FALLBACK_EMAIL,
		});
		await db.insert(s.project).values({
			id: PROJECT_ID,
			name: 'Discord Fallback Project',
			type: 'local',
			path: '/tmp/discord-fallback-project',
		});
	});

	it('finds the nominated user by email, ignoring case and surrounding space', async () => {
		const user = await getUserByEmail(`  ${FALLBACK_EMAIL.toUpperCase()}  `);
		expect(user?.id).toBe(FALLBACK_USER_ID);
	});

	it('returns null for an email that matches no user', async () => {
		expect(await getUserByEmail('nobody@example.com')).toBeNull();
	});

	it('persists the fallback user in the Discord settings', async () => {
		await upsertProjectDiscordConfig({
			projectId: PROJECT_ID,
			botToken: 'bot-token',
			applicationId: 'application-id',
			publicKey: 'public-key',
			fallbackUserId: FALLBACK_USER_ID,
			fallbackUserEmail: FALLBACK_EMAIL,
		});

		const config = await getProjectDiscordConfig(PROJECT_ID);
		expect(config?.fallbackUserId).toBe(FALLBACK_USER_ID);
		expect(config?.fallbackUserEmail).toBe(FALLBACK_EMAIL);
	});

	// The model update rewrites the whole discordSettings blob, so it is the path that silently
	// drops sibling settings. Losing the fallback here would un-answer every unlinked message.
	it('keeps the fallback user when the model is changed', async () => {
		await upsertProjectDiscordConfig({
			projectId: PROJECT_ID,
			botToken: 'bot-token',
			applicationId: 'application-id',
			publicKey: 'public-key',
			fallbackUserId: FALLBACK_USER_ID,
			fallbackUserEmail: FALLBACK_EMAIL,
			mentionRoleIds: ['role-1'],
		});

		await updateProjectDiscordModel(PROJECT_ID, null, null);

		const config = await getProjectDiscordConfig(PROJECT_ID);
		expect(config?.fallbackUserId).toBe(FALLBACK_USER_ID);
		expect(config?.fallbackUserEmail).toBe(FALLBACK_EMAIL);
		expect(config?.mentionRoleIds).toEqual(['role-1']);
	});

	it('leaves the fallback unset when no email is given', async () => {
		await upsertProjectDiscordConfig({
			projectId: PROJECT_ID,
			botToken: 'bot-token',
			applicationId: 'application-id',
			publicKey: 'public-key',
		});

		const config = await getProjectDiscordConfig(PROJECT_ID);
		expect(config?.fallbackUserId).toBeUndefined();
		expect(config?.fallbackUserEmail).toBeUndefined();
	});
});
