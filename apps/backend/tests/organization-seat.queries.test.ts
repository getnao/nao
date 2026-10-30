import '../src/env';

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import s from '../src/db/abstractSchema';
import { db } from '../src/db/db';
import { listOrgSeatCandidates, listReadOnlyOrgUsers, listSeatedOrgUserIds } from '../src/queries/organization.queries';

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

const ORG_ID = 'seat-org';
const PROJECT_ONE_ID = 'seat-project-one';
const PROJECT_TWO_ID = 'seat-project-two';
const joined = (day: number) => new Date(`2026-01-${String(day).padStart(2, '0')}T00:00:00.000Z`);

describe('organization seat queries', () => {
	beforeAll(async () => {
		await db.insert(s.organization).values({ id: ORG_ID, name: 'Seat Org', slug: ORG_ID });
		await db.insert(s.project).values([
			{ id: PROJECT_ONE_ID, orgId: ORG_ID, name: 'One', type: 'local', path: '/tmp/seat-one' },
			{ id: PROJECT_TWO_ID, orgId: ORG_ID, name: 'Two', type: 'local', path: '/tmp/seat-two' },
		]);
		await db
			.insert(s.user)
			.values([
				user('admin-first'),
				user('admin-second'),
				user('org-selected-first'),
				user('org-selected-second'),
				user('org-unselected'),
				user('org-viewer-project-user'),
				user('project-selected'),
				user('project-unselected'),
				user('viewer-only'),
			]);
		await db
			.insert(s.orgMember)
			.values([
				orgMember('admin-first', 'admin', 1),
				orgMember('admin-second', 'admin', 2),
				orgMember('org-selected-first', 'user', 6),
				orgMember('org-selected-second', 'user', 5),
				orgMember('org-unselected', 'user', 3),
				orgMember('org-viewer-project-user', 'viewer', 4),
				orgMember('viewer-only', 'viewer', 1),
			]);
		await db
			.insert(s.projectMember)
			.values([
				projectMember(PROJECT_ONE_ID, 'org-viewer-project-user', 'user', 8),
				projectMember(PROJECT_ONE_ID, 'project-selected', 'context_admin', 7),
				projectMember(PROJECT_ONE_ID, 'project-unselected', 'user', 4),
				projectMember(PROJECT_TWO_ID, 'project-unselected', 'admin', 9),
				projectMember(PROJECT_ONE_ID, 'viewer-only', 'viewer', 1),
			]);
		await db.insert(s.organizationSeatState).values([
			{ orgId: ORG_ID, userId: 'admin-second', selectedAt: joined(1) },
			{ orgId: ORG_ID, userId: 'org-selected-first', selectedAt: joined(1) },
			{ orgId: ORG_ID, userId: 'org-selected-second', selectedAt: joined(2) },
			{ orgId: ORG_ID, userId: 'project-selected', selectedAt: joined(1) },
		]);
	});

	afterAll(() => {
		db.$client.close();
	});

	it('orders distinct candidates by class, selection, membership date, and user id', async () => {
		const candidates = await listOrgSeatCandidates(ORG_ID);

		expect(candidates.map(({ id }) => id)).toEqual([
			'admin-first',
			'admin-second',
			'org-selected-first',
			'org-selected-second',
			'org-unselected',
			'org-viewer-project-user',
			'project-selected',
			'project-unselected',
		]);
		expect(candidates.find(({ id }) => id === 'project-unselected')).toMatchObject({
			membershipClass: 'project_only',
			joinedAt: joined(4),
			projectRoles: ['admin', 'user'],
		});
		expect(candidates.find(({ id }) => id === 'org-viewer-project-user')).toMatchObject({
			membershipClass: 'org_member',
			orgRole: 'viewer',
			role: 'user',
		});
	});

	it('never lets a selected lower class displace an organization member', async () => {
		await expect(listSeatedOrgUserIds(ORG_ID, 6)).resolves.toEqual([
			'admin-first',
			'admin-second',
			'org-selected-first',
			'org-selected-second',
			'org-unselected',
			'org-viewer-project-user',
		]);
	});

	it('returns the remaining candidates as read-only in deterministic order', async () => {
		await expect(listReadOnlyOrgUsers(ORG_ID, 6)).resolves.toMatchObject([
			{ id: 'project-selected' },
			{ id: 'project-unselected' },
		]);
	});

	it('keeps an explicitly unassigned user read-only when capacity is available', async () => {
		await db
			.insert(s.organizationSeatState)
			.values({ orgId: ORG_ID, userId: 'org-unselected', isReadOnly: true })
			.onConflictDoUpdate({
				target: [s.organizationSeatState.orgId, s.organizationSeatState.userId],
				set: { isReadOnly: true },
			});

		await expect(listSeatedOrgUserIds(ORG_ID, 8)).resolves.not.toContain('org-unselected');
		await expect(listReadOnlyOrgUsers(ORG_ID, 8)).resolves.toMatchObject([{ id: 'org-unselected' }]);
	});
});

function user(id: string) {
	return { id, name: id, email: `${id}@example.com` };
}

function orgMember(userId: string, role: 'admin' | 'user' | 'viewer', day: number) {
	return { orgId: ORG_ID, userId, role, createdAt: joined(day) };
}

function projectMember(
	projectId: string,
	userId: string,
	role: 'admin' | 'user' | 'viewer' | 'context_admin',
	day: number,
) {
	return { projectId, userId, role, createdAt: joined(day) };
}
