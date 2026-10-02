import { isCloudBillingEnabled } from '../env';
import { getOrganizationBilling } from '../queries/billing.queries';
import { getProjectById } from '../queries/project.queries';
import type { BillingStatus } from '../types/billing';
import { HandlerError } from '../utils/error';

const ACTIVE_RECONCILIATION_GRACE_MS = 24 * 60 * 60 * 1000;

type CloudBillingEntitlement = {
	billingStatus: BillingStatus | null;
	stripeSubscriptionId: string | null;
	trialEndsAt: Date | null;
	currentPeriodEndsAt: Date | null;
	billingAccessEndsAt: Date | null;
	cancellationScheduled?: boolean | null;
	hasDefaultPaymentMethod?: boolean | null;
};

class CloudBillingAccessRestrictedError extends HandlerError {
	constructor() {
		super('FORBIDDEN', 'Cloud billing access is restricted. Ask an organization admin to update billing.');
		this.name = 'CloudBillingAccessRestrictedError';
	}
}

export function hasCloudBillingAccess(entitlement: CloudBillingEntitlement | null): boolean {
	if (!entitlement) {
		return false;
	}

	const now = new Date();
	switch (entitlement.billingStatus) {
		case 'trialing':
			if (entitlement.stripeSubscriptionId === null) {
				return false;
			}
			return entitlement.hasDefaultPaymentMethod && !entitlement.cancellationScheduled
				? isAfterWithGrace(entitlement.trialEndsAt, now, ACTIVE_RECONCILIATION_GRACE_MS)
				: isAfter(entitlement.trialEndsAt, now) &&
						(!entitlement.billingAccessEndsAt || isAfter(entitlement.billingAccessEndsAt, now));
		case 'active':
		case 'past_due':
			return entitlement.cancellationScheduled
				? isAfter(entitlement.billingAccessEndsAt ?? entitlement.currentPeriodEndsAt, now)
				: isAfterWithGrace(
						entitlement.currentPeriodEndsAt ?? entitlement.billingAccessEndsAt,
						now,
						ACTIVE_RECONCILIATION_GRACE_MS,
					);
		default:
			return false;
	}
}

export async function hasOrganizationCloudBillingAccess(organizationId: string): Promise<boolean> {
	if (!isCloudBillingEnabled()) {
		return true;
	}
	const billing = await getOrganizationBilling(organizationId);
	return hasCloudBillingAccess(billing);
}

export async function hasProjectCloudBillingAccess(projectId: string): Promise<boolean> {
	if (!isCloudBillingEnabled()) {
		return true;
	}
	const project = await getProjectById(projectId);
	if (!project?.orgId) {
		return false;
	}
	return hasOrganizationCloudBillingAccess(project.orgId);
}

export async function assertOrganizationCloudBillingAccess(organizationId: string): Promise<void> {
	if (!(await hasOrganizationCloudBillingAccess(organizationId))) {
		throw new CloudBillingAccessRestrictedError();
	}
}

export async function assertProjectCloudBillingAccess(projectId: string): Promise<void> {
	if (!(await hasProjectCloudBillingAccess(projectId))) {
		throw new CloudBillingAccessRestrictedError();
	}
}

function isAfter(date: Date | null, now: Date): boolean {
	return date !== null && date.getTime() > now.getTime();
}

function isAfterWithGrace(date: Date | null, now: Date, graceMs: number): boolean {
	return date !== null && date.getTime() + graceMs > now.getTime();
}
