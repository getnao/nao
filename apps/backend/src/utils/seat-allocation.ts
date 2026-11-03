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

export function resolveReadOnlyUserIds(entitlement: CloudEntitlement, candidates: OrgSeatCandidate[]): Set<string> {
	const seatLimit = enforcedSeatLimit(entitlement);
	if (seatLimit === null) {
		return new Set();
	}
	const seatedIds = new Set(resolveSeatedOrgUserIds(candidates, seatLimit));
	return new Set(candidates.filter(({ id }) => !seatedIds.has(id)).map(({ id }) => id));
}

/** A Team subscription without a known seat quantity seats nobody. */
export function enforcedSeatLimit(entitlement: CloudEntitlement): number | null {
	return enforcesSeats(entitlement) ? (entitlement.seatLimit ?? 0) : null;
}

export function enforcesSeats(entitlement: CloudEntitlement): boolean {
	return entitlement.hasAccess && (entitlement.tier === 'free' || entitlement.tier === 'team');
}
