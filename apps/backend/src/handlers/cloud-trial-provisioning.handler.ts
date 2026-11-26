import { provisionCloudTrial } from '../services/cloud-trial-provisioning.service';
import type { JobHandler } from '../services/scheduler.service';
import { CLOUD_TRIAL_PROVISIONING_JOB_NAME } from '../types/billing';

export { CLOUD_TRIAL_PROVISIONING_JOB_NAME };

export const cloudTrialProvisioningHandler: JobHandler<{
	organizationId?: unknown;
	actingUserId?: unknown;
}> = async (payload) => {
	if (typeof payload.organizationId !== 'string') {
		throw new Error('Cloud trial provisioning job is missing organizationId');
	}
	if (payload.actingUserId !== undefined && typeof payload.actingUserId !== 'string') {
		throw new Error('Cloud trial provisioning job has an invalid actingUserId');
	}
	await provisionCloudTrial(payload.organizationId, payload.actingUserId);
};
