import { DrizzleQueryError } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	getStoryByChatAndSlug: vi.fn(),
	getLatestVersionByChatAndSlug: vi.fn(),
	getVersionByNumber: vi.fn(),
	getSqlQueryById: vi.fn(),
	listVersionFiles: vi.fn(),
	listDraftFiles: vi.fn(),
	getChatOwnerId: vi.fn(),
}));

vi.mock('../src/db/db', () => ({ db: {} }));
vi.mock('../src/queries/activity.queries', () => ({}));
vi.mock('../src/queries/chat.queries', () => ({ getChatOwnerId: mocks.getChatOwnerId }));
vi.mock('../src/queries/execute-sql.queries', () => ({}));
vi.mock('../src/queries/story-theme.queries', () => ({}));
vi.mock('../src/services/live-story', () => ({}));
vi.mock('../src/queries/story.queries', async (importOriginal) => ({
	...(await importOriginal<typeof import('../src/queries/story.queries')>()),
	getStoryByChatAndSlug: mocks.getStoryByChatAndSlug,
	getLatestVersionByChatAndSlug: mocks.getLatestVersionByChatAndSlug,
	getVersionByNumber: mocks.getVersionByNumber,
	getSqlQueryById: mocks.getSqlQueryById,
}));
vi.mock('../src/queries/story-file.queries', () => ({
	listVersionFiles: mocks.listVersionFiles,
	listDraftFiles: mocks.listDraftFiles,
}));

import { isStoryVersionUniqueViolation } from '../src/queries/story.queries';
import { getEditorCustomStoryQuerySql } from '../src/services/custom-story';
import {
	assertWriterAddsNoChatQueries,
	CustomStoryQueryNotAllowedError,
} from '../src/services/custom-story-query-access';

describe('custom story queries read by an editor', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.getStoryByChatAndSlug.mockResolvedValue({ id: 'story-1', format: 'custom' });
		mocks.getLatestVersionByChatAndSlug.mockResolvedValue({ id: 'version-1' });
		mocks.listVersionFiles.mockResolvedValue([{ content: 'useQuery("query_published")' }]);
		mocks.listDraftFiles.mockResolvedValue([{ content: 'useQuery("query_draft")' }]);
		mocks.getSqlQueryById.mockResolvedValue({ sqlQuery: 'select 1' });
	});

	it('serves the SQL of the queries the published story or its draft references', async () => {
		await expect(getEditorCustomStoryQuerySql('chat-1', 'story', 'query_published')).resolves.toBe('select 1');
		await expect(getEditorCustomStoryQuerySql('chat-1', 'story', 'query_draft')).resolves.toBe('select 1');
	});

	it('never serves another query of the chat', async () => {
		await expect(getEditorCustomStoryQuerySql('chat-1', 'story', 'query_private')).rejects.toBeInstanceOf(
			CustomStoryQueryNotAllowedError,
		);
		expect(mocks.getSqlQueryById).not.toHaveBeenCalled();
	});

	it('serves a query only the older version being viewed still references', async () => {
		mocks.getVersionByNumber.mockResolvedValue({ id: 'version-old' });
		mocks.listVersionFiles.mockImplementation(async (versionId: string) =>
			versionId === 'version-old'
				? [{ content: 'useQuery("query_removed")' }]
				: [{ content: 'useQuery("query_published")' }],
		);

		await expect(getEditorCustomStoryQuerySql('chat-1', 'story', 'query_removed', 1)).resolves.toBe('select 1');
		await expect(getEditorCustomStoryQuerySql('chat-1', 'story', 'query_private', 1)).rejects.toBeInstanceOf(
			CustomStoryQueryNotAllowedError,
		);
	});
});

describe('sources written by someone other than the chat owner', () => {
	const STORY = { chatId: 'chat-1', slug: 'story' };

	beforeEach(() => {
		vi.clearAllMocks();
		mocks.getChatOwnerId.mockResolvedValue('owner');
		mocks.getStoryByChatAndSlug.mockResolvedValue({ id: 'story-1', format: 'custom' });
		mocks.getLatestVersionByChatAndSlug.mockResolvedValue({ id: 'version-1' });
		mocks.listVersionFiles.mockResolvedValue([{ content: 'useQuery("query_published")' }]);
		mocks.listDraftFiles.mockResolvedValue([]);
		mocks.getSqlQueryById.mockImplementation(async (_chatId: string, queryId: string) =>
			queryId === 'query_private' ? { sqlQuery: 'select secret' } : null,
		);
	});

	it('refuses an editor citing a query of the chat the story never used', async () => {
		await expect(
			assertWriterAddsNoChatQueries(STORY, 'editor', [{ content: 'useQuery("query_private")' }]),
		).rejects.toBeInstanceOf(CustomStoryQueryNotAllowedError);
	});

	it('lets an editor keep the queries the story uses and cite ones from outside the chat', async () => {
		await expect(
			assertWriterAddsNoChatQueries(STORY, 'editor', [
				{ content: 'useQuery("query_published"); useQuery("query_from_their_chat")' },
			]),
		).resolves.toBeUndefined();
	});

	it('lets the chat owner cite any query of their chat', async () => {
		await expect(
			assertWriterAddsNoChatQueries(STORY, 'owner', [{ content: 'useQuery("query_private")' }]),
		).resolves.toBeUndefined();
		expect(mocks.getSqlQueryById).not.toHaveBeenCalled();
	});
});

describe('story version conflicts', () => {
	it('recognizes a Postgres unique violation wrapped by drizzle', () => {
		const postgresError = Object.assign(new Error('duplicate key value'), {
			code: '23505',
			constraint_name: 'story_version_story_version_unique',
		});

		expect(isStoryVersionUniqueViolation(new DrizzleQueryError('insert ...', [], postgresError))).toBe(true);
	});

	it('recognizes a SQLite unique violation, wrapped or not', () => {
		const sqliteError = new Error('UNIQUE constraint failed: story_version.story_id, story_version.version');

		expect(isStoryVersionUniqueViolation(sqliteError)).toBe(true);
		expect(isStoryVersionUniqueViolation(new DrizzleQueryError('insert ...', [], sqliteError))).toBe(true);
	});

	it('ignores other unique violations', () => {
		const otherError = Object.assign(new Error('duplicate key value'), {
			code: '23505',
			constraint_name: 'user_email_unique',
		});

		expect(isStoryVersionUniqueViolation(new DrizzleQueryError('insert ...', [], otherError))).toBe(false);
	});
});
