import { runCloudBillingLifecycle } from '../services/billing-lifecycle.service';
import type { JobHandler } from '../services/scheduler.service';

export const BILLING_LIFECYCLE_JOB_NAME = 'billing.lifecycle';

export const billingLifecycleHandler: JobHandler = async () => {
	await runCloudBillingLifecycle();
};
