import type { UserRole } from '@nao/shared/types';

import { isCloudBillingEnabled } from '../env';
import { getCloudBillingPolicy, getOrganizationWithBilling } from '../queries/billing.queries';
import { isOrganizationDeactivated } from '../queries/organization.queries';
import { listOrgSeatCandidates, type OrgSeatCandidate } from '../queries/organization-seat.queries';
import { getProjectById, isProjectDeactivated } from '../queries/project.queries';
import { type BillingStatus, type CloudBillingTier, findCloudBillingPlan } from '../types/billing';
import { HandlerError } from '../utils/error';
import { isOpenProject } from '../utils/open-projects';

const ACTIVE_RECONCILIATION_GRACE_MS = 24 * 60 * 60 * 1000;
const BILLING_ACCESS_RESTRICTED_MESSAGE =
	'Cloud billing access is restricted. Ask an organization admin to update billing.';
const DEACTIVATED_MESSAGE = 'This workspace has been deactivated. Contact nao support to restore it.';

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

/** `seatLimit` is null when every member gets a seat. */
export type CloudEntitlement = {
	tier: CloudBillingTier;
	seatLimit: number | null;
	paidAccessEndsAt: Date | null;
};

export type OrganizationSeats = {
	entitlement: CloudEntitlement;
	candidates: OrgSeatCandidate[];
	readOnlyUserIds: Set<string>;
};

type SeatProject = string | { id: string; orgId: string | null };

const BYPASS_ENTITLEMENT: CloudEntitlement = { tier: 'bypass', seatLimit: null, paidAccessEndsAt: null };

export class CloudBillingSeatRestrictedError extends HandlerError {
	constructor() {
		super(
			'FORBIDDEN',
			'Cloud billing seat access is restricted. Your organization has more people than seats. Ask an organization admin to add a seat.',
		);
		this.name = 'CloudBillingSeatRestrictedError';
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

/** Organizations without a live trial or paid plan fall back to the free tier. */
export function resolveCloudEntitlement(
	billing: CloudBillingEntitlement | null,
	freeSeatLimit: number,
	now = Date.now(),
): CloudEntitlement {
	const paidAccessEndsAt = getCloudBillingAccessEndsAt(billing);
	const paidAccessAlive = paidAccessEndsAt !== null && paidAccessEndsAt.getTime() > now;
	if (paidAccessAlive && billing?.billingStatus === 'trialing') {
		return { tier: 'trial', seatLimit: null, paidAccessEndsAt };
	}
	const plan = paidAccessAlive ? findCloudBillingPlan(billing?.billingPlan) : null;
	if (plan?.tier === 'unlimited') {
		return { tier: 'unlimited', seatLimit: null, paidAccessEndsAt };
	}
	if (plan?.tier === 'team') {
		return { tier: 'team', seatLimit: billing?.seatQuantity ?? 0, paidAccessEndsAt };
	}
	return { tier: 'free', seatLimit: freeSeatLimit, paidAccessEndsAt: null };
}

export async function getOrganizationCloudEntitlement(organizationId: string): Promise<CloudEntitlement> {
	if (!isCloudBillingEnabled()) {
		return BYPASS_ENTITLEMENT;
	}
	const [organization, policy] = await Promise.all([
		getOrganizationWithBilling(organizationId),
		getCloudBillingPolicy(),
	]);
	if (!organization) {
		throw new HandlerError('NOT_FOUND', 'Organization was not found');
	}
	return organization.bypassBilling
		? BYPASS_ENTITLEMENT
		: resolveCloudEntitlement(organization.billing, policy.freeSeatLimit);
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

/** Every organization keeps at least free tier access, so only deactivation closes it. */
export async function hasProjectCloudBillingAccess(projectId: string): Promise<boolean> {
	if (await isProjectDeactivated(projectId)) {
		return false;
	}
	if (!isCloudBillingEnabled()) {
		return true;
	}
	const project = await getProjectById(projectId);
	return Boolean(project?.orgId);
}

/** With a `userId`, the person acting must also hold a seat in the organization. */
export async function assertOrganizationCloudBillingAccess(organizationId: string, userId?: string): Promise<void> {
	if (await isOrganizationDeactivated(organizationId)) {
		throw new HandlerError('FORBIDDEN', DEACTIVATED_MESSAGE);
	}
	if (userId && (await isUserReadOnly(organizationId, userId))) {
		throw new CloudBillingSeatRestrictedError();
	}
}

/** With a `userId`, the person acting must also hold a seat in the project's organization. */
export async function assertProjectCloudBillingAccess(projectId: string, userId?: string): Promise<void> {
	if (await isProjectDeactivated(projectId)) {
		throw new HandlerError('FORBIDDEN', DEACTIVATED_MESSAGE);
	}
	if (!isCloudBillingEnabled()) {
		return;
	}
	const project = await getProjectById(projectId);
	if (!project?.orgId) {
		throw new HandlerError('FORBIDDEN', BILLING_ACCESS_RESTRICTED_MESSAGE);
	}
	if (userId) {
		await assertProjectUserHasSeat(project, userId);
	}
}

export async function getOrganizationSeats(
	organizationId: string,
	knownEntitlement?: CloudEntitlement,
): Promise<OrganizationSeats> {
	const [entitlement, candidates] = await Promise.all([
		knownEntitlement ?? getOrganizationCloudEntitlement(organizationId),
		listOrgSeatCandidates(organizationId),
	]);
	const seatedUserIds = resolveSeatedUserIds(candidates, entitlement.seatLimit);
	return {
		entitlement,
		candidates,
		readOnlyUserIds: new Set(candidates.filter(({ id }) => !seatedUserIds.has(id)).map(({ id }) => id)),
	};
}

/** Admins always come first; a member an admin explicitly deselected never takes a seat. */
export function resolveSeatedUserIds(candidates: OrgSeatCandidate[], seatLimit: number | null): Set<string> {
	const eligible =
		seatLimit === null
			? candidates
			: candidates
					.filter(
						({ membershipClass, selectedAt, selectionExplicit }) =>
							membershipClass === 'org_admin' || selectedAt !== null || !selectionExplicit,
					)
					.slice(0, seatLimit);
	return new Set(eligible.map(({ id }) => id));
}

export async function isUserReadOnly(organizationId: string, userId: string): Promise<boolean> {
	if (!isCloudBillingEnabled()) {
		return false;
	}
	const entitlement = await getOrganizationCloudEntitlement(organizationId);
	if (entitlement.seatLimit === null) {
		return false;
	}
	return (await getOrganizationSeats(organizationId, entitlement)).readOnlyUserIds.has(userId);
}

export async function isProjectUserReadOnly(project: SeatProject, userId: string): Promise<boolean> {
	if (!isCloudBillingEnabled() || isOpenProject(typeof project === 'string' ? project : project.id)) {
		return false;
	}
	const orgId = typeof project === 'string' ? (await getProjectById(project))?.orgId : project.orgId;
	return orgId ? isUserReadOnly(orgId, userId) : false;
}

/** People without a seat keep viewing their projects, so the stored role is downgraded rather than removed. */
export async function resolveSeatedProjectRole(
	project: SeatProject,
	userId: string,
	role: UserRole | null,
): Promise<UserRole | null> {
	return role && role !== 'viewer' && (await isProjectUserReadOnly(project, userId)) ? 'viewer' : role;
}

export async function assertProjectUserHasSeat(project: SeatProject, userId: string): Promise<void> {
	if (await isProjectUserReadOnly(project, userId)) {
		throw new CloudBillingSeatRestrictedError();
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
