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

/** Adjustable amounts stored in the `cloud_billing_policy` table so they change without a redeploy. */
export type CloudBillingPolicy = {
	trialDays: number;
	freeSeatLimit: number;
	teamMinSeats: number;
	teamMaxSeats: number;
	creditTopUpMinCents: number;
	creditTopUpMaxCents: number;
	platformFeeBasisPoints: number;
};

export type CreditTopUpPolicy = Pick<
	CloudBillingPolicy,
	'creditTopUpMinCents' | 'creditTopUpMaxCents' | 'platformFeeBasisPoints'
>;

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

export function calculateCreditTopUp(
	creditAmountCents: number,
	policy: CreditTopUpPolicy,
): {
	creditAmountCents: number;
	platformFeeCents: number;
	totalAmountCents: number;
	walletAmountMicroUsd: number;
} {
	if (
		!Number.isSafeInteger(creditAmountCents) ||
		creditAmountCents < policy.creditTopUpMinCents ||
		creditAmountCents > policy.creditTopUpMaxCents
	) {
		throw new RangeError(
			`Credit top-up amount must be between ${policy.creditTopUpMinCents} and ${policy.creditTopUpMaxCents} cents`,
		);
	}
	const platformFeeCents = Math.ceil((creditAmountCents * policy.platformFeeBasisPoints) / 10_000);
	return {
		creditAmountCents,
		platformFeeCents,
		totalAmountCents: creditAmountCents + platformFeeCents,
		walletAmountMicroUsd: creditAmountCents * 10_000,
	};
}

/** Unit amounts are in cents and identical in USD and EUR; Stripe Prices are validated against them. */
export const CLOUD_BILLING_PLANS = {
	cloud_team_monthly_v1: { key: 'cloud_team_monthly_v1', tier: 'team', interval: 'monthly', unitAmount: 5_000 },
	cloud_team_yearly_v1: { key: 'cloud_team_yearly_v1', tier: 'team', interval: 'yearly', unitAmount: 50_000 },
	cloud_unlimited_monthly_v1: {
		key: 'cloud_unlimited_monthly_v1',
		tier: 'unlimited',
		interval: 'monthly',
		unitAmount: 200_000,
	},
	cloud_unlimited_yearly_v1: {
		key: 'cloud_unlimited_yearly_v1',
		tier: 'unlimited',
		interval: 'yearly',
		unitAmount: 2_000_000,
	},
} as const;

/** Plans of subscribers from before seat-based pricing. They keep unlimited seats and cannot be changed in-app. */
export const LEGACY_CLOUD_BILLING_PLANS = {
	cloud_monthly_v2: { key: 'cloud_monthly_v2', tier: 'unlimited', interval: 'monthly' },
	cloud_yearly_v1: { key: 'cloud_yearly_v1', tier: 'unlimited', interval: 'yearly' },
} as const;

export type CloudBillingInterval = 'monthly' | 'yearly';
export type PaidCloudBillingTier = 'team' | 'unlimited';
export type CloudBillingTier = 'bypass' | 'trial' | 'free' | PaidCloudBillingTier;
export type CloudBillingPlanKey = keyof typeof CLOUD_BILLING_PLANS;
export type LegacyCloudBillingPlanKey = keyof typeof LEGACY_CLOUD_BILLING_PLANS;
export type CloudBillingPlanDefinition = (typeof CLOUD_BILLING_PLANS)[CloudBillingPlanKey];

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
	return typeof value === 'string' && Object.hasOwn(CLOUD_BILLING_PLANS, value);
}

export function isLegacyCloudBillingPlanKey(value: string | null | undefined): value is LegacyCloudBillingPlanKey {
	return typeof value === 'string' && Object.hasOwn(LEGACY_CLOUD_BILLING_PLANS, value);
}

export function getCloudBillingPlan(tier: PaidCloudBillingTier, interval: CloudBillingInterval) {
	const plan = Object.values(CLOUD_BILLING_PLANS).find((definition) => {
		return definition.tier === tier && definition.interval === interval;
	});
	if (!plan) {
		throw new Error(`No cloud billing plan exists for ${tier}/${interval}`);
	}
	return plan;
}

export function findCloudBillingPlan(planKey: string | null | undefined) {
	if (isCloudBillingPlanKey(planKey)) {
		return { ...CLOUD_BILLING_PLANS[planKey], legacy: false };
	}
	return isLegacyCloudBillingPlanKey(planKey) ? { ...LEGACY_CLOUD_BILLING_PLANS[planKey], legacy: true } : null;
}
