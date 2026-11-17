import {
	assertProjectCloudBillingAccess,
	assertProjectUserCloudBillingAccess,
	CloudBillingSeatRestrictedError,
} from './cloud-billing-access.service';

/** The organization check is skipped when the caller already verified it for this project; the seat check always runs. */
export async function assertProjectActorCloudBillingAccess(
	projectId: string,
	userId: string,
	options: { verifiedProjectId?: string } = {},
): Promise<void> {
	if (options.verifiedProjectId !== projectId) {
		await assertProjectCloudBillingAccess(projectId);
	}
	await assertProjectUserCloudBillingAccess(projectId, userId);
}

export const MESSAGING_SEATS_FULL_REPLY = "❌ Your organization's seats are full. Ask an administrator to add a seat.";

export async function assertMessagingUserCloudBillingAccess(
	projectId: string,
	userId: string,
	reply: (message: string) => Promise<unknown>,
): Promise<boolean> {
	try {
		await assertProjectUserCloudBillingAccess(projectId, userId);
		return true;
	} catch (error) {
		if (!(error instanceof CloudBillingSeatRestrictedError)) {
			throw error;
		}
		await reply(MESSAGING_SEATS_FULL_REPLY);
		return false;
	}
}
