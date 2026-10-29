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
import { __reloadEnvForTesting } from '../src/env';
import {
	attachStripeCustomer,
	claimBillingSync,
	getOrganizationBilling,
	listOrganizationTrialsPendingStripeProvisioning,
	type SubscriptionProjection,
	updateSubscriptionProjection,
} from '../src/queries/billing.queries';
import { createProject } from '../src/queries/project.queries';
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

	it('attaches Stripe to an existing local trial without replacing its dates', async () => {
		const trialStartedAt = new Date('2026-10-01T00:00:00.000Z');
		const trialEndsAt = new Date('2026-10-15T00:00:00.000Z');
		await db.insert(s.organization).values({
			id: 'local-trial-billing-org',
			name: 'Local Trial Billing',
			slug: 'local-trial-billing',
		});
		await db.insert(s.organizationBilling).values({
			orgId: 'local-trial-billing-org',
			billingStatus: 'trialing',
			trialStartedAt,
			trialEndsAt,
			billingAccessEndsAt: trialEndsAt,
		});

		await expect(attachStripeCustomer('local-trial-billing-org', 'cus_local_trial')).resolves.toMatchObject({
			billingStatus: 'trialing',
			stripeCustomerId: 'cus_local_trial',
			trialStartedAt,
			trialEndsAt,
		});
	});

	it('lists only active local trials that still need a Stripe subscription', async () => {
		const now = new Date('2026-10-19T12:00:00.000Z');
		await db.insert(s.organization).values([
			{ id: 'pending-trial-org', name: 'Pending Trial', slug: 'pending-trial' },
			{ id: 'expired-trial-org', name: 'Expired Trial', slug: 'expired-trial' },
			{ id: 'provisioned-trial-org', name: 'Provisioned Trial', slug: 'provisioned-trial' },
		]);
		await db.insert(s.organizationBilling).values([
			{
				orgId: 'pending-trial-org',
				billingStatus: 'trialing',
				trialEndsAt: new Date('2026-10-20T12:00:00.000Z'),
			},
			{
				orgId: 'expired-trial-org',
				billingStatus: 'trialing',
				trialEndsAt: new Date('2026-10-18T12:00:00.000Z'),
			},
			{
				orgId: 'provisioned-trial-org',
				billingStatus: 'trialing',
				trialEndsAt: new Date('2026-10-20T12:00:00.000Z'),
				stripeSubscriptionId: 'sub_trial',
			},
		]);

		await expect(listOrganizationTrialsPendingStripeProvisioning(now)).resolves.toMatchObject([
			{ orgId: 'pending-trial-org' },
		]);
	});

	it('starts one local trial when the first project is created', async () => {
		const originalEnv = { ...process.env };
		Object.assign(process.env, {
			NAO_MODE: 'cloud',
			CLOUD_BILLING_ENABLED: 'true',
			CLOUD_GITHUB_PROJECT_APP_ID: '123',
			CLOUD_GITHUB_PROJECT_INSTALLATION_ID: '456',
			CLOUD_GITHUB_PROJECT_ORG: 'test-org',
			CLOUD_GITHUB_PROJECT_PRIVATE_KEY: 'test-private-key',
			SMTP_HOST: 'smtp.example.com',
			SMTP_MAIL_FROM: 'hello@example.com',
			SMTP_PASSWORD: 'secret',
			STRIPE_CLOUD_PRODUCT_ID: 'prod_cloud',
			STRIPE_CLOUD_MONTHLY_PRICE_LOOKUP_KEY: 'monthly_sub',
			STRIPE_CLOUD_TRIAL_PRICE_LOOKUP_KEY: 'trial_sub',
			STRIPE_CLOUD_TRIAL_PRODUCT_ID: 'prod_cloud_trial',
			STRIPE_CLOUD_YEARLY_PRICE_LOOKUP_KEY: 'yearly_sub',
			STRIPE_CREDIT_PLATFORM_FEE_PRODUCT_ID: 'prod_platform_fee',
			STRIPE_CREDIT_PRODUCT_ID: 'prod_credits',
			STRIPE_SECRET_KEY: 'sk_test_example',
			STRIPE_WEBHOOK_SECRET: 'whsec_example',
		});
		__reloadEnvForTesting();
		await db.insert(s.organization).values({
			id: 'automatic-trial-org',
			name: 'Automatic Trial',
			slug: 'automatic-trial',
		});

		try {
			await createProject(
				{
					id: 'automatic-trial-project-1',
					orgId: 'automatic-trial-org',
					name: 'First',
					type: 'local',
					path: '/tmp/automatic-trial-1',
				},
				undefined,
				'acting-user',
			);
			const firstBilling = await getOrganizationBilling('automatic-trial-org');

			expect(firstBilling).toMatchObject({
				billingStatus: 'trialing',
				stripeCustomerId: null,
				stripeSubscriptionId: null,
			});
			expect(firstBilling?.trialStartedAt).toBeInstanceOf(Date);
			expect(firstBilling?.trialEndsAt?.getTime()).toBe(
				firstBilling!.trialStartedAt!.getTime() + 14 * 24 * 60 * 60 * 1000,
			);
			expect(firstBilling?.billingAccessEndsAt).toEqual(firstBilling?.trialEndsAt);
			const [provisioningJob] = await db
				.select()
				.from(s.scheduledJob)
				.where(eq(s.scheduledJob.uniqueKey, 'billing-cloud-provision-trial:automatic-trial-org'));
			expect(provisioningJob).toMatchObject({
				name: 'billing.cloud.provision-trial',
				payload: { organizationId: 'automatic-trial-org', actingUserId: 'acting-user' },
				status: 'pending',
			});

			await createProject({
				id: 'automatic-trial-project-2',
				orgId: 'automatic-trial-org',
				name: 'Second',
				type: 'local',
				path: '/tmp/automatic-trial-2',
			});
			expect(await getOrganizationBilling('automatic-trial-org')).toEqual(firstBilling);
			const jobs = await db
				.select()
				.from(s.scheduledJob)
				.where(eq(s.scheduledJob.uniqueKey, 'billing-cloud-provision-trial:automatic-trial-org'));
			expect(jobs).toHaveLength(1);

			await db.insert(s.organization).values({
				id: 'customer-first-trial-org',
				name: 'Customer First Trial',
				slug: 'customer-first-trial',
			});
			await attachStripeCustomer('customer-first-trial-org', 'cus_before_project');
			await createProject({
				id: 'customer-first-trial-project',
				orgId: 'customer-first-trial-org',
				name: 'First',
				type: 'local',
				path: '/tmp/customer-first-trial',
			});
			const customerFirstBilling = await getOrganizationBilling('customer-first-trial-org');
			expect(customerFirstBilling).toMatchObject({
				billingStatus: 'trialing',
				stripeCustomerId: 'cus_before_project',
				stripeSubscriptionId: null,
			});
			expect(customerFirstBilling?.trialStartedAt).toBeInstanceOf(Date);
			expect(customerFirstBilling?.trialEndsAt).toBeInstanceOf(Date);
			const customerFirstJobs = await db
				.select()
				.from(s.scheduledJob)
				.where(eq(s.scheduledJob.uniqueKey, 'billing-cloud-provision-trial:customer-first-trial-org'));
			expect(customerFirstJobs).toHaveLength(1);
		} finally {
			process.env = originalEnv;
			__reloadEnvForTesting();
		}
	});

	it('does not consume a trial for a bypass-billing organization', async () => {
		const originalEnv = { ...process.env };
		Object.assign(process.env, {
			NAO_MODE: 'cloud',
			CLOUD_BILLING_ENABLED: 'true',
			CLOUD_GITHUB_PROJECT_APP_ID: '123',
			CLOUD_GITHUB_PROJECT_INSTALLATION_ID: '456',
			CLOUD_GITHUB_PROJECT_ORG: 'test-org',
			CLOUD_GITHUB_PROJECT_PRIVATE_KEY: 'test-private-key',
			SMTP_HOST: 'smtp.example.com',
			SMTP_MAIL_FROM: 'hello@example.com',
			SMTP_PASSWORD: 'secret',
			STRIPE_CLOUD_PRODUCT_ID: 'prod_cloud',
			STRIPE_CLOUD_MONTHLY_PRICE_LOOKUP_KEY: 'monthly_sub',
			STRIPE_CLOUD_TRIAL_PRICE_LOOKUP_KEY: 'trial_sub',
			STRIPE_CLOUD_TRIAL_PRODUCT_ID: 'prod_cloud_trial',
			STRIPE_CLOUD_YEARLY_PRICE_LOOKUP_KEY: 'yearly_sub',
			STRIPE_CREDIT_PLATFORM_FEE_PRODUCT_ID: 'prod_platform_fee',
			STRIPE_CREDIT_PRODUCT_ID: 'prod_credits',
			STRIPE_SECRET_KEY: 'sk_test_example',
			STRIPE_WEBHOOK_SECRET: 'whsec_example',
		});
		__reloadEnvForTesting();
		await db.insert(s.organization).values({
			id: 'bypass-trial-org',
			name: 'Bypass Trial',
			slug: 'bypass-trial',
			bypassBilling: true,
		});

		try {
			await createProject({
				id: 'bypass-trial-project',
				orgId: 'bypass-trial-org',
				name: 'Bypass',
				type: 'local',
				path: '/tmp/bypass-trial',
			});
			await expect(getOrganizationBilling('bypass-trial-org')).resolves.toBeNull();
			const jobs = await db
				.select()
				.from(s.scheduledJob)
				.where(eq(s.scheduledJob.uniqueKey, 'billing-cloud-provision-trial:bypass-trial-org'));
			expect(jobs).toHaveLength(0);
		} finally {
			process.env = originalEnv;
			__reloadEnvForTesting();
		}
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
