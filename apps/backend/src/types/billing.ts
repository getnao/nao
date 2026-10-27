export type {
	BillingStatus,
	CloudBillingCurrency,
	CloudBillingInterval,
	CloudBillingPlan,
	CloudBillingPlanDefinition,
	CloudBillingPlanKey,
	TrialBillingState,
} from '@nao/shared/billing';
export {
	BILLING_STATUSES,
	calculateCreditTopUp,
	CLOUD_BILLING_CURRENCIES,
	CLOUD_BILLING_PLANS,
	CLOUD_BILLING_TRIAL_DAYS,
	CREDIT_TOP_UP_CURRENCY,
	CREDIT_TOP_UP_MAX_CENTS,
	CREDIT_TOP_UP_MIN_CENTS,
	CREDIT_TOP_UP_PLATFORM_FEE_BASIS_POINTS,
	isCloudBillingPlanKey,
	isTerminalBillingStatus,
	isTrialAvailable,
} from '@nao/shared/billing';

export const CLOUD_TRIAL_PROVISIONING_JOB_NAME = 'billing.cloud.provision-trial';
