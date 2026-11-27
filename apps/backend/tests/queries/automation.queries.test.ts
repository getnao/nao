import '../../src/env';

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import s from '../../src/db/abstractSchema';
import { db } from '../../src/db/db';
import { markAutomationRunRead, transferProjectAutomationsOfUser } from '../../src/queries/automation.queries';

vi.mock('../../src/db/db', async () => {
	const { createInMemoryDbWithInlineTransactions } = await import('../helpers/in-memory-db');
	return { db: createInMemoryDbWithInlineTransactions() };
});

const PROJECT_ID = 'automation-transfer-project';
const OTHER_PROJECT_ID = 'automation-transfer-other-project';
const LEAVER_ID = 'automation-transfer-leaver';
const RECIPIENT_ID = 'automation-transfer-recipient';
const COLLEAGUE_ID = 'automation-transfer-colleague';

describe('transferProjectAutomationsOfUser', () => {
	beforeAll(async () => {
		await db.insert(s.user).values([
			{ id: LEAVER_ID, name: 'Leaver', email: 'leaver@example.com' },
			{ id: RECIPIENT_ID, name: 'Recipient', email: 'recipient@example.com' },
			{ id: COLLEAGUE_ID, name: 'Colleague', email: 'colleague@example.com' },
		]);
		await db.insert(s.project).values([
			{ id: PROJECT_ID, name: 'Project', type: 'local', path: '/tmp/automation-transfer' },
			{ id: OTHER_PROJECT_ID, name: 'Other project', type: 'local', path: '/tmp/automation-transfer-other' },
		]);
		await db.insert(s.automation).values([
			{ id: 'leaver-automation', projectId: PROJECT_ID, userId: LEAVER_ID, title: 'Mine', prompt: 'Run' },
			{ id: 'colleague-automation', projectId: PROJECT_ID, userId: COLLEAGUE_ID, title: 'Theirs', prompt: 'Run' },
			{
				id: 'elsewhere-automation',
				projectId: OTHER_PROJECT_ID,
				userId: LEAVER_ID,
				title: 'Mine',
				prompt: 'Run',
			},
		]);
		await db.insert(s.chat).values([
			{ id: 'leaver-run-chat', projectId: PROJECT_ID, userId: LEAVER_ID },
			{ id: 'leaver-own-chat', projectId: PROJECT_ID, userId: LEAVER_ID },
		]);
		await db.insert(s.automationRun).values({ automationId: 'leaver-automation', chatId: 'leaver-run-chat' });
	});

	afterAll(async () => {
		await db.delete(s.project).execute();
		await db.delete(s.user).execute();
	});

	it("hands the member's automations in the project and their run chats to the new owner", async () => {
		await expect(transferProjectAutomationsOfUser(PROJECT_ID, LEAVER_ID, RECIPIENT_ID)).resolves.toBe(1);

		const owners = await db.select({ id: s.automation.id, userId: s.automation.userId }).from(s.automation);
		expect(Object.fromEntries(owners.map((row) => [row.id, row.userId]))).toEqual({
			'leaver-automation': RECIPIENT_ID,
			'colleague-automation': COLLEAGUE_ID,
			'elsewhere-automation': LEAVER_ID,
		});
		const chats = await db.select({ id: s.chat.id, userId: s.chat.userId }).from(s.chat);
		expect(Object.fromEntries(chats.map((row) => [row.id, row.userId]))).toEqual({
			'leaver-run-chat': RECIPIENT_ID,
			'leaver-own-chat': LEAVER_ID,
		});
	});
});

describe('markAutomationRunRead', () => {
	const projectId = 'automation-read-project';
	const userId = 'automation-read-user';
	const runId = 'automation-read-run';

	beforeAll(async () => {
		await db.insert(s.user).values({ id: userId, name: 'Reader', email: 'reader@example.com' });
		await db
			.insert(s.project)
			.values({ id: projectId, name: 'Project', type: 'local', path: '/tmp/automation-read' });
		await db
			.insert(s.automation)
			.values({ id: 'read-automation', projectId, userId, title: 'Digest', prompt: 'Run' });
		await db.insert(s.automationRun).values({ id: runId, automationId: 'read-automation' });
	});

	afterAll(async () => {
		await db.delete(s.project).execute();
		await db.delete(s.user).execute();
	});

	it.each([
		{ read: true, isRead: true },
		{ read: false, isRead: false },
	])('sets the run read state to $isRead when read is $read', async ({ read, isRead }) => {
		await expect(markAutomationRunRead(projectId, userId, runId, read)).resolves.toBe(true);

		const [run] = await db.select({ readAt: s.automationRun.readAt }).from(s.automationRun);
		expect(Boolean(run.readAt)).toBe(isRead);
	});
});
