import { assertProjectUserCloudBillingAccess, CloudBillingSeatRestrictedError } from './cloud-billing-access.service';

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
