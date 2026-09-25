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
	claimBillingSync,
	claimTrialReminder,
	releaseTrialReminder,
	type SubscriptionProjection,
	updateSubscriptionProjection,
} from '../src/queries/billing.queries';
import { enqueueOnceJob } from '../src/queries/scheduled-job.queries';

describe('billing consistency queries', () => {
	beforeAll(async () => {
		await db.insert(s.organization).values({
			id: 'billing-sync-org',
			name: 'Billing Sync',
			slug: 'billing-sync',
			stripeCustomerId: 'cus_sync',
			stripeSubscriptionId: 'sub_old',
			billingStatus: 'canceled',
		});
	});

	afterAll(() => {
		db.$client.close();
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

		const [organization] = await db.select().from(s.organization).where(eq(s.organization.id, 'billing-sync-org'));
		expect(organization).toMatchObject({
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

	it('claims a trial reminder only once', async () => {
		const trialEndsAt = new Date('2026-10-08T00:00:00.000Z');
		const claimedAt = new Date('2026-10-05T00:00:00.000Z');
		await db.insert(s.organization).values({
			id: 'trial-reminder-org',
			name: 'Trial Reminder',
			slug: 'trial-reminder',
			billingStatus: 'trialing',
			stripeSubscriptionId: 'sub_trial',
			trialEndsAt,
		});

		await expect(claimTrialReminder('trial-reminder-org', trialEndsAt, claimedAt)).resolves.toBe(true);
		await expect(claimTrialReminder('trial-reminder-org', trialEndsAt, claimedAt)).resolves.toBe(false);
		await releaseTrialReminder('trial-reminder-org', trialEndsAt, claimedAt);
		await expect(claimTrialReminder('trial-reminder-org', trialEndsAt, claimedAt)).resolves.toBe(true);
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
		cancelAtPeriodEnd: false,
		hasDefaultPaymentMethod: true,
		billingAccessEndsAt: new Date('2026-02-15T00:00:00.000Z'),
	};
}
