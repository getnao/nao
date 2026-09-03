import { deleteExpiredInvitations } from '../queries/user.queries';
import type { JobHandler } from '../services/scheduler.service';

export const INVITATION_CLEANUP_JOB_NAME = 'invitation.cleanup';

export async function runInvitationCleanup(): Promise<void> {
	await deleteExpiredInvitations();
}

export const invitationCleanupHandler: JobHandler = async () => {
	await runInvitationCleanup();
};
