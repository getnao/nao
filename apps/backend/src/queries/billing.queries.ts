import { and, eq, isNull } from 'drizzle-orm';

import s, { DBOrganization, DBStripeWebhookEvent, NewStripeWebhookEvent } from '../db/abstractSchema';
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
	cancelAtPeriodEnd: boolean;
	billingAccessEndsAt: Date | null;
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

export async function getOrganizationByStripeCustomerId(stripeCustomerId: string): Promise<DBOrganization | null> {
	const [organization] = await db
		.select()
		.from(s.organization)
		.where(eq(s.organization.stripeCustomerId, stripeCustomerId))
		.execute();
	return organization ?? null;
}

export async function getOrganizationByStripeSubscriptionId(
	stripeSubscriptionId: string,
): Promise<DBOrganization | null> {
	const [organization] = await db
		.select()
		.from(s.organization)
		.where(eq(s.organization.stripeSubscriptionId, stripeSubscriptionId))
		.execute();
	return organization ?? null;
}

export async function updateSubscriptionProjection(orgId: string, projection: SubscriptionProjection): Promise<void> {
	await db.transaction(async (tx) => {
		const [organization] = await tx.select().from(s.organization).where(eq(s.organization.id, orgId)).execute();
		if (!organization) {
			throw new Error(`Organization "${orgId}" was not found`);
		}
		if (organization.stripeCustomerId && organization.stripeCustomerId !== projection.stripeCustomerId) {
			throw new Error(`Organization "${orgId}" is attached to another Stripe Customer`);
		}
		if (
			organization.stripeSubscriptionId &&
			organization.stripeSubscriptionId !== projection.stripeSubscriptionId &&
			!['canceled', 'incomplete_expired'].includes(organization.billingStatus ?? '')
		) {
			throw new Error(`Organization "${orgId}" is attached to another Stripe Subscription`);
		}

		await tx
			.update(s.organization)
			.set({
				...projection,
				trialStartedAt: projection.trialStartedAt ?? organization.trialStartedAt,
				trialEndsAt: projection.trialEndsAt ?? organization.trialEndsAt,
				billingUpdatedAt: new Date(),
			})
			.where(eq(s.organization.id, orgId))
			.execute();
	});
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
