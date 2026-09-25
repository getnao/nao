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

export const STRIPE_WEBHOOK_JOB_NAME = 'stripe.webhook';

export const CLOUD_MONTHLY_PLAN = {
	key: 'cloud_monthly_v2',
	name: 'nao Cloud',
	currency: 'eur',
	interval: 'month',
	intervalCount: 1,
	trialDays: 14,
	userLimit: null,
} as const;

export type CloudBillingPlan = typeof CLOUD_MONTHLY_PLAN & {
	amount: number;
};
