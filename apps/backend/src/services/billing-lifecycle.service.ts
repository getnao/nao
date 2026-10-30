import { isCloudFreeTierEnabled } from '../env';
import * as billingQueries from '../queries/billing.queries';
import { CLOUD_BILLING_PLANS, isCloudBillingPlanKey } from '../types/billing';
import { withKeyedLock } from '../utils/keyed-lock';
import { logger, serializeError } from '../utils/logger';
import {
	reconcileCloudBillingCustomer,
	reconcileCloudBillingCustomerUnderLock,
} from './billing-reconciliation.service';
import { provisionCloudTrial } from './cloud-trial-provisioning.service';
import {
	cloudSubscriptionProjection,
	getCloudPlanChangeSchedule,
	getCloudSubscription,
	releaseCloudPlanChangeSchedule,
	updateCloudPlanChangeSchedule,
} from './stripe.service';

const BILLING_LIFECYCLE_CONCURRENCY = 5;

export async function runCloudBillingLifecycle(): Promise<void> {
	const pendingTrials = await billingQueries.listOrganizationTrialsPendingStripeProvisioning(new Date());
	const provisionedOrganizationIds = await provisionPendingTrials(pendingTrials);
	await reconcileMappedOrganizations(provisionedOrganizationIds);
}

async function provisionPendingTrials(
	billings: Awaited<ReturnType<typeof billingQueries.listOrganizationTrialsPendingStripeProvisioning>>,
): Promise<Set<string>> {
	const provisionedOrganizationIds = new Set<string>();
	for (let index = 0; index < billings.length; index += BILLING_LIFECYCLE_CONCURRENCY) {
		const organizationIds = await Promise.all(
			billings.slice(index, index + BILLING_LIFECYCLE_CONCURRENCY).map(provisionOrganizationTrial),
		);
		for (const organizationId of organizationIds) {
			if (organizationId) {
				provisionedOrganizationIds.add(organizationId);
			}
		}
	}
	return provisionedOrganizationIds;
}

async function provisionOrganizationTrial(
	billing: Awaited<ReturnType<typeof billingQueries.listOrganizationTrialsPendingStripeProvisioning>>[number],
): Promise<string | null> {
	try {
		await provisionCloudTrial(billing.orgId);
		return billing.orgId;
	} catch (error) {
		logger.error(`Cloud trial provisioning recovery failed for organization ${billing.orgId}`, {
			source: 'system',
			context: serializeError(error),
		});
		return null;
	}
}

async function reconcileMappedOrganizations(provisionedOrganizationIds: Set<string>): Promise<void> {
	const billings = (await billingQueries.listOrganizationBillingsWithStripeCustomers()).filter(
		(billing) => !provisionedOrganizationIds.has(billing.orgId),
	);
	for (let index = 0; index < billings.length; index += BILLING_LIFECYCLE_CONCURRENCY) {
		await Promise.all(billings.slice(index, index + BILLING_LIFECYCLE_CONCURRENCY).map(reconcileOrganization));
	}
}

async function reconcileOrganization(
	billing: Awaited<ReturnType<typeof billingQueries.listOrganizationBillingsWithStripeCustomers>>[number],
): Promise<void> {
	if (!billing.stripeCustomerId) {
		return;
	}
	try {
		if (!isCloudFreeTierEnabled()) {
			await reconcileCloudBillingCustomer({
				stripeCustomerId: billing.stripeCustomerId,
				organizationIdHint: billing.orgId,
			});
			return;
		}
		await withKeyedLock(`cloud-seats:${billing.orgId}`, async () => {
			const currentBilling = await billingQueries.getOrganizationBilling(billing.orgId);
			if (!currentBilling?.stripeCustomerId) {
				return;
			}
			await repairCloudPlanChangeSchedule(currentBilling);
			await reconcileCloudBillingCustomerUnderLock({
				stripeCustomerId: currentBilling.stripeCustomerId,
				organizationIdHint: billing.orgId,
			});
		});
	} catch (error) {
		logger.error(`Cloud billing reconciliation failed for organization ${billing.orgId}`, {
			source: 'system',
			context: serializeError(error),
		});
	}
}

async function repairCloudPlanChangeSchedule(
	billing: NonNullable<Awaited<ReturnType<typeof billingQueries.getOrganizationBilling>>>,
): Promise<void> {
	if (!billing.stripeSubscriptionId) {
		return;
	}
	const subscription = await getCloudSubscription(billing.stripeSubscriptionId);
	if (!subscription.schedule) {
		if (
			billing.stripeSubscriptionScheduleId ||
			billing.pendingBillingPlan ||
			billing.pendingSeatQuantity !== null
		) {
			await billingQueries.clearPendingBillingChange(billing.orgId);
		}
		return;
	}
	const projection = await cloudSubscriptionProjection(subscription);
	const scheduleId = projection.stripeSubscriptionScheduleId;
	if (!scheduleId) {
		return;
	}
	const activated = billing.pendingBillingPlan !== null && projection.billingPlan === billing.pendingBillingPlan;
	if (activated) {
		await releaseCloudPlanChangeSchedule(scheduleId);
		await billingQueries.clearPendingBillingChange(billing.orgId);
		return;
	}
	const safelyMatches =
		billing.pendingBillingPlan !== null &&
		projection.pendingBillingPlan === billing.pendingBillingPlan &&
		projection.pendingSeatQuantity === billing.pendingSeatQuantity;
	if (safelyMatches) {
		if (billing.stripeSubscriptionScheduleId !== scheduleId) {
			await billingQueries.attachSubscriptionSchedule(billing.orgId, scheduleId);
		}
		return;
	}
	if (
		projection.pendingBillingPlan === null &&
		isCloudBillingPlanKey(billing.pendingBillingPlan) &&
		billing.currentPeriodEndsAt
	) {
		const plan = CLOUD_BILLING_PLANS[billing.pendingBillingPlan];
		const targetQuantity = plan.tier === 'team' ? billing.pendingSeatQuantity : 1;
		if (targetQuantity !== null) {
			const schedule = await getCloudPlanChangeSchedule(scheduleId);
			await updateCloudPlanChangeSchedule({
				schedule,
				targetPlanKey: billing.pendingBillingPlan,
				targetQuantity,
				effectiveAt: billing.currentPeriodEndsAt,
			});
			await billingQueries.attachSubscriptionSchedule(billing.orgId, scheduleId);
			return;
		}
	}
	await releaseCloudPlanChangeSchedule(scheduleId);
	await billingQueries.clearPendingBillingChange(billing.orgId);
}
