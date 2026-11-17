import { isCloudBillingEnabled, isCloudFreeTierEnabled } from '../env';
import { getOrganizationBilling } from '../queries/billing.queries';
import {
	countOrgSeatUsers,
	getOrganizationById,
	listOrgSeatCandidates,
	listReadOnlyOrgUsers,
} from '../queries/organization.queries';
import { getProjectById } from '../queries/project.queries';
import {
	type BillingStatus,
	FREE_TIER_SEAT_LIMIT,
	isCloudBillingPlanKey,
	isLegacyCloudBillingPlanKey,
	isTrialAvailable,
	type PaidCloudBillingTier,
} from '../types/billing';
import { HandlerError } from '../utils/error';
import { isOpenProject } from '../utils/open-projects';
import { enforcesSeats, resolveReadOnlyUserIds } from '../utils/seat-allocation';

const ACTIVE_RECONCILIATION_GRACE_MS = 24 * 60 * 60 * 1000;
const BILLING_ACCESS_RESTRICTED_MESSAGE =
	'Cloud billing access is restricted. Ask an organization admin to update billing.';
const PROJECT_SETUP_REQUIRED_MESSAGE =
	'Cloud billing access is restricted. Finish setting up your project to start the free trial.';

type CloudBillingEntitlement = {
	billingPlan?: string | null;
	billingStatus: BillingStatus | null;
	stripeSubscriptionId: string | null;
	seatQuantity?: number | null;
	trialEndsAt: Date | null;
	currentPeriodStartsAt: Date | null;
	currentPeriodEndsAt: Date | null;
	billingAccessEndsAt: Date | null;
	cancellationScheduled?: boolean | null;
	hasDefaultPaymentMethod?: boolean | null;
};

export type CloudEntitlement = {
	tier: 'bypass' | 'trial' | 'free' | 'team' | 'unlimited';
	billingPlan: string | null;
	seatUserCount: number;
	seatQuantity: number | null;
	seatLimit: number | null;
	availableSeats: number | null;
	overCapacity: boolean;
	paidAccessEndsAt: Date | null;
	hasAccess: boolean;
	freeTierEnabled: boolean;
};

export type ResolveCloudEntitlementInput = {
	billing: CloudBillingEntitlement | null;
	bypassBilling: boolean;
	cloudBillingEnabled: boolean;
	freeTierEnabled: boolean;
	seatUserCount: number;
	now?: number;
};

class CloudBillingAccessRestrictedError extends HandlerError {
	constructor(message = BILLING_ACCESS_RESTRICTED_MESSAGE) {
		super('FORBIDDEN', message);
		this.name = 'CloudBillingAccessRestrictedError';
	}
}

export class CloudBillingSeatRestrictedError extends HandlerError {
	constructor() {
		super(
			'FORBIDDEN',
			'Cloud billing seat access is restricted. Your organization has more people than seats. Ask an organization admin to add a seat.',
		);
		this.name = 'CloudBillingSeatRestrictedError';
	}
}

export function hasCloudBillingAccess(entitlement: CloudBillingEntitlement | null, now = Date.now()): boolean {
	const accessEndsAt = getCloudBillingAccessEndsAt(entitlement);
	return accessEndsAt !== null && accessEndsAt.getTime() > now;
}

