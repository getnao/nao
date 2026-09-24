import { isCloudBillingEnabled } from '../env';
import type { BillingStatus } from '../types/billing';
import { HandlerError } from '../utils/error';

const ACTIVE_RECONCILIATION_GRACE_MS = 24 * 60 * 60 * 1000;

type CloudBillingEntitlement = {
	billingStatus: BillingStatus | null;
	trialEndsAt: Date | null;
	currentPeriodEndsAt: Date | null;
	billingAccessEndsAt: Date | null;
	cancelAtPeriodEnd?: boolean | null;
};

class CloudBillingAccessRestrictedError extends HandlerError {
	constructor() {
		super('FORBIDDEN', 'Cloud billing access is restricted. Ask an organization admin to update billing.');
		this.name = 'CloudBillingAccessRestrictedError';
	}
}

export function hasCloudBillingAccess(
	billingEnabled: boolean,
	entitlement: CloudBillingEntitlement | null,
	now = new Date(),
): boolean {
	if (!billingEnabled) {
		return true;
	}
	if (!entitlement) {
		return false;
	}

	switch (entitlement.billingStatus) {
		case 'trialing':
			return (
				isAfter(entitlement.trialEndsAt, now) &&
				(!entitlement.billingAccessEndsAt || isAfter(entitlement.billingAccessEndsAt, now))
			);
		case 'active':
			return entitlement.cancelAtPeriodEnd
				? isAfter(entitlement.billingAccessEndsAt ?? entitlement.currentPeriodEndsAt, now)
				: isAfterWithGrace(
						entitlement.currentPeriodEndsAt ?? entitlement.billingAccessEndsAt,
						now,
						ACTIVE_RECONCILIATION_GRACE_MS,
					);
		case 'past_due':
			return true;
		default:
			return false;
	}
}

export async function hasOrganizationCloudBillingAccess(organizationId: string, now = new Date()): Promise<boolean> {
	if (!isCloudBillingEnabled()) {
		return true;
	}
	const { getOrganizationById } = await import('../queries/organization.queries');
	const organization = await getOrganizationById(organizationId);
	return hasCloudBillingAccess(true, organization, now);
}

export async function hasProjectCloudBillingAccess(projectId: string, now = new Date()): Promise<boolean> {
	if (!isCloudBillingEnabled()) {
		return true;
	}
	const { getProjectById } = await import('../queries/project.queries');
	const project = await getProjectById(projectId);
	if (!project?.orgId) {
		return false;
	}
	return hasOrganizationCloudBillingAccess(project.orgId, now);
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
