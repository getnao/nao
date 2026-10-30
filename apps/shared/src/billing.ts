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

export const CREDIT_TOP_UP_CURRENCY = 'usd';
export const CREDIT_TOP_UP_MIN_CENTS = 2_000;
export const CREDIT_TOP_UP_MAX_CENTS = 50_000;
export const CREDIT_TOP_UP_PLATFORM_FEE_BASIS_POINTS = 500;

export function formatMicroUsd(
	microUsd: number,
	{ locale, ...options }: Intl.NumberFormatOptions & { locale?: string | string[] } = {},
): string {
	return new Intl.NumberFormat(locale, {
		minimumFractionDigits: 2,
		maximumFractionDigits: 2,
		...options,
		style: 'currency',
		currency: 'USD',
	}).format(microUsd / 1_000_000);
}

export function calculateCreditTopUp(creditAmountCents: number): {
	creditAmountCents: number;
	platformFeeCents: number;
	totalAmountCents: number;
	walletAmountMicroUsd: number;
} {
	if (
		!Number.isSafeInteger(creditAmountCents) ||
		creditAmountCents < CREDIT_TOP_UP_MIN_CENTS ||
		creditAmountCents > CREDIT_TOP_UP_MAX_CENTS
	) {
		throw new RangeError(
			`Credit top-up amount must be between ${CREDIT_TOP_UP_MIN_CENTS} and ${CREDIT_TOP_UP_MAX_CENTS} cents`,
		);
	}
	const platformFeeCents = Math.ceil((creditAmountCents * CREDIT_TOP_UP_PLATFORM_FEE_BASIS_POINTS) / 10_000);
	return {
		creditAmountCents,
		platformFeeCents,
		totalAmountCents: creditAmountCents + platformFeeCents,
		walletAmountMicroUsd: creditAmountCents * 10_000,
	};
}

export const CLOUD_BILLING_TRIAL_DAYS = 14;
export const FREE_TIER_SEAT_LIMIT = 3;
export const TEAM_MIN_SEATS = 4;

export const CLOUD_BILLING_PLANS = {
	cloud_team_monthly_v1: {
		key: 'cloud_team_monthly_v1',
		name: 'nao Cloud Team',
		tier: 'team',
		interval: 'month',
		intervalCount: 1,
		trialDays: CLOUD_BILLING_TRIAL_DAYS,
		userLimit: null,
		perSeat: true,
	},
	cloud_team_yearly_v1: {
		key: 'cloud_team_yearly_v1',
		name: 'nao Cloud Team',
		tier: 'team',
		interval: 'year',
		intervalCount: 1,
		trialDays: CLOUD_BILLING_TRIAL_DAYS,
		userLimit: null,
		perSeat: true,
	},
	cloud_unlimited_monthly_v1: {
		key: 'cloud_unlimited_monthly_v1',
		name: 'nao Cloud Unlimited',
		tier: 'unlimited',
		interval: 'month',
		intervalCount: 1,
		trialDays: CLOUD_BILLING_TRIAL_DAYS,
		userLimit: null,
		perSeat: false,
	},
	cloud_unlimited_yearly_v1: {
		key: 'cloud_unlimited_yearly_v1',
		name: 'nao Cloud Unlimited',
		tier: 'unlimited',
		interval: 'year',
		intervalCount: 1,
		trialDays: CLOUD_BILLING_TRIAL_DAYS,
		userLimit: null,
		perSeat: false,
	},
} as const;

export const LEGACY_CLOUD_BILLING_PLANS = {
	cloud_monthly_v2: {
		key: 'cloud_monthly_v2',
		name: 'nao Cloud Legacy Unlimited',
		tier: 'unlimited',
		interval: 'month',
		intervalCount: 1,
		trialDays: CLOUD_BILLING_TRIAL_DAYS,
		userLimit: null,
		perSeat: false,
		legacy: true,
	},
	cloud_yearly_v1: {
		key: 'cloud_yearly_v1',
		name: 'nao Cloud Legacy Unlimited',
		tier: 'unlimited',
		interval: 'year',
		intervalCount: 1,
		trialDays: CLOUD_BILLING_TRIAL_DAYS,
		userLimit: null,
		perSeat: false,
		legacy: true,
	},
} as const;

export const CLOUD_BILLING_TIERS = ['team', 'unlimited'] as const;
export const CLOUD_BILLING_TIER_ORDER = ['free', 'team', 'unlimited'] as const;

export type CloudBillingInterval = 'monthly' | 'yearly';
export type CloudBillingTier = 'trial' | (typeof CLOUD_BILLING_TIER_ORDER)[number];
export type PaidCloudBillingTier = (typeof CLOUD_BILLING_TIERS)[number];
export type CloudBillingPlanKey = keyof typeof CLOUD_BILLING_PLANS;
export type LegacyCloudBillingPlanKey = keyof typeof LEGACY_CLOUD_BILLING_PLANS;
export type CurrentCloudBillingPlanDefinition = (typeof CLOUD_BILLING_PLANS)[CloudBillingPlanKey];
export type LegacyCloudBillingPlanDefinition = (typeof LEGACY_CLOUD_BILLING_PLANS)[LegacyCloudBillingPlanKey];
export type CloudBillingPlanDefinition = CurrentCloudBillingPlanDefinition | LegacyCloudBillingPlanDefinition;

export interface CloudBillingPlan {
	key: CloudBillingPlanKey | LegacyCloudBillingPlanKey;
	name: string;
	amount: number;
	currency: string;
	interval: CloudBillingPlanDefinition['interval'];
	intervalCount: number;
	trialDays: number;
	userLimit: null;
	tier: PaidCloudBillingTier;
	perSeat: boolean;
	legacy?: true;
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
	return value !== null && value !== undefined && Object.hasOwn(CLOUD_BILLING_PLANS, value);
}

export function isLegacyCloudBillingPlanKey(value: string | null | undefined): value is LegacyCloudBillingPlanKey {
	return value !== null && value !== undefined && Object.hasOwn(LEGACY_CLOUD_BILLING_PLANS, value);
}

export function getCloudBillingPlanDefinition(
	tier: PaidCloudBillingTier,
	interval: CloudBillingInterval,
): CurrentCloudBillingPlanDefinition {
	const stripeInterval = interval === 'monthly' ? 'month' : 'year';
	const plan = Object.values(CLOUD_BILLING_PLANS).find(
		(definition) => definition.tier === tier && definition.interval === stripeInterval,
	);
	if (!plan) {
		throw new Error(`No cloud billing plan exists for ${tier}/${interval}`);
	}
	return plan;
}
