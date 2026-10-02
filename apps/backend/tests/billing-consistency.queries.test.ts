import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

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

	it('revives a failed one-shot job but leaves pending work untouched', async () => {
		await db.insert(s.scheduledJob).values([
			{
				id: 'failed-stripe-job',
				name: 'stripe.webhook',
				payload: { eventId: 'evt_failed' },
				runAt: new Date(0),
				status: 'failed',
				attempts: 10,
				uniqueKey: 'stripe-event:evt_failed',
			},
			{
				id: 'pending-stripe-job',
				name: 'stripe.webhook',
				payload: { eventId: 'evt_pending' },
				runAt: new Date(0),
				status: 'pending',
				attempts: 1,
				uniqueKey: 'stripe-event:evt_pending',
			},
		]);

		await expect(
			enqueueOnceJob({
				name: 'stripe.webhook',
				payload: { eventId: 'evt_failed' },
				uniqueKey: 'stripe-event:evt_failed',
				maxAttempts: 10,
			}),
		).resolves.toMatchObject({ status: 'pending', attempts: 0, lastError: null });
		await expect(
			enqueueOnceJob({
				name: 'stripe.webhook',
				payload: { eventId: 'evt_replacement' },
				uniqueKey: 'stripe-event:evt_pending',
			}),
		).resolves.toBeNull();

		const [pending] = await db.select().from(s.scheduledJob).where(eq(s.scheduledJob.id, 'pending-stripe-job'));
		expect(pending).toMatchObject({ status: 'pending', attempts: 1, payload: { eventId: 'evt_pending' } });
	});

	it('leaves jobs pending until their handlers are registered', async () => {
		await db.insert(s.scheduledJob).values([
			{
				id: 'registered-job',
				name: 'registered.job',
				runAt: new Date(0),
				status: 'pending',
			},
			{
				id: 'unregistered-job',
				name: 'unregistered.job',
				runAt: new Date(0),
				status: 'pending',
			},
		]);

		await expect(claimDueJobs(new Date(), 10, 'worker-id', ['registered.job'])).resolves.toMatchObject([
			{ id: 'registered-job', status: 'running' },
		]);

		const [unregistered] = await db.select().from(s.scheduledJob).where(eq(s.scheduledJob.id, 'unregistered-job'));
		expect(unregistered).toMatchObject({ status: 'pending', attempts: 0 });
	});

	it('does not claim a candidate renamed after selection', async () => {
		await db.insert(s.scheduledJob).values({
			id: 'renamed-job',
			name: 'registered.job',
			runAt: new Date(0),
			status: 'pending',
		});

		queueMicrotask(() => {
			db.update(s.scheduledJob)
				.set({ name: 'unregistered.job' })
				.where(eq(s.scheduledJob.id, 'renamed-job'))
				.run();
		});

		await expect(claimDueJobs(new Date(), 10, 'worker-id', ['registered.job'])).resolves.toEqual([]);

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
		currentPeriodEndsAt: new Date('2026-02-15T00:00:00.000Z'),
		cancellationScheduled: false,
		hasDefaultPaymentMethod: true,
		billingAccessEndsAt: new Date('2026-02-15T00:00:00.000Z'),
	};
}
