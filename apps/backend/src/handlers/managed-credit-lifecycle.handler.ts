import { releaseStaleManagedAiCreditReservations } from '../services/credit-wallet.service';
import type { JobHandler } from '../services/scheduler.service';

export const MANAGED_CREDIT_LIFECYCLE_JOB_NAME = 'managed-credit.lifecycle';

const RESERVATION_MAX_AGE_MS = 24 * 60 * 60 * 1_000;

export const managedCreditLifecycleHandler: JobHandler = async () => {
	await releaseStaleManagedAiCreditReservations(new Date(Date.now() - RESERVATION_MAX_AGE_MS));
};
