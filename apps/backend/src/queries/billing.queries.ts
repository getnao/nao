import { and, eq, gt, isNotNull, isNull } from 'drizzle-orm';

import s, {
	DBOrganization,
	DBOrganizationBilling,
	DBStripeWebhookEvent,
	NewStripeWebhookEvent,
} from '../db/abstractSchema';
import { db, type DBExecutor } from '../db/db';
import dbConfig, { Dialect } from '../db/dbConfig';
import { type BillingStatus, CLOUD_BILLING_TRIAL_DAYS } from '../types/billing';

export interface SubscriptionProjection {
	billingPlan: string | null;
	billingStatus: BillingStatus;
	stripeCustomerId: string;
	stripeSubscriptionId: string;
	stripePriceId: string;
	trialStartedAt: Date | null;
	trialEndsAt: Date | null;
	currentPeriodStartsAt: Date | null;
	currentPeriodEndsAt: Date | null;
	cancellationScheduled: boolean;
	hasDefaultPaymentMethod: boolean;
	billingAccessEndsAt: Date | null;
}

interface BillingSyncClaim {
	billing: DBOrganizationBilling;
	token: string;
}

export type OrganizationWithBilling = DBOrganization & { billing: DBOrganizationBilling | null };

export async function getOrganizationWithBilling(orgId: string): Promise<OrganizationWithBilling | null> {
	const [result] = await db
		.select({ organization: s.organization, billing: s.organizationBilling })
		.from(s.organization)
		.leftJoin(s.organizationBilling, eq(s.organizationBilling.orgId, s.organization.id))
		.where(eq(s.organization.id, orgId))
		.execute();
	return result ? { ...result.organization, billing: result.billing } : null;
}

export async function getOrganizationBilling(orgId: string): Promise<DBOrganizationBilling | null> {
	const [billing] = await db
		.select()
		.from(s.organizationBilling)
		.where(eq(s.organizationBilling.orgId, orgId))
		.execute();
	return billing ?? null;
}

export function startOrganizationTrial(orgId: string, now: Date, executor: DBExecutor): boolean | Promise<boolean> {
	const trialEndsAt = new Date(now);
	trialEndsAt.setUTCDate(trialEndsAt.getUTCDate() + CLOUD_BILLING_TRIAL_DAYS);
	const trial = {
		orgId,
		billingStatus: 'trialing' as const,
		trialStartedAt: now,
		trialEndsAt,
		billingAccessEndsAt: trialEndsAt,
		billingUpdatedAt: now,
	};
	if (dbConfig.dialect === Dialect.Postgres) {
		return startPostgresOrganizationTrial(trial, executor);
	}
	return startSqliteOrganizationTrial(trial, executor);
}

type OrganizationTrial = {
	orgId: string;
	billingStatus: 'trialing';
	trialStartedAt: Date;
	trialEndsAt: Date;
	billingAccessEndsAt: Date;
	billingUpdatedAt: Date;
};

function availableTrialBilling(orgId: string) {
	return and(
		eq(s.organizationBilling.orgId, orgId),
		isNull(s.organizationBilling.billingStatus),
		isNull(s.organizationBilling.trialStartedAt),
		isNull(s.organizationBilling.trialEndsAt),
		isNull(s.organizationBilling.stripeSubscriptionId),
	);
}

function startSqliteOrganizationTrial(trial: OrganizationTrial, executor: DBExecutor): boolean {
	const updateExisting = () =>
		executor
			.update(s.organizationBilling)
			.set(trial)
			.where(availableTrialBilling(trial.orgId))
			.returning({ orgId: s.organizationBilling.orgId })
			.all()[0];
	if (updateExisting()) {
		return true;
	}
	const [created] = executor
		.insert(s.organizationBilling)
		.values(trial)
		.onConflictDoNothing()
		.returning({ orgId: s.organizationBilling.orgId })
		.all();
	return Boolean(created || updateExisting());
}

async function startPostgresOrganizationTrial(trial: OrganizationTrial, executor: DBExecutor): Promise<boolean> {
	const updateExisting = async () =>
		(
			await executor
				.update(s.organizationBilling)
				.set(trial)
				.where(availableTrialBilling(trial.orgId))
				.returning({ orgId: s.organizationBilling.orgId })
				.execute()
		)[0];
	if (await updateExisting()) {
		return true;
	}
	const [created] = await executor
		.insert(s.organizationBilling)
		.values(trial)
		.onConflictDoNothing()
		.returning({ orgId: s.organizationBilling.orgId })
		.execute();
	return Boolean(created || (await updateExisting()));
}

