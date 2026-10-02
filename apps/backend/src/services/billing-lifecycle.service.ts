import * as billingQueries from '../queries/billing.queries';
import { logger, serializeError } from '../utils/logger';
import { reconcileCloudBillingCustomer } from './billing-reconciliation.service';

const RECONCILIATION_CONCURRENCY = 5;

export async function runCloudBillingLifecycle(): Promise<void> {
	await reconcileMappedOrganizations();
}

async function reconcileMappedOrganizations(): Promise<void> {
	const billings = await billingQueries.listOrganizationBillingsWithStripeCustomers();
	for (let index = 0; index < billings.length; index += RECONCILIATION_CONCURRENCY) {
		await Promise.all(billings.slice(index, index + RECONCILIATION_CONCURRENCY).map(reconcileOrganization));
	}
}

async function reconcileOrganization(
	billing: Awaited<ReturnType<typeof billingQueries.listOrganizationBillingsWithStripeCustomers>>[number],
): Promise<void> {
	if (!billing.stripeCustomerId) {
		return;
	}
	try {
		await reconcileCloudBillingCustomer({
			stripeCustomerId: billing.stripeCustomerId,
			organizationIdHint: billing.orgId,
		});
	} catch (error) {
		logger.error(`Cloud billing reconciliation failed for organization ${billing.orgId}`, {
			source: 'system',
			context: serializeError(error),
		});
	}
}
