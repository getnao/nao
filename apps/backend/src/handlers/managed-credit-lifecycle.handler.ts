import * as scheduledJobQueries from '../queries/scheduled-job.queries';
import { reconcileCreditGrants, type ReconciliationCandidateCursor } from '../services/credit-grant.service';
import { releaseStaleManagedAiCreditReservations } from '../services/credit-wallet.service';
import type { JobHandler } from '../services/scheduler.service';

export const MANAGED_CREDIT_LIFECYCLE_JOB_NAME = 'managed-credit.lifecycle';

const RESERVATION_MAX_AGE_MS = 24 * 60 * 60 * 1_000;
const CREDIT_GRANT_RECONCILIATION_BATCH_SIZE = 50;

interface ManagedCreditLifecyclePayload {
	organizationSetupCandidate?: unknown;
	userJoinCandidate?: unknown;
}

export const managedCreditLifecycleHandler: JobHandler<ManagedCreditLifecyclePayload> = async (payload, job) => {
	await releaseStaleManagedAiCreditReservations(new Date(Date.now() - RESERVATION_MAX_AGE_MS));
	const cursor = await reconcileCreditGrants(
		{
			organizationSetupCandidate: parseCandidateCursor(payload.organizationSetupCandidate),
			userJoinCandidate: parseCandidateCursor(payload.userJoinCandidate),
		},
		CREDIT_GRANT_RECONCILIATION_BATCH_SIZE,
	);
	await scheduledJobQueries.updateJobPayload(job.id, { ...cursor });
};

function parseCandidateCursor(value: unknown): ReconciliationCandidateCursor | undefined {
	if (!value || typeof value !== 'object') {
		return undefined;
	}
	const { createdAt, id } = value as Record<string, unknown>;
	if (
		typeof createdAt !== 'string' ||
		(!/^\d+$/.test(createdAt) && Number.isNaN(Date.parse(createdAt))) ||
		typeof id !== 'string'
	) {
		return undefined;
	}
	return { createdAt, id };
}
