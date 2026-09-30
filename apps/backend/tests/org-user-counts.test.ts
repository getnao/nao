import '../src/env';

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import s from '../src/db/abstractSchema';
import { db } from '../src/db/db';
import { countOrgUsers } from '../src/queries/organization.queries';
import { getOrgActiveUserCount } from '../src/queries/usage.queries';
import { LICENSE_ACTIVITY_WINDOW } from '../src/types/usage';

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

vi.mock('../src/queries/project-llm-config.queries', () => ({
	getProjectLlmConfigs: async () => [],
}));

const ORG_ID = 'counts-org';
const OTHER_ORG_ID = 'counts-other-org';
const ANALYTICS_PROJECT_ID = 'counts-analytics';
const FINANCE_PROJECT_ID = 'counts-finance';
const OTHER_ORG_PROJECT_ID = 'counts-other-project';
const OWNER_ID = 'counts-owner';
const REPLIER_ID = 'counts-replier';
const SLACK_USER_ID = 'counts-slack-user';
const OUTSIDER_ID = 'counts-outsider';

const daysAgo = (days: number) => new Date(Date.now() - days * 24 * 60 * 60 * 1000);

describe('organization user counts', () => {
	beforeAll(async () => {
		await db.insert(s.user).values([
			{ id: OWNER_ID, name: 'Thread Owner', email: 'owner@example.com' },
			{ id: REPLIER_ID, name: 'Thread Replier', email: 'replier@example.com' },
			{ id: SLACK_USER_ID, name: 'Slack Sender', email: 'slack@example.com' },
			{ id: OUTSIDER_ID, name: 'Other Org User', email: 'outsider@example.com' },
		]);
		await db.insert(s.organization).values([
			{ id: ORG_ID, name: 'Counts Org', slug: 'counts-org' },
			{ id: OTHER_ORG_ID, name: 'Other Org', slug: 'counts-other-org' },
		]);
		await db.insert(s.project).values([
			{ id: ANALYTICS_PROJECT_ID, orgId: ORG_ID, name: 'Analytics', type: 'local', path: '/tmp/analytics' },
			{ id: FINANCE_PROJECT_ID, orgId: ORG_ID, name: 'Finance', type: 'local', path: '/tmp/finance' },
			{ id: OTHER_ORG_PROJECT_ID, orgId: OTHER_ORG_ID, name: 'Elsewhere', type: 'local', path: '/tmp/elsewhere' },
		]);
		await db.insert(s.orgMember).values([
			{ orgId: ORG_ID, userId: OWNER_ID, role: 'admin' },
			{ orgId: ORG_ID, userId: REPLIER_ID, role: 'user' },
			{ orgId: OTHER_ORG_ID, userId: OUTSIDER_ID, role: 'admin' },
		]);
		await db.insert(s.projectMember).values([
			{ projectId: ANALYTICS_PROJECT_ID, userId: OWNER_ID, role: 'admin' },
			{ projectId: FINANCE_PROJECT_ID, userId: OWNER_ID, role: 'admin' },
			{ projectId: ANALYTICS_PROJECT_ID, userId: SLACK_USER_ID, role: 'user' },
			{ projectId: OTHER_ORG_PROJECT_ID, userId: OUTSIDER_ID, role: 'admin' },
		]);
		await db.insert(s.chat).values([
			{ id: 'analytics-chat', projectId: ANALYTICS_PROJECT_ID, userId: OWNER_ID },
			{ id: 'finance-chat', projectId: FINANCE_PROJECT_ID, userId: OWNER_ID },
			{ id: 'other-org-chat', projectId: OTHER_ORG_PROJECT_ID, userId: OUTSIDER_ID },
		]);
	});

	beforeEach(async () => {
		await db.delete(s.chatMessage);
	});

	afterAll(() => {
		db.$client.close();
	});

	describe('people with access', () => {
		it('counts project-only members alongside organization members', async () => {
			await expect(countOrgUsers(ORG_ID)).resolves.toBe(3);
		});

		it('counts somebody who is both an organization and a project member once', async () => {
			await expect(countOrgUsers(OTHER_ORG_ID)).resolves.toBe(1);
		});
	});

	describe('active users', () => {
		it('counts somebody active in two projects of the same organization once', async () => {
			await db.insert(s.chatMessage).values([
				{ id: 'analytics-1', chatId: 'analytics-chat', senderUserId: OWNER_ID, role: 'user' },
				{ id: 'finance-1', chatId: 'finance-chat', senderUserId: OWNER_ID, role: 'user' },
			]);

			await expect(getOrgActiveUserCount(ORG_ID, LICENSE_ACTIVITY_WINDOW)).resolves.toBe(1);
		});

		it('credits a thread reply to its sender rather than to the chat owner', async () => {
			await db.insert(s.chatMessage).values([
				{ id: 'shared-1', chatId: 'analytics-chat', senderUserId: OWNER_ID, role: 'user' },
				{ id: 'shared-2', chatId: 'analytics-chat', senderUserId: REPLIER_ID, role: 'user' },
			]);

			await expect(getOrgActiveUserCount(ORG_ID, LICENSE_ACTIVITY_WINDOW)).resolves.toBe(2);
		});

		it('counts a project-only sender who never joined the organization', async () => {
			await db
				.insert(s.chatMessage)
				.values([{ id: 'slack-1', chatId: 'analytics-chat', senderUserId: SLACK_USER_ID, role: 'user' }]);

			await expect(getOrgActiveUserCount(ORG_ID, LICENSE_ACTIVITY_WINDOW)).resolves.toBe(1);
		});

		it('ignores messages sent before the window', async () => {
			await db.insert(s.chatMessage).values([
				{ id: 'recent-1', chatId: 'analytics-chat', senderUserId: OWNER_ID, role: 'user' },
				{
					id: 'stale-1',
					chatId: 'analytics-chat',
					senderUserId: REPLIER_ID,
					role: 'user',
					createdAt: daysAgo(120),
				},
			]);

			await expect(getOrgActiveUserCount(ORG_ID, LICENSE_ACTIVITY_WINDOW)).resolves.toBe(1);
		});

		it('ignores activity from other organizations', async () => {
			await db.insert(s.chatMessage).values([
				{ id: 'analytics-2', chatId: 'analytics-chat', senderUserId: OWNER_ID, role: 'user' },
				{ id: 'elsewhere-1', chatId: 'other-org-chat', senderUserId: OUTSIDER_ID, role: 'user' },
			]);

			await expect(getOrgActiveUserCount(ORG_ID, LICENSE_ACTIVITY_WINDOW)).resolves.toBe(1);
		});

		it('ignores assistant replies so only people who sent something count', async () => {
			await db
				.insert(s.chatMessage)
				.values([{ id: 'assistant-1', chatId: 'analytics-chat', senderUserId: OWNER_ID, role: 'assistant' }]);

			await expect(getOrgActiveUserCount(ORG_ID, LICENSE_ACTIVITY_WINDOW)).resolves.toBe(0);
		});

		it('falls back to the chat owner for rows written before the sender column existed', async () => {
			await db.insert(s.chatMessage).values([{ id: 'legacy-1', chatId: 'analytics-chat', role: 'user' }]);

			await expect(getOrgActiveUserCount(ORG_ID, LICENSE_ACTIVITY_WINDOW)).resolves.toBe(1);
		});
	});
});
