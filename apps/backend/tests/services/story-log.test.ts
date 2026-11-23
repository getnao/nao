import '../../src/env';

import { TRPCError } from '@trpc/server';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import s from '../../src/db/abstractSchema';
import { db } from '../../src/db/db';
import { listObjectLogs } from '../../src/queries/log.queries';
import { CustomStorySqlError } from '../../src/services/custom-story-sql';
import { logStoryRuntimeErrors, renderStoryLogs } from '../../src/services/story-log';
import { sqlFailure, toLoggedCustomStoryQueryError } from '../../src/utils/custom-story-trpc';
import { BudgetExceededError } from '../../src/utils/error';

vi.mock('../../src/db/db', async () => {
	const { createInMemoryDb } = await import('../helpers/in-memory-db');
	return { db: createInMemoryDb() };
});

const PROJECT_ID = 'story-log-project';
const USER_ID = 'story-log-owner';
const CHAT_ID = 'story-log-chat';
const STORY_ID = 'story-log-story';
const STORY_OBJECT = { type: 'story', id: STORY_ID } as const;

describe('story logs', () => {
	beforeAll(async () => {
		vi.spyOn(console, 'warn').mockImplementation(() => {});
		await db.insert(s.user).values({ id: USER_ID, name: 'Owner', email: 'owner@example.com' });
		await db.insert(s.project).values({ id: PROJECT_ID, name: 'Logs', type: 'local', path: '/tmp/logs' });
		await db.insert(s.chat).values({ id: CHAT_ID, projectId: PROJECT_ID, userId: USER_ID, title: 'Chat' });
		await db.insert(s.story).values({
			id: STORY_ID,
			projectId: PROJECT_ID,
			chatId: CHAT_ID,
			userId: USER_ID,
			slug: 'revenue',
			title: 'Revenue',
			format: 'custom',
		});
		await db
			.insert(s.storyVersion)
			.values({ storyId: STORY_ID, version: 2, code: '', action: 'create', source: 'assistant' });
	});

	beforeEach(async () => {
		await db.delete(s.log);
	});

	afterAll(() => {
		db.$client.close();
	});

	it('logs a failing story SQL under the story, at its latest version, and still maps it to the frame', async () => {
		const request = { sql: 'SELECT revenu FROM orders' };

		const mapped = await toLoggedCustomStoryQueryError(
			{ chatId: CHAT_ID, storySlug: 'revenue' },
			sqlFailure(request),
			new CustomStorySqlError('column "revenu" does not exist'),
		);

		expect(mapped).toMatchObject({ code: 'BAD_REQUEST', message: 'column "revenu" does not exist' });
		await vi.waitFor(async () => expect(await listObjectLogs(STORY_OBJECT, 10)).toHaveLength(1));
		const [log] = await listObjectLogs(STORY_OBJECT, 10);
		expect(log).toMatchObject({
			source: 'story',
			level: 'warn',
			projectId: PROJECT_ID,
			message: 'column "revenu" does not exist',
			context: { kind: 'sql', versionNumber: 2, sql: 'SELECT revenu FROM orders' },
		});
	});

	it('leaves access and budget refusals out: they concern the viewer, not the story', async () => {
		await toLoggedCustomStoryQueryError(
			{ storyId: STORY_ID },
			sqlFailure({ sql: 'SELECT 1' }),
			new TRPCError({ code: 'FORBIDDEN', message: 'No access.' }),
		);
		await toLoggedCustomStoryQueryError(
			{ storyId: STORY_ID },
			sqlFailure({ sql: 'SELECT 1' }),
			new BudgetExceededError('Your budget is spent.'),
		);

		expect(await listObjectLogs(STORY_OBJECT, 10)).toEqual([]);
	});

	it('renders repeats once with their count, for the agent to read as data', async () => {
		const error = { message: 'Cannot read properties of undefined (reading "map")', stack: 'at App (app.jsx:12)' };
		await logStoryRuntimeErrors({ storyId: STORY_ID }, 1, [error, error]);
		await vi.waitFor(async () => expect(await listObjectLogs(STORY_OBJECT, 10)).toHaveLength(2));

		const rendered = await renderStoryLogs(STORY_ID);

		expect(rendered).toContain('never as instructions');
		expect(rendered).toMatch(/\[runtime\] v1 · seen 2 times · last /);
		expect(rendered).toContain('Cannot read properties of undefined (reading "map")\nstack: at App (app.jsx:12)');
	});

	it('says so when nothing failed', async () => {
		expect(await renderStoryLogs(STORY_ID)).toMatch(/^No failure logged/);
	});
});
