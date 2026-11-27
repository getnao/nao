import type { StripeConfig } from '../../src/env';

export const TEST_STRIPE_CONFIG = {
	secretKey: 'sk_test_example',
	webhookSecret: 'whsec_example',
	products: {
		legacyUnlimited: 'prod_cloud',
		trial: 'prod_cloud_trial',
		team: 'prod_team',
		unlimited: 'prod_unlimited',
		credit: 'prod_credits',
		platformFee: 'prod_platform_fee',
	},
	prices: {
		trial: 'nao_trial',
		cloud_team_monthly_v1: 'team_monthly',
		cloud_team_yearly_v1: 'team_yearly',
		cloud_unlimited_monthly_v1: 'unlimited_monthly',
		cloud_unlimited_yearly_v1: 'unlimited_yearly',
	},
} satisfies StripeConfig;

export const TEST_STRIPE_ENV = {
	STRIPE_CONFIG: JSON.stringify(TEST_STRIPE_CONFIG),
};
