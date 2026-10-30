export type CloudBillingAccess = {
	organizationId: string;
	hasAccess: boolean;
	bypassBilling: boolean;
	freeTierEnabled: boolean;
	tier: 'bypass' | 'trial' | 'free' | 'team' | 'unlimited';
	status: string | null;
	billingPlan: string | null;
	trialEndsAt: Date | null;
	accessEndsAt: Date | null;
	seatUserCount: number;
	seatQuantity: number | null;
	seatLimit: number | null;
	availableSeats: number | null;
	overCapacity: boolean;
	isReadOnly: boolean;
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

export function getCloudBillingAccessRefetchInterval(
	access:
		| Partial<
				Pick<
					CloudBillingAccess,
					| 'status'
					| 'hasAccess'
					| 'accessEndsAt'
					| 'bypassBilling'
					| 'canManageBilling'
					| 'freeTierEnabled'
					| 'isReadOnly'
					| 'overCapacity'
				>
		  >
		| undefined,
	now = Date.now(),
): number | false {
	if (access?.bypassBilling && !access.canManageBilling) {
		return false;
	}
	if (access?.freeTierEnabled && (access.isReadOnly || access.overCapacity)) {
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
