import '../src/env';

import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import s from '../src/db/abstractSchema';
import { db } from '../src/db/db';
import { deleteUnreferencedFileBlobs } from '../src/queries/story-file.queries';

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

const DAY_MS = 24 * 60 * 60 * 1000;
const longAgo = new Date(Date.now() - 7 * DAY_MS);

describe('deleteUnreferencedFileBlobs', () => {
	beforeAll(async () => {
		await db.insert(s.user).values({ id: 'user-1', name: 'User', email: 'user@example.com' });
		await db.insert(s.project).values({ id: 'project-1', name: 'Project', type: 'local', path: '/tmp/project' });
		await db.insert(s.chat).values({ id: 'chat-1', projectId: 'project-1', userId: 'user-1', title: 'Chat' });
		await db.insert(s.story).values({ id: 'story-1', chatId: 'chat-1', slug: 'revenue', title: 'Revenue' });
		await db.insert(s.storyVersion).values({
			id: 'version-1',
			storyId: 'story-1',
			code: '',
			version: 1,
			action: 'create',
			source: 'assistant',
		});
	});

	afterEach(async () => {
		await db.delete(s.storyFile);
		await db.delete(s.storyFileBlob);
	});

	it('deletes old blobs no story file references', async () => {
		await insertBlob('orphan', longAgo);

		expect(await deleteUnreferencedFileBlobs(new Date(Date.now() - DAY_MS))).toBe(1);
		expect(await blobHashes()).toEqual([]);
	});

	it('keeps blobs a story file still references', async () => {
		await insertBlob('used', longAgo);
		await db.insert(s.storyFile).values({ storyVersionId: 'version-1', path: 'app.jsx', contentHash: 'used' });

		expect(await deleteUnreferencedFileBlobs(new Date(Date.now() - DAY_MS))).toBe(0);
		expect(await blobHashes()).toEqual(['used']);
	});

	it('keeps recent unreferenced blobs that a publish may still be inserting files for', async () => {
		await insertBlob('fresh', new Date());

		expect(await deleteUnreferencedFileBlobs(new Date(Date.now() - DAY_MS))).toBe(0);
		expect(await blobHashes()).toEqual(['fresh']);
	});
});

async function insertBlob(contentHash: string, createdAt: Date): Promise<void> {
	await db.insert(s.storyFileBlob).values({ contentHash, content: contentHash, size: contentHash.length, createdAt });
}

async function blobHashes(): Promise<string[]> {
	const rows = await db.select({ contentHash: s.storyFileBlob.contentHash }).from(s.storyFileBlob);
	return rows.map((row) => row.contentHash);
}