export function getCloudBillingAccessEndsAt(entitlement: CloudBillingEntitlement | null): Date | null {
	if (!entitlement) {
		return null;
	}
	if (entitlement.billingStatus !== 'trialing' && !entitlement.billingPlan) {
		return null;
	}
	switch (entitlement.billingStatus) {
		case 'trialing':
			if (entitlement.stripeSubscriptionId === null) {
				return getLocalTrialAccessEndsAt(entitlement);
			}
			if (entitlement.billingPlan && entitlement.hasDefaultPaymentMethod && !entitlement.cancellationScheduled) {
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

export function isActiveLocalTrial(entitlement: CloudBillingEntitlement | null, now = Date.now()): boolean {
	const accessEndsAt = getLocalTrialAccessEndsAt(entitlement);
	return accessEndsAt !== null && accessEndsAt.getTime() > now;
}

export function isActiveTrialWithoutPaidPlan(entitlement: CloudBillingEntitlement | null, now = Date.now()): boolean {
	if (entitlement?.billingPlan || entitlement?.billingStatus !== 'trialing') {
		return false;
	}
	if (!entitlement.billingAccessEndsAt) {
		return false;
	}
	const accessEndsAt = earlierDate(entitlement.trialEndsAt, entitlement.billingAccessEndsAt);
	return accessEndsAt !== null && accessEndsAt.getTime() > now;
}

export function isExpiredTrialWithoutPaidPlan(entitlement: CloudBillingEntitlement | null, now = Date.now()): boolean {
	if (entitlement?.billingPlan || entitlement?.billingStatus !== 'trialing') {
		return false;
	}
	const accessEndsAt = getCloudBillingAccessEndsAt(entitlement);
	return accessEndsAt !== null && accessEndsAt.getTime() <= now;
}

function getLocalTrialAccessEndsAt(entitlement: CloudBillingEntitlement | null): Date | null {
	if (entitlement?.billingStatus !== 'trialing' || entitlement.stripeSubscriptionId !== null) {
		return null;
	}
	if (!entitlement.trialEndsAt || !entitlement.billingAccessEndsAt) {
		return null;
	}
	return earlierDate(entitlement.trialEndsAt, entitlement.billingAccessEndsAt);
}

export function resolveCloudEntitlement(input: ResolveCloudEntitlementInput): CloudEntitlement {
	const now = input.now ?? Date.now();
	const paidAccessEndsAt = getCloudBillingAccessEndsAt(input.billing);
	const billingPlan = input.billing?.billingPlan ?? null;
	const base = {
		billingPlan,
		seatUserCount: input.seatUserCount,
		paidAccessEndsAt,
		freeTierEnabled: input.freeTierEnabled,
	};
	if (!input.cloudBillingEnabled || input.bypassBilling) {
		return {
			...base,
			tier: 'bypass',
			seatQuantity: null,
			seatLimit: null,
			availableSeats: null,
			overCapacity: false,
			hasAccess: true,
		};
	}

	const paidAccessAlive = paidAccessEndsAt !== null && paidAccessEndsAt.getTime() > now;
	if (input.billing?.billingStatus === 'trialing' && paidAccessAlive) {
		return {
			...base,
			tier: 'trial',
			seatQuantity: input.billing.seatQuantity ?? null,
			seatLimit: null,
			availableSeats: null,
			overCapacity: false,
			hasAccess: true,
		};
	}

	const paidTier = paidAccessAlive && billingPlan ? paidTierForPlan(billingPlan) : null;
	if (paidTier === 'unlimited') {
		return {
			...base,
			tier: 'unlimited',
			seatQuantity: null,
			seatLimit: null,
			availableSeats: null,
			overCapacity: false,
			hasAccess: true,
		};
	}
	if (paidTier === 'team') {
		const seatQuantity = input.billing?.seatQuantity ?? null;
		return {
			...base,
			tier: 'team',
			seatQuantity,
			seatLimit: seatQuantity,
			availableSeats: seatQuantity === null ? null : Math.max(0, seatQuantity - input.seatUserCount),
			overCapacity: seatQuantity !== null && input.seatUserCount > seatQuantity,
			hasAccess: true,
		};
	}

	return {
		...base,
		tier: 'free',
		seatQuantity: null,
		seatLimit: FREE_TIER_SEAT_LIMIT,
		availableSeats: Math.max(0, FREE_TIER_SEAT_LIMIT - input.seatUserCount),
		overCapacity: input.seatUserCount > FREE_TIER_SEAT_LIMIT,
		hasAccess: input.freeTierEnabled || paidAccessAlive,
	};
}

export async function getOrganizationCloudEntitlement(organizationId: string): Promise<CloudEntitlement | null> {
	const cloudBillingEnabled = isCloudBillingEnabled();
	const freeTierEnabled = isCloudFreeTierEnabled();
	if (!cloudBillingEnabled) {
		return resolveCloudEntitlement({
			billing: null,
			bypassBilling: false,
			cloudBillingEnabled,
			freeTierEnabled,
			seatUserCount: 0,
		});
	}
	const organization = await getOrganizationById(organizationId);
	if (!organization) {
		return null;
	}
	if (organization.bypassBilling) {
		return resolveCloudEntitlement({
			billing: null,
			bypassBilling: true,
			cloudBillingEnabled,
			freeTierEnabled,
			seatUserCount: 0,
		});
	}
	const [billing, seatUserCount] = await Promise.all([
		getOrganizationBilling(organizationId),
		freeTierEnabled ? countOrgSeatUsers(organizationId) : Promise.resolve(0),
	]);
	const entitlement = resolveCloudEntitlement({
		billing,
		bypassBilling: false,
		cloudBillingEnabled,
		freeTierEnabled,
		seatUserCount,
	});
	if (entitlement.seatLimit === null) {
		return entitlement;
	}
	const readOnlyUserCount = (await listReadOnlyOrgUsers(organizationId, entitlement.seatLimit)).length;
	return {
		...entitlement,
		availableSeats: Math.max(0, entitlement.seatLimit - (seatUserCount - readOnlyUserCount)),
	};
}

export async function hasOrganizationCloudBillingAccess(
	organizationId: string,
	resolvedEntitlement?: CloudEntitlement | null,
): Promise<boolean> {
	if (!isCloudBillingEnabled()) {
		return true;
	}
	if (resolvedEntitlement) {
		return resolvedEntitlement.hasAccess;
	}
	if (isCloudFreeTierEnabled()) {
		return (await getOrganizationCloudEntitlement(organizationId))?.hasAccess ?? false;
	}
	const organization = await getOrganizationById(organizationId);
	if (organization?.bypassBilling) {
		return true;
	}
	const billing = await getOrganizationBilling(organizationId);
	return hasCloudBillingAccess(billing);
}

export async function hasProjectCloudBillingAccess(
	projectId: string,
	resolvedEntitlement?: CloudEntitlement | null,
): Promise<boolean> {
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
	return hasOrganizationCloudBillingAccess(project.orgId, resolvedEntitlement);
}

export async function hasUserCloudBillingAccess(
	organizationId: string,
	userId: string,
	resolvedEntitlement?: CloudEntitlement | null,
): Promise<boolean> {
	return !(await isUserReadOnlyInOrganization(organizationId, userId, resolvedEntitlement));
}

export async function isUserReadOnlyInOrganization(
	organizationId: string,
	userId: string,
	resolvedEntitlement?: CloudEntitlement | null,
): Promise<boolean> {
	if (!isCloudFreeTierEnabled()) {
		return false;
	}
	const entitlement = resolvedEntitlement ?? (await getOrganizationCloudEntitlement(organizationId));
	if (!entitlement || !enforcesSeats(entitlement)) {
		return false;
	}
	return resolveReadOnlyUserIds(entitlement, await listOrgSeatCandidates(organizationId)).has(userId);
}

export async function assertOrganizationCloudBillingAccess(
	organizationId: string,
	resolvedEntitlement?: CloudEntitlement | null,
): Promise<void> {
	if (!(await hasOrganizationCloudBillingAccess(organizationId, resolvedEntitlement))) {
		const billing = await getOrganizationBilling(organizationId);
		throw new CloudBillingAccessRestrictedError(
			isTrialAvailable(billing) ? PROJECT_SETUP_REQUIRED_MESSAGE : BILLING_ACCESS_RESTRICTED_MESSAGE,
		);
	}
}

export async function assertProjectCloudBillingAccess(
	projectId: string,
	resolvedEntitlement?: CloudEntitlement | null,
): Promise<void> {
	if (!isCloudBillingEnabled()) {
		return;
	}
	const project = await getProjectById(projectId);
	if (!project?.orgId) {
		throw new CloudBillingAccessRestrictedError();
	}
	await assertOrganizationCloudBillingAccess(project.orgId, resolvedEntitlement);
}

export async function assertProjectSetupCloudBillingAccess(organizationId: string, userId: string): Promise<void> {
	if (!isCloudBillingEnabled()) {
		return;
	}
	const billing = await getOrganizationBilling(organizationId);
	if (isTrialAvailable(billing)) {
		await assertUserCloudBillingAccess(organizationId, userId);
		return;
	}
	const entitlement = await getOrganizationCloudEntitlement(organizationId);
	await assertOrganizationCloudBillingAccess(organizationId, entitlement);
	await assertUserCloudBillingAccess(organizationId, userId, entitlement);
}

export async function assertProjectUserCloudBillingAccess(projectId: string, userId: string): Promise<void> {
	if (await isProjectUserReadOnly(projectId, userId)) {
		throw new CloudBillingSeatRestrictedError();
	}
}

export async function isProjectUserReadOnly(projectId: string, userId: string): Promise<boolean> {
	if (!isCloudFreeTierEnabled() || isOpenProject(projectId)) {
		return false;
	}
	const project = await getProjectById(projectId);
	if (!project?.orgId) {
		throw new CloudBillingAccessRestrictedError();
	}
	return isUserReadOnlyInOrganization(project.orgId, userId);
}

export async function assertUserCloudBillingAccess(
	organizationId: string,
	userId: string,
	resolvedEntitlement?: CloudEntitlement | null,
): Promise<void> {
	if (!(await hasUserCloudBillingAccess(organizationId, userId, resolvedEntitlement))) {
		throw new CloudBillingSeatRestrictedError();
	}
}

function paidTierForPlan(billingPlan: string): PaidCloudBillingTier | null {
	if (isCloudBillingPlanKey(billingPlan)) {
		return billingPlan.startsWith('cloud_team_') ? 'team' : 'unlimited';
	}
	return isLegacyCloudBillingPlanKey(billingPlan) ? 'unlimited' : null;
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
