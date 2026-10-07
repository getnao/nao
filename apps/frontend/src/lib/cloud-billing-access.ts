export type CloudBillingAccess = {
	organizationId: string;
	hasAccess: boolean;
	bypassBilling: boolean;
	status: string | null;
	trialEndsAt: Date | null;
	trialAvailable: boolean;
	canManageBilling: boolean;
	requiresBillingAction: boolean;
};

export type ParsedCloudBillingError = {
	error?: string;
	message?: string;
};

export function isCloudBillingAccessError(error: ParsedCloudBillingError | null): boolean {
	return [error?.error, error?.message].some((value) => value?.includes('Cloud billing access is restricted'));
}

export function getCloudBillingAccessRefetchInterval(
	access: Pick<CloudBillingAccess, 'status' | 'hasAccess'> | undefined,
): number | false {
	return access?.status === 'active' && access.hasAccess ? false : 60_000;
}
