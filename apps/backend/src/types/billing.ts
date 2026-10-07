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

export const STRIPE_WEBHOOK_PROCESS_JOB_NAME = 'stripe.webhook.process';

export const CLOUD_MONTHLY_PLAN = {
	key: 'cloud_monthly_v2',
	name: 'nao Cloud',
	currency: 'usd',
	interval: 'month',
	intervalCount: 1,
	trialDays: 14,
	userLimit: null,
} as const;

export type CloudBillingPlan = Omit<typeof CLOUD_MONTHLY_PLAN, 'currency'> & {
	amount: number;
	currency: string;
};
