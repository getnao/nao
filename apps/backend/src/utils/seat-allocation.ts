import type { OrgSeatCandidate } from '../queries/organization.queries';
import type { CloudEntitlement } from '../services/cloud-billing-access.service';

export function resolveSeatedOrgUserIds(candidates: OrgSeatCandidate[], seatLimit: number | null): string[] {
	const eligibleCandidates =
		seatLimit === null
			? candidates
			: candidates.filter(
					(candidate) =>
						candidate.membershipClass === 'org_admin' ||
						candidate.selectedAt !== null ||
						candidate.selectionExplicit !== true,
				);
	return eligibleCandidates.slice(0, seatLimit === null ? undefined : Math.max(0, seatLimit)).map(({ id }) => id);
}

/** A Team subscription without a known seat quantity makes every seat candidate read-only. */
export function resolveReadOnlyUserIds(entitlement: CloudEntitlement, candidates: OrgSeatCandidate[]): Set<string> {
	if (!enforcesSeats(entitlement)) {
		return new Set();
	}
	const seatedIds = new Set(
		entitlement.seatLimit === null ? [] : resolveSeatedOrgUserIds(candidates, entitlement.seatLimit),
	);
	return new Set(candidates.filter(({ id }) => !seatedIds.has(id)).map(({ id }) => id));
}

export function enforcesSeats(entitlement: CloudEntitlement): boolean {
	return entitlement.hasAccess && (entitlement.tier === 'free' || entitlement.tier === 'team');
}
