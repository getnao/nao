import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import type * as EnvModule from '../src/env';

vi.mock('../src/env', async (importOriginal) => {
	const actual = await importOriginal<typeof EnvModule>();
	return { ...actual, env: { ...actual.env, DB_URI: 'sqlite::memory:' } };
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

import s from '../src/db/abstractSchema';
import { db } from '../src/db/db';
import {
	claimOrganizationSeatEmailNotification,
	claimPausedWorkInAppNotification,
	listOrganizationSeatStates,
	releaseOrganizationSeatEmailNotification,
	setOrganizationSeatSelection,
	syncOrganizationSeatState,
} from '../src/queries/organization-seat-state.queries';

describe('organization seat state queries', () => {
	beforeAll(async () => {
		await db.insert(s.organization).values({ id: 'org-id', name: 'Organization', slug: 'organization' });
		await db.insert(s.user).values({ id: 'user-id', name: 'User', email: 'user@example.com' });
		await db.insert(s.project).values({
			id: 'project-id',
			orgId: 'org-id',
			name: 'Project',
			type: 'local',
			path: '/tmp/project',
		});
	});

	afterAll(() => {
		db.$client.close();
	});

	it('persists explicit selection and deselection without deleting the row', async () => {
		const selectedAt = new Date('2026-10-30T10:00:00.000Z');
		await expect(setOrganizationSeatSelection('org-id', 'user-id', selectedAt)).resolves.toMatchObject({
			selectedAt,
			isReadOnly: false,
		});
		await expect(setOrganizationSeatSelection('org-id', 'user-id', null)).resolves.toMatchObject({
			selectedAt: null,
		});
		await expect(listOrganizationSeatStates('org-id')).resolves.toHaveLength(1);
	});

	it('claims each notification channel once and releases only the failed email claim', async () => {
		const changedAt = new Date('2026-10-30T11:00:00.000Z');
		const ownerEmailClaimedAt = new Date('2026-10-30T11:01:00.000Z');
		const adminEmailClaimedAt = new Date('2026-10-30T11:02:00.000Z');
		await expect(
			syncOrganizationSeatState({ orgId: 'org-id', userId: 'user-id', isReadOnly: true, changedAt }),
		).resolves.toMatchObject({ changed: true, state: { isReadOnly: true } });

		const notification = {
			projectId: 'project-id',
			title: 'Scheduled work paused',
			body: 'Your scheduled work is paused.',
		};
		await expect(claimPausedWorkInAppNotification('org-id', 'user-id', notification, changedAt)).resolves.toBe(
			true,
		);
		await expect(claimPausedWorkInAppNotification('org-id', 'user-id', notification, changedAt)).resolves.toBe(
			false,
		);

		await expect(
			claimOrganizationSeatEmailNotification('org-id', 'user-id', 'owner_email', ownerEmailClaimedAt),
		).resolves.toBe(true);
		await expect(
			claimOrganizationSeatEmailNotification('org-id', 'user-id', 'owner_email', ownerEmailClaimedAt),
		).resolves.toBe(false);
		await expect(
			claimOrganizationSeatEmailNotification('org-id', 'user-id', 'admin_email', adminEmailClaimedAt),
		).resolves.toBe(true);
		await expect(
			syncOrganizationSeatState({
				orgId: 'org-id',
				userId: 'user-id',
				isReadOnly: true,
				changedAt: new Date('2026-10-30T11:03:00.000Z'),
			}),
		).resolves.toMatchObject({
			changed: false,
			state: {
				ownerInAppNotifiedAt: changedAt,
				ownerEmailNotifiedAt: ownerEmailClaimedAt,
				adminEmailNotifiedAt: adminEmailClaimedAt,
			},
		});

		await expect(
			releaseOrganizationSeatEmailNotification(
				'org-id',
				'user-id',
				'owner_email',
				new Date(ownerEmailClaimedAt.getTime() + 1),
			),
		).resolves.toBe(false);
		await expect(
			releaseOrganizationSeatEmailNotification('org-id', 'user-id', 'owner_email', ownerEmailClaimedAt),
		).resolves.toBe(true);
		await expect(
			claimOrganizationSeatEmailNotification('org-id', 'user-id', 'owner_email', ownerEmailClaimedAt),
		).resolves.toBe(true);

		await expect(db.select().from(s.notification)).resolves.toEqual([
			expect.objectContaining({ category: 'scheduled_work_paused', userId: 'user-id' }),
		]);
	});

	it('resets every channel when seated and allows a second read-only episode', async () => {
		const seatedAt = new Date('2026-10-30T12:00:00.000Z');
		const secondEpisodeAt = new Date('2026-10-30T13:00:00.000Z');
		await expect(
			syncOrganizationSeatState({
				orgId: 'org-id',
				userId: 'user-id',
				isReadOnly: false,
				changedAt: seatedAt,
			}),
		).resolves.toMatchObject({
			changed: true,
			state: {
				isReadOnly: false,
				ownerInAppNotifiedAt: null,
				ownerEmailNotifiedAt: null,
				adminEmailNotifiedAt: null,
			},
		});
		await expect(
			claimOrganizationSeatEmailNotification('org-id', 'user-id', 'owner_email', seatedAt),
		).resolves.toBe(false);

		await syncOrganizationSeatState({
			orgId: 'org-id',
			userId: 'user-id',
			isReadOnly: true,
			changedAt: secondEpisodeAt,
		});
		await expect(
			claimPausedWorkInAppNotification(
				'org-id',
				'user-id',
				{ projectId: 'project-id', title: 'Scheduled work paused again' },
				secondEpisodeAt,
			),
		).resolves.toBe(true);
		await expect(
			claimOrganizationSeatEmailNotification('org-id', 'user-id', 'owner_email', secondEpisodeAt),
		).resolves.toBe(true);
		await expect(
			claimOrganizationSeatEmailNotification('org-id', 'user-id', 'admin_email', secondEpisodeAt),
		).resolves.toBe(true);
		await expect(db.select().from(s.notification)).resolves.toHaveLength(2);
	});
});
