import { isCloudFreeTierEnabled } from '../env';
import * as billingQueries from '../queries/billing.queries';
import { listOrgSeatCandidates, type OrgSeatCandidate } from '../queries/organization.queries';
import {
	clearOrganizationSeatSelection,
	listOrganizationSeatStates,
	setOrganizationSeatSelection,
	syncOrganizationSeatState,
} from '../queries/organization-seat-state.queries';
import { withKeyedLock } from '../utils/keyed-lock';
import { resolveReadOnlyUserIds, resolveSeatedOrgUserIds } from '../utils/seat-allocation';
import { type CloudEntitlement, getOrganizationCloudEntitlement } from './cloud-billing-access.service';

export type SeatCandidate = ReturnType<typeof toSeatCandidate>;

export function withOrganizationSeatLock<T>(organizationId: string, operation: () => Promise<T>): Promise<T> {
	return withKeyedLock(`cloud-seats:${organizationId}`, operation);
}

/** Aligns stored seat state with enforced access and returns users who just became read-only. */
export async function syncOrganizationSeats(
	organizationId: string,
	resolvedEntitlement?: CloudEntitlement | null,
): Promise<string[]> {
	if (!isCloudFreeTierEnabled()) {
		return [];
	}
	const entitlement = resolvedEntitlement ?? (await getOrganizationCloudEntitlement(organizationId));
	if (!entitlement) {
		return [];
	}
	const [candidates, states] = await Promise.all([
		listOrgSeatCandidates(organizationId),
		listOrganizationSeatStates(organizationId),
	]);
	const readOnlyIds = resolveReadOnlyUserIds(entitlement, candidates);
	const userIds = new Set([...readOnlyIds, ...states.map(({ userId }) => userId)]);
	const changedAt = new Date();
	const newlyReadOnlyIds = await Promise.all(
		[...userIds].map(async (userId) => {
			const isReadOnly = readOnlyIds.has(userId);
			const { changed } = await syncOrganizationSeatState({
				orgId: organizationId,
				userId,
				isReadOnly,
				changedAt,
			});
			return changed && isReadOnly ? userId : null;
		}),
	);
	return newlyReadOnlyIds.filter((userId) => userId !== null);
}

/** Keeps the selection while another membership still makes the user a seat candidate. */
export async function clearSeatSelectionAndSync(organizationId: string, userId: string): Promise<void> {
	if (!isCloudFreeTierEnabled()) {
		return;
	}
	const candidates = await listOrgSeatCandidates(organizationId);
	if (!candidates.some(({ id }) => id === userId)) {
		await clearOrganizationSeatSelection(organizationId, userId);
	}
	await syncOrganizationSeats(organizationId);
}

/** Non-admin candidates keep a seat in the given order; everyone else is explicitly deselected. */
export async function applySeatSelection(
	organizationId: string,
	selectedUserIds: string[],
	resolvedEntitlement?: CloudEntitlement | null,
): Promise<string[]> {
	const candidates = await listOrgSeatCandidates(organizationId);
	const selectedAt = Date.now();
	await Promise.all(
		candidates
			.filter(({ membershipClass }) => membershipClass !== 'org_admin')
			.map(({ id }) => {
				const order = selectedUserIds.indexOf(id);
				return setOrganizationSeatSelection(
					organizationId,
					id,
					order === -1 ? null : new Date(selectedAt + order),
				);
			}),
	);
	return syncOrganizationSeats(organizationId, resolvedEntitlement);
}

export async function applyPendingFreeSeatSelection(
	organizationId: string,
	selectedUserIds: string[],
	entitlement: CloudEntitlement,
): Promise<string[]> {
	const newlyReadOnlyIds = await applySeatSelection(organizationId, selectedUserIds, entitlement);
	await billingQueries.setPendingFreeSeatSelection(organizationId, null);
	return newlyReadOnlyIds;
}

export async function loadSeatCandidates(organizationId: string, seatLimit: number | null) {
	const candidates = await listOrgSeatCandidates(organizationId);
	const seatedIds = new Set(resolveSeatedOrgUserIds(candidates, seatLimit));
	const seatCandidates = candidates.map((candidate) => toSeatCandidate(candidate, seatedIds));
	return {
		seatCandidates,
		seatedUsers: seatCandidates.filter(({ isSeated }) => isSeated),
		readOnlyUsers: seatCandidates.filter(({ isReadOnly }) => isReadOnly),
		selectedUserIds: seatCandidates.filter(({ isSelected }) => isSelected).map(({ userId }) => userId),
	};
}

function toSeatCandidate(candidate: OrgSeatCandidate, seatedIds: Set<string>) {
	const isSeated = seatedIds.has(candidate.id);
	return {
		userId: candidate.id,
		name: candidate.name,
		email: candidate.email,
		membershipClass: candidate.membershipClass,
		storedOrgRole: candidate.orgRole,
		storedProjectRoles: candidate.projectRoles,
		joinedAt: candidate.joinedAt,
		selectedAt: candidate.selectedAt,
		isSelected: candidate.selectedAt !== null,
		isSeated,
		isReadOnly: !isSeated,
	};
}
