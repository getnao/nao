import type { CloudBillingPolicy } from '../../src/types/billing';

/** Mirrors the row seeded by the `cloud_billing_policy` migration. */
export const defaultCloudBillingPolicy: CloudBillingPolicy = {
	trialDays: 14,
	freeSeatLimit: 3,
	teamMinSeats: 4,
	teamMaxSeats: 40,
	creditTopUpMinCents: 2_000,
	creditTopUpMaxCents: 50_000,
	platformFeeBasisPoints: 500,
};
