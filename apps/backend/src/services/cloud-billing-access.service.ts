import { isCloudBillingEnabled } from '../env';
import { getOrganizationBilling } from '../queries/billing.queries';
import { getOrganizationById } from '../queries/organization.queries';
import { getProjectById } from '../queries/project.queries';
import type { BillingStatus } from '../types/billing';
import { HandlerError } from '../utils/error';

const ACTIVE_RECONCILIATION_GRACE_MS = 24 * 60 * 60 * 1000;

type CloudBillingEntitlement = {
	billingStatus: BillingStatus | null;
	stripeSubscriptionId: string | null;
	trialEndsAt: Date | null;
	currentPeriodStartsAt: Date | null;
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
	const accessEndsAt = getCloudBillingAccessEndsAt(entitlement);
	return accessEndsAt !== null && accessEndsAt.getTime() > Date.now();
}

export function getCloudBillingAccessEndsAt(entitlement: CloudBillingEntitlement | null): Date | null {
	if (!entitlement) {
		return null;
	}
	switch (entitlement.billingStatus) {
		case 'trialing':
			if (entitlement.stripeSubscriptionId === null) {
				return null;
			}
			if (entitlement.hasDefaultPaymentMethod && !entitlement.cancellationScheduled) {
				return addGrace(entitlement.trialEndsAt);
			}
			return earlierDate(entitlement.trialEndsAt, entitlement.billingAccessEndsAt);
		case 'past_due':
			return addGrace(entitlement.currentPeriodEndsAt);
		case 'active':
			return entitlement.cancellationScheduled
				? (entitlement.billingAccessEndsAt ?? entitlement.currentPeriodEndsAt)
				: addGrace(entitlement.currentPeriodEndsAt ?? entitlement.billingAccessEndsAt);
		default:
			return null;
	}
}

export async function hasOrganizationCloudBillingAccess(organizationId: string): Promise<boolean> {
	if (!isCloudBillingEnabled()) {
		return true;
	}
	const organization = await getOrganizationById(organizationId);
	if (organization?.bypassBilling) {
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
	if (!project) {
		return false;
	}
	if (!project.orgId) {
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

function addGrace(date: Date | null): Date | null {
	return date ? new Date(date.getTime() + ACTIVE_RECONCILIATION_GRACE_MS) : null;
}

function earlierDate(first: Date | null, second: Date | null): Date | null {
	if (!first) {
		return null;
	}
	return second && second < first ? second : first;
}
