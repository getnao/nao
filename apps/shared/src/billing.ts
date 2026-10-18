export const BILLING_STATUSES = [
	'trialing',
	'active',
	'past_due',
	'unpaid',
	'canceled',
	'paused',
	'incomplete',
	'incomplete_expired',
] as const;

export type BillingStatus = (typeof BILLING_STATUSES)[number];

export function isTerminalBillingStatus(status: string | null | undefined): boolean {
	return status === 'canceled' || status === 'incomplete_expired';
}

export const CLOUD_BILLING_CURRENCIES = ['usd', 'eur'] as const;
export type CloudBillingCurrency = (typeof CLOUD_BILLING_CURRENCIES)[number];

export const CLOUD_BILLING_PLANS = {
	monthly: {
		key: 'cloud_monthly_v2',
		name: 'nao Cloud',
		interval: 'month',
		intervalCount: 1,
		trialDays: 14,
		userLimit: null,
	},
	yearly: {
		key: 'cloud_yearly_v1',
		name: 'nao Cloud',
		interval: 'year',
		intervalCount: 1,
		trialDays: 14,
		userLimit: null,
	},
} as const;

export type CloudBillingInterval = keyof typeof CLOUD_BILLING_PLANS;
export type CloudBillingPlanDefinition = (typeof CLOUD_BILLING_PLANS)[CloudBillingInterval];
export type CloudBillingPlanKey = CloudBillingPlanDefinition['key'];

export interface CloudBillingPlan {
	key: CloudBillingPlanKey;
	name: string;
	amount: number;
	currency: string;
	interval: CloudBillingPlanDefinition['interval'];
	intervalCount: number;
	trialDays: number;
	userLimit: null;
}

export type TrialBillingState = {
	billingStatus: BillingStatus | null;
	trialStartedAt: Date | null;
	trialEndsAt: Date | null;
	stripeSubscriptionId: string | null;
};

export function isTrialAvailable(billing: TrialBillingState | null | undefined): boolean {
	return (
		!billing ||
		(billing.billingStatus === null &&
			billing.trialStartedAt === null &&
			billing.trialEndsAt === null &&
			billing.stripeSubscriptionId === null)
	);
}

export function isCloudBillingPlanKey(value: string | null | undefined): value is CloudBillingPlanKey {
	return Object.values(CLOUD_BILLING_PLANS).some((plan) => plan.key === value);
}
