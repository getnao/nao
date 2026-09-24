import { and, eq, gt, isNotNull, isNull, lte } from 'drizzle-orm';

import s, { DBOrganization, DBStripeWebhookEvent, NewStripeWebhookEvent } from '../db/abstractSchema';
import { db } from '../db/db';
import { BillingStatus, CLOUD_MONTHLY_PLAN } from '../types/billing';

export interface SubscriptionProjection {
	billingPlan: string;
	billingStatus: BillingStatus;
	stripeCustomerId: string;
	stripeSubscriptionId: string;
	stripePriceId: string;
	trialStartedAt: Date | null;
	trialEndsAt: Date | null;
	currentPeriodEndsAt: Date | null;
	cancelAtPeriodEnd: boolean;
	hasDefaultPaymentMethod: boolean;
	billingAccessEndsAt: Date | null;
}

interface BillingSyncClaim {
	organization: DBOrganization;
	token: string;
}

export async function startOrganizationTrial(orgId: string, now = new Date()): Promise<DBOrganization | null> {
	const trialEndsAt = new Date(now.getTime() + CLOUD_MONTHLY_PLAN.trialDays * 24 * 60 * 60 * 1000);
	const [organization] = await db
		.update(s.organization)
		.set({
			billingPlan: CLOUD_MONTHLY_PLAN.key,
			billingStatus: 'trialing',
			trialStartedAt: now,
			trialEndsAt,
			billingAccessEndsAt: trialEndsAt,
			billingUpdatedAt: now,
		})
		.where(
			and(
				eq(s.organization.id, orgId),
				isNull(s.organization.billingStatus),
				isNull(s.organization.trialStartedAt),
				isNull(s.organization.trialEndsAt),
				isNull(s.organization.stripeSubscriptionId),
			),
		)
		.returning()
		.execute();
	return organization ?? null;
}

export async function attachStripeCustomer(orgId: string, stripeCustomerId: string): Promise<DBOrganization> {
	await db
		.update(s.organization)
		.set({ stripeCustomerId, billingUpdatedAt: new Date() })
		.where(and(eq(s.organization.id, orgId), isNull(s.organization.stripeCustomerId)))
		.execute();

	const [organization] = await db.select().from(s.organization).where(eq(s.organization.id, orgId)).execute();
	if (!organization) {
		throw new Error(`Organization "${orgId}" was not found`);
	}
	if (organization.stripeCustomerId !== stripeCustomerId) {
		throw new Error(`Organization "${orgId}" is already attached to another Stripe Customer`);
	}
	return organization;
}

export async function claimBillingSync(orgId: string, stripeCustomerId: string): Promise<BillingSyncClaim> {
	const token = crypto.randomUUID();
	const [organization] = await db
		.update(s.organization)
		.set({ billingSyncToken: token })
		.where(and(eq(s.organization.id, orgId), eq(s.organization.stripeCustomerId, stripeCustomerId)))
		.returning()
		.execute();
	if (!organization) {
		throw new Error(`Organization "${orgId}" is not attached to Stripe Customer "${stripeCustomerId}"`);
	}
	return { organization, token };
}

export async function getOrganizationByStripeCustomerId(stripeCustomerId: string): Promise<DBOrganization | null> {
	const [organization] = await db
		.select()
		.from(s.organization)
		.where(eq(s.organization.stripeCustomerId, stripeCustomerId))
		.execute();
	return organization ?? null;
}

export async function listOrganizationsWithStripeCustomers(): Promise<DBOrganization[]> {
	return db.select().from(s.organization).where(isNotNull(s.organization.stripeCustomerId)).execute();
}

export async function listOrganizationsDueTrialReminder(now: Date, dueBefore: Date): Promise<DBOrganization[]> {
	return db
		.select()
		.from(s.organization)
		.where(
			and(
				eq(s.organization.billingStatus, 'trialing'),
				isNotNull(s.organization.trialEndsAt),
				gt(s.organization.trialEndsAt, now),
				lte(s.organization.trialEndsAt, dueBefore),
				isNull(s.organization.trialReminderClaimedAt),
			),
		)
		.execute();
}

export async function claimTrialReminder(orgId: string, trialEndsAt: Date, claimedAt: Date): Promise<boolean> {
	const [claimed] = await db
		.update(s.organization)
		.set({ trialReminderClaimedAt: claimedAt })
		.where(
			and(
				eq(s.organization.id, orgId),
				eq(s.organization.billingStatus, 'trialing'),
				eq(s.organization.trialEndsAt, trialEndsAt),
				isNull(s.organization.trialReminderClaimedAt),
			),
		)
		.returning({ id: s.organization.id })
		.execute();
	return Boolean(claimed);
}

export async function releaseTrialReminder(orgId: string, trialEndsAt: Date, claimedAt: Date): Promise<void> {
	await db
		.update(s.organization)
		.set({ trialReminderClaimedAt: null })
		.where(
			and(
				eq(s.organization.id, orgId),
				eq(s.organization.trialEndsAt, trialEndsAt),
				eq(s.organization.trialReminderClaimedAt, claimedAt),
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
		.update(s.organization)
		.set({ ...projection, billingUpdatedAt: new Date(), billingSyncToken: null })
		.where(
			and(
				eq(s.organization.id, orgId),
				eq(s.organization.billingSyncToken, syncToken),
				eq(s.organization.stripeCustomerId, projection.stripeCustomerId),
			),
		)
		.returning({ id: s.organization.id })
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
		.update(s.organization)
		.set({ hasDefaultPaymentMethod, billingUpdatedAt: new Date(), billingSyncToken: null })
		.where(
			and(
				eq(s.organization.id, orgId),
				eq(s.organization.billingSyncToken, syncToken),
				eq(s.organization.stripeCustomerId, stripeCustomerId),
			),
		)
		.returning({ id: s.organization.id })
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
