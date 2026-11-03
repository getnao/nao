import {
	claimOrganizationSeatEmailNotification,
	claimPausedWorkInAppNotification,
	listScheduledWorkResourcesForOwner,
	releaseOrganizationSeatEmailNotification,
	syncOrganizationSeatState,
} from '../queries/organization-seat-state.queries';
import { sendScheduledWorkPausedEmail } from './email';

export type ScheduledWorkPausedResource = {
	type: string;
	id: string | null;
};

export type ScheduledWorkPausedEmailDelivery = (input: {
	organizationId: string;
	userId: string;
	resources: ScheduledWorkPausedResource[];
}) => Promise<void>;

export async function notifyScheduledWorkPaused(
	input: {
		organizationId: string;
		userId: string;
		projectId: string;
		resources: ScheduledWorkPausedResource[];
	},
	deliverEmail: ScheduledWorkPausedEmailDelivery = sendScheduledWorkPausedEmail,
): Promise<void> {
	const claimedAt = new Date();
	const scheduledResources = await listScheduledWorkResourcesForOwner(input.organizationId, input.userId);
	const resources = deduplicateResources([
		...scheduledResources.map(({ type, id }) => ({ type, id })),
		...input.resources,
	]);
	const projectId = scheduledResources[0]?.projectId ?? input.projectId;
	await syncOrganizationSeatState({
		orgId: input.organizationId,
		userId: input.userId,
		isReadOnly: true,
		changedAt: claimedAt,
	});
	await claimPausedWorkInAppNotification(
		input.organizationId,
		input.userId,
		{
			projectId,
			title: 'Scheduled work paused',
			body: 'Your scheduled work is paused until an organization admin adds a seat.',
			payload: {
				kind: 'scheduled_work_paused',
				organizationId: input.organizationId,
				resources,
			},
		},
		claimedAt,
	);
	if (!(await claimOrganizationSeatEmailNotification(input.organizationId, input.userId, 'owner_email', claimedAt))) {
		return;
	}
	try {
		await deliverEmail({
			organizationId: input.organizationId,
			userId: input.userId,
			resources,
		});
	} catch (error) {
		await releaseOrganizationSeatEmailNotification(input.organizationId, input.userId, 'owner_email', claimedAt);
		throw error;
	}
}

function deduplicateResources(resources: ScheduledWorkPausedResource[]): ScheduledWorkPausedResource[] {
	const seen = new Set<string>();
	return resources.filter((resource) => {
		const key = `${resource.type}:${resource.id ?? ''}`;
		if (seen.has(key)) {
			return false;
		}
		seen.add(key);
		return true;
	});
}
