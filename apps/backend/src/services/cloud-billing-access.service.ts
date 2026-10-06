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
		case 'past_due':
			return isAfterWithGrace(entitlement.currentPeriodEndsAt, now, ACTIVE_RECONCILIATION_GRACE_MS);
		case 'active':
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

export function assertCloudBillingAccess(entitlement: CloudBillingEntitlement | null): void {
	if (!hasCloudBillingAccess(entitlement)) {
		throw new CloudBillingAccessRestrictedError();
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
	if (!isCloudBillingEnabled()) {
		return;
	}
	assertCloudBillingAccess(await getOrganizationBilling(organizationId));
}

export async function assertProjectCloudBillingAccess(projectId: string): Promise<void> {
	if (!isCloudBillingEnabled()) {
		return;
	}
	const project = await getProjectById(projectId);
	assertCloudBillingAccess(project?.orgId ? await getOrganizationBilling(project.orgId) : null);
}

function isAfter(date: Date | null, now: Date): boolean {
	return date !== null && date.getTime() > now.getTime();
}

function isAfterWithGrace(date: Date | null, now: Date, graceMs: number): boolean {
	return date !== null && date.getTime() + graceMs > now.getTime();
}
