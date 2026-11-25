import type { CloudBillingTier } from '@nao/shared/billing';

export type CloudBillingAccess = {
	organizationId: string;
	hasAccess: boolean;
	bypassBilling: boolean;
	tier: CloudBillingTier;
	seatLimit: number | null;
	seatUserCount: number;
	isReadOnly: boolean;
	status: string | null;
	trialEndsAt: Date | null;
	accessEndsAt: Date | null;
	trialAvailable: boolean;
	canManageBilling: boolean;
	requiresBillingAction: boolean;
};

const BILLING_POLL_INTERVAL_MS = 60_000;
const MAX_REFETCH_INTERVAL_MS = 2_147_483_647;

export type ParsedCloudBillingError = {
	error?: string;
	message?: string;
};

export function isCloudBillingAccessError(error: ParsedCloudBillingError | null): boolean {
	return [error?.error, error?.message].some((value) => value?.includes('Cloud billing access is restricted'));
}

export function isCloudBillingSeatError(error: ParsedCloudBillingError | null): boolean {
	return [error?.error, error?.message].some((value) => value?.includes('Cloud billing seat access is restricted'));
}

export function hasMoreSeatUsersThanSeats(access: Pick<CloudBillingAccess, 'seatLimit' | 'seatUserCount'>): boolean {
	return access.seatLimit !== null && access.seatUserCount > access.seatLimit;
}

export function getCloudBillingAccessRefetchInterval(
	access:
		| Pick<
				CloudBillingAccess,
				| 'status'
				| 'hasAccess'
				| 'accessEndsAt'
				| 'bypassBilling'
				| 'canManageBilling'
				| 'isReadOnly'
				| 'seatLimit'
				| 'seatUserCount'
		  >
		| undefined,
	now = Date.now(),
): number | false {
	if (access?.bypassBilling && !access.canManageBilling) {
		return false;
	}
	if (access && (access.isReadOnly || hasMoreSeatUsersThanSeats(access))) {
		return BILLING_POLL_INTERVAL_MS;
	}
	if (access?.status !== 'active' || !access.hasAccess) {
		return BILLING_POLL_INTERVAL_MS;
	}
	if (!access.accessEndsAt) {
		return false;
	}
	return Math.max(1, Math.min(access.accessEndsAt.getTime() - now, MAX_REFETCH_INTERVAL_MS));
}
