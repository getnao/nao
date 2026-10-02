import { and, eq, isNotNull } from 'drizzle-orm';

import s, { DBOrganizationBilling, DBStripeWebhookEvent, NewStripeWebhookEvent } from '../db/abstractSchema';
import { db } from '../db/db';
import { BillingStatus } from '../types/billing';

export interface SubscriptionProjection {
	billingPlan: string;
	billingStatus: BillingStatus;
	stripeCustomerId: string;
	stripeSubscriptionId: string;
	stripePriceId: string;
	trialStartedAt: Date | null;
	trialEndsAt: Date | null;
	currentPeriodEndsAt: Date | null;
	cancellationScheduled: boolean;
	hasDefaultPaymentMethod: boolean;
	billingAccessEndsAt: Date | null;
}

interface BillingSyncClaim {
	billing: DBOrganizationBilling;
	token: string;
}

export async function getOrganizationBilling(orgId: string): Promise<DBOrganizationBilling | null> {
	const [billing] = await db
		.select()
		.from(s.organizationBilling)
		.where(eq(s.organizationBilling.orgId, orgId))
		.execute();
	return billing ?? null;
}

export async function attachStripeCustomer(orgId: string, stripeCustomerId: string): Promise<DBOrganizationBilling> {
	await db
		.insert(s.organizationBilling)
		.values({ orgId, stripeCustomerId, billingUpdatedAt: new Date() })
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
