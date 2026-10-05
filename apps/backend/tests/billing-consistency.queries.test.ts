import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

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
	attachStripeCustomer,
	claimBillingSync,
	getOrganizationBilling,
	type SubscriptionProjection,
	updateSubscriptionProjection,
} from '../src/queries/billing.queries';
import { claimDueJobs, enqueueOnceJob } from '../src/queries/scheduled-job.queries';

describe('billing consistency queries', () => {
	beforeAll(async () => {
		await db.insert(s.organization).values({
			id: 'billing-sync-org',
			name: 'Billing Sync',
			slug: 'billing-sync',
		});
		await db.insert(s.organizationBilling).values({
			orgId: 'billing-sync-org',
			stripeCustomerId: 'cus_sync',
			stripeSubscriptionId: 'sub_old',
			billingStatus: 'canceled',
		});
	});

	beforeEach(async () => {
		await db.delete(s.scheduledJob);
	});

	afterAll(() => {
		db.$client.close();
	});

	it('creates the billing projection only when Stripe is attached', async () => {
		await db.insert(s.organization).values({
			id: 'uninitialized-billing-org',
			name: 'Uninitialized Billing',
			slug: 'uninitialized-billing',
		});

		await expect(getOrganizationBilling('uninitialized-billing-org')).resolves.toBeNull();
		await expect(attachStripeCustomer('uninitialized-billing-org', 'cus_new')).resolves.toMatchObject({
			orgId: 'uninitialized-billing-org',
			stripeCustomerId: 'cus_new',
		});
	});

	it('rejects a superseded projection', async () => {
		const first = await claimBillingSync('billing-sync-org', 'cus_sync');
		const second = await claimBillingSync('billing-sync-org', 'cus_sync');

		await expect(updateSubscriptionProjection('billing-sync-org', first.token, activeProjection())).resolves.toBe(
			false,
		);
		await expect(updateSubscriptionProjection('billing-sync-org', second.token, activeProjection())).resolves.toBe(
			true,
		);

		const [billing] = await db
			.select()
			.from(s.organizationBilling)
			.where(eq(s.organizationBilling.orgId, 'billing-sync-org'));
		expect(billing).toMatchObject({
			billingStatus: 'active',
			stripeSubscriptionId: 'sub_active',
		});
	});

	it('does not reset exhausted or pending one-shot jobs on duplicate enqueue', async () => {
		await db.insert(s.scheduledJob).values([
			{
				id: 'failed-stripe-job',
				name: 'stripe.webhook.process',
				payload: { eventId: 'evt_failed' },
				runAt: new Date(0),
				status: 'failed',
				attempts: 3,
				maxAttempts: 3,
				lastError: 'retry budget exhausted',
				uniqueKey: 'stripe-event:evt_failed',
			},
			{
				id: 'pending-stripe-job',
				name: 'stripe.webhook.process',
				payload: { eventId: 'evt_pending' },
				runAt: new Date(0),
				status: 'pending',
				attempts: 1,
				uniqueKey: 'stripe-event:evt_pending',
			},
		]);

		await expect(
			enqueueOnceJob({
				name: 'stripe.webhook.process',
				payload: { eventId: 'evt_failed' },
				uniqueKey: 'stripe-event:evt_failed',
				maxAttempts: 10,
			}),
		).resolves.toBeNull();
		await expect(
			enqueueOnceJob({
				name: 'stripe.webhook.process',
				payload: { eventId: 'evt_replacement' },
				uniqueKey: 'stripe-event:evt_pending',
			}),
		).resolves.toBeNull();

		const [failed] = await db.select().from(s.scheduledJob).where(eq(s.scheduledJob.id, 'failed-stripe-job'));
		expect(failed).toMatchObject({
			status: 'failed',
			attempts: 3,
			maxAttempts: 3,
			lastError: 'retry budget exhausted',
			payload: { eventId: 'evt_failed' },
		});
		const [pending] = await db.select().from(s.scheduledJob).where(eq(s.scheduledJob.id, 'pending-stripe-job'));
		expect(pending).toMatchObject({ status: 'pending', attempts: 1, payload: { eventId: 'evt_pending' } });
	});

	it('claims all due jobs so missing handlers can be surfaced', async () => {
		await db.insert(s.scheduledJob).values([
			{
				id: 'registered-job',
				name: 'registered.job',
				runAt: new Date(-2_000),
				status: 'pending',
			},
			{
				id: 'unregistered-job',
				name: 'unregistered.job',
				runAt: new Date(-1_000),
				status: 'pending',
			},
		]);

		await expect(claimDueJobs(new Date(-500), 10, 'worker-id')).resolves.toMatchObject([
			{ id: 'registered-job', status: 'running' },
			{ id: 'unregistered-job', status: 'running' },
		]);

		const [unregistered] = await db.select().from(s.scheduledJob).where(eq(s.scheduledJob.id, 'unregistered-job'));
		expect(unregistered).toMatchObject({ status: 'running', attempts: 1 });
	});

	it('does not claim a candidate renamed after selection', async () => {
		await db.insert(s.scheduledJob).values({
			id: 'renamed-job',
			name: 'registered.job',
			runAt: new Date(-2_000),
			status: 'pending',
		});

		const update = db.update.bind(db);
		vi.spyOn(db, 'update').mockImplementationOnce((table) => {
			db.$client.prepare('UPDATE scheduled_job SET name = ? WHERE id = ?').run('unregistered.job', 'renamed-job');
			return update(table);
		});

		await expect(claimDueJobs(new Date(-1_500), 10, 'worker-id')).resolves.toEqual([]);

		const [renamed] = await db.select().from(s.scheduledJob).where(eq(s.scheduledJob.id, 'renamed-job'));
		expect(renamed).toMatchObject({ name: 'unregistered.job', status: 'pending', attempts: 0 });
	});
});

function activeProjection(): SubscriptionProjection {
	return {
		billingPlan: 'cloud_monthly_v2',
		billingStatus: 'active',
		stripeCustomerId: 'cus_sync',
		stripeSubscriptionId: 'sub_active',
		stripePriceId: 'price_cloud',
		trialStartedAt: new Date('2026-01-01T00:00:00.000Z'),
		trialEndsAt: new Date('2026-01-15T00:00:00.000Z'),
		currentPeriodStartsAt: new Date('2026-01-15T00:00:00.000Z'),
		currentPeriodEndsAt: new Date('2026-02-15T00:00:00.000Z'),
		cancellationScheduled: false,
		hasDefaultPaymentMethod: true,
		billingAccessEndsAt: new Date('2026-02-15T00:00:00.000Z'),
	};
}
