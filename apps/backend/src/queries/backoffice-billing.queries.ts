/* @license Enterprise */

import { desc, eq, or } from 'drizzle-orm';

import s from '../db/abstractSchema';
import { db } from '../db/db';

export async function listOrganizationsWithBilling() {
	return db
		.select({
			id: s.organization.id,
			name: s.organization.name,
			slug: s.organization.slug,
			bypassBilling: s.organization.bypassBilling,
			createdAt: s.organization.createdAt,
			billing: s.organizationBilling,
		})
		.from(s.organization)
		.leftJoin(s.organizationBilling, eq(s.organizationBilling.orgId, s.organization.id))
		.orderBy(desc(s.organization.createdAt))
		.execute();
}

export async function listRecentStripeWebhookEvents(limit: number) {
	return db
		.select({
			id: s.stripeWebhookEvent.id,
			type: s.stripeWebhookEvent.type,
			stripeObjectId: s.stripeWebhookEvent.stripeObjectId,
			receivedAt: s.stripeWebhookEvent.receivedAt,
			processedAt: s.stripeWebhookEvent.processedAt,
			lastError: s.stripeWebhookEvent.lastError,
			orgId: s.organization.id,
			orgName: s.organization.name,
		})
		.from(s.stripeWebhookEvent)
		.leftJoin(
			s.organizationBilling,
			or(
				eq(s.organizationBilling.stripeSubscriptionId, s.stripeWebhookEvent.stripeObjectId),
				eq(s.organizationBilling.stripeCustomerId, s.stripeWebhookEvent.stripeObjectId),
			),
		)
		.leftJoin(s.organization, eq(s.organization.id, s.organizationBilling.orgId))
		.orderBy(desc(s.stripeWebhookEvent.receivedAt))
		.limit(limit)
		.execute();
}