export async function attachStripeCustomer(orgId: string, stripeCustomerId: string): Promise<DBOrganizationBilling> {
	const billingUpdatedAt = new Date();
	await db
		.update(s.organizationBilling)
		.set({ stripeCustomerId, billingUpdatedAt })
		.where(and(eq(s.organizationBilling.orgId, orgId), isNull(s.organizationBilling.stripeCustomerId)))
		.execute();
	await db
		.insert(s.organizationBilling)
		.values({ orgId, stripeCustomerId, billingUpdatedAt })
		.onConflictDoNothing()
		.execute();

	const billing = await getOrganizationBilling(orgId);
	if (!billing) {
		throw new Error(`Unable to attach Stripe Customer "${stripeCustomerId}" to organization "${orgId}"`);
	}
	if (billing.stripeCustomerId !== stripeCustomerId) {
		throw new Error(`Organization "${orgId}" is already attached to another Stripe Customer`);
	}
	return billing;
}

export async function claimBillingSync(orgId: string, stripeCustomerId: string): Promise<BillingSyncClaim> {
	const token = crypto.randomUUID();
	const [billing] = await db
		.update(s.organizationBilling)
		.set({ billingSyncToken: token })
		.where(
			and(eq(s.organizationBilling.orgId, orgId), eq(s.organizationBilling.stripeCustomerId, stripeCustomerId)),
		)
		.returning()
		.execute();
	if (!billing) {
		throw new Error(`Organization "${orgId}" is not attached to Stripe Customer "${stripeCustomerId}"`);
	}
	return { billing, token };
}

export async function getOrganizationBillingByStripeCustomerId(
	stripeCustomerId: string,
): Promise<DBOrganizationBilling | null> {
	const [billing] = await db
		.select()
		.from(s.organizationBilling)
		.where(eq(s.organizationBilling.stripeCustomerId, stripeCustomerId))
		.execute();
	return billing ?? null;
}

export async function listOrganizationBillingsWithStripeCustomers(): Promise<DBOrganizationBilling[]> {
	return db.select().from(s.organizationBilling).where(isNotNull(s.organizationBilling.stripeCustomerId)).execute();
}

export async function listOrganizationTrialsPendingStripeProvisioning(now: Date): Promise<DBOrganizationBilling[]> {
	return db
		.select()
		.from(s.organizationBilling)
		.where(
			and(
				eq(s.organizationBilling.billingStatus, 'trialing'),
				gt(s.organizationBilling.trialEndsAt, now),
				isNull(s.organizationBilling.stripeSubscriptionId),
			),
		)
		.execute();
}

export async function updateSubscriptionProjection(
	orgId: string,
	syncToken: string,
	projection: SubscriptionProjection,
): Promise<boolean> {
	const [updated] = await db
		.update(s.organizationBilling)
		.set({ ...projection, billingUpdatedAt: new Date(), billingSyncToken: null })
		.where(
			and(
				eq(s.organizationBilling.orgId, orgId),
				eq(s.organizationBilling.billingSyncToken, syncToken),
				eq(s.organizationBilling.stripeCustomerId, projection.stripeCustomerId),
			),
		)
		.returning({ orgId: s.organizationBilling.orgId })
		.execute();
	return Boolean(updated);
}

export async function updatePaymentMethodProjection(
	orgId: string,
	syncToken: string,
	stripeCustomerId: string,
	hasDefaultPaymentMethod: boolean,
): Promise<boolean> {
	const [updated] = await db
		.update(s.organizationBilling)
		.set({ hasDefaultPaymentMethod, billingUpdatedAt: new Date(), billingSyncToken: null })
		.where(
			and(
				eq(s.organizationBilling.orgId, orgId),
				eq(s.organizationBilling.billingSyncToken, syncToken),
				eq(s.organizationBilling.stripeCustomerId, stripeCustomerId),
			),
		)
		.returning({ orgId: s.organizationBilling.orgId })
		.execute();
	return Boolean(updated);
}

export async function insertStripeWebhookEvent(event: NewStripeWebhookEvent): Promise<DBStripeWebhookEvent | null> {
	const [inserted] = await db.insert(s.stripeWebhookEvent).values(event).onConflictDoNothing().returning().execute();
	return inserted ?? null;
}

export async function getStripeWebhookEvent(id: string): Promise<DBStripeWebhookEvent | null> {
	const [event] = await db.select().from(s.stripeWebhookEvent).where(eq(s.stripeWebhookEvent.id, id)).execute();
	return event ?? null;
}

export async function markStripeWebhookEventProcessed(id: string): Promise<void> {
	await db
		.update(s.stripeWebhookEvent)
		.set({ processedAt: new Date(), lastError: null })
		.where(eq(s.stripeWebhookEvent.id, id))
		.execute();
}

export async function markStripeWebhookEventFailed(id: string, error: string): Promise<void> {
	await db.update(s.stripeWebhookEvent).set({ lastError: error }).where(eq(s.stripeWebhookEvent.id, id)).execute();
}
