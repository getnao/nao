import { isCloudBillingEnabled } from '../env';
import * as billingQueries from '../queries/billing.queries';
import * as seatQueries from '../queries/organization-seat.queries';
import { HandlerError } from '../utils/error';
import { withKeyedLock } from '../utils/keyed-lock';
import { getOrganizationSeats } from './cloud-billing-access.service';

export function withOrganizationSeatLock<T>(organizationId: string, operation: () => Promise<T>): Promise<T> {
	return withKeyedLock(`cloud-seats:${organizationId}`, operation);
}

/** Persists read-only flips so each member who loses a seat is notified once. */
export async function syncOrganizationSeats(organizationId: string): Promise<void> {
	if (!isCloudBillingEnabled()) {
		return;
	}
	const [{ readOnlyUserIds }, states] = await Promise.all([
		getOrganizationSeats(organizationId),
		seatQueries.listOrganizationSeatStates(organizationId),
	]);
	const storedReadOnly = new Map(states.map(({ userId, isReadOnly }) => [userId, isReadOnly]));
	const userIds = new Set([...readOnlyUserIds, ...storedReadOnly.keys()]);
	await Promise.all(
		[...userIds]
			.filter((userId) => (storedReadOnly.get(userId) ?? false) !== readOnlyUserIds.has(userId))
			.map((userId) => seatQueries.setSeatReadOnly(organizationId, userId, readOnlyUserIds.has(userId))),
	);
}

/** Non-admin candidates keep a seat in the given order; everyone else is explicitly deselected. */
export async function applySeatSelection(organizationId: string, selectedUserIds: string[]): Promise<void> {
	const candidates = await seatQueries.listOrgSeatCandidates(organizationId);
	const selectedAt = Date.now();
	await Promise.all(
		candidates
			.filter(({ membershipClass }) => membershipClass !== 'org_admin')
			.map(({ id }) => {
				const order = selectedUserIds.indexOf(id);
				return seatQueries.setSeatSelection(organizationId, id, {
					selectedAt: order === -1 ? null : new Date(selectedAt + order),
					selectionExplicit: true,
				});
			}),
	);
	await syncOrganizationSeats(organizationId);
}

export async function validateSeatSelection(
	organizationId: string,
	selectedUserIds: string[],
	seatLimit: number,
): Promise<void> {
	const candidates = await seatQueries.listOrgSeatCandidates(organizationId);
	const selectableIds = new Set(
		candidates.filter(({ membershipClass }) => membershipClass !== 'org_admin').map(({ id }) => id),
	);
	const adminCount = candidates.length - selectableIds.size;
	if (
		new Set(selectedUserIds).size !== selectedUserIds.length ||
		selectedUserIds.some((userId) => !selectableIds.has(userId))
	) {
		throw new HandlerError('BAD_REQUEST', 'Seat selection contains an ineligible user');
	}
	if (selectedUserIds.length > Math.max(0, seatLimit - adminCount)) {
		throw new HandlerError('BAD_REQUEST', 'Too many users were selected for the available seats');
	}
}

export async function reserveSeat(organizationId: string, userId: string): Promise<void> {
	await seatQueries.setSeatSelection(organizationId, userId, { selectedAt: new Date(), selectionExplicit: true });
}

/** A member removed from everything forgets their selection, so rejoining starts from the default order. */
export async function clearSeatSelectionAndSync(organizationId: string, userId: string): Promise<void> {
	const candidates = await seatQueries.listOrgSeatCandidates(organizationId);
	if (!candidates.some(({ id }) => id === userId)) {
		await seatQueries.setSeatSelection(organizationId, userId, { selectedAt: null, selectionExplicit: false });
	}
	await syncOrganizationSeats(organizationId);
}

export async function applyPendingFreeSeatSelection(organizationId: string, selectedUserIds: string[]): Promise<void> {
	await applySeatSelection(organizationId, selectedUserIds);
	await billingQueries.setPendingFreeSeatSelection(organizationId, null);
}
