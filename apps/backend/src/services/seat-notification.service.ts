import * as organizationQueries from '../queries/organization.queries';
import * as seatQueries from '../queries/organization-seat.queries';
import { getProjectById } from '../queries/project.queries';
import { logger, serializeError } from '../utils/logger';
import { notifyUsers } from './notification.service';

/** Tells the owner once per seat loss that their automations and story schedules are skipped. */
export async function notifyScheduledWorkPaused(projectId: string, userId: string): Promise<void> {
	try {
		const organizationId = (await getProjectById(projectId))?.orgId;
		if (!organizationId) {
			return;
		}
		await seatQueries.setSeatReadOnly(organizationId, userId, true);
		if (!(await seatQueries.claimSeatNotification(organizationId, userId, 'owner'))) {
			return;
		}
		const { automations, stories } = await seatQueries.listScheduledWorkOwnedBy(organizationId, userId);
		await notifyUsers([userId], {
			category: 'seats',
			title: 'Your scheduled work is paused',
			body: 'You no longer have a seat in your organization, so your automations and scheduled stories are skipped until an organization admin gives you a seat.',
			projectId,
			channels: ['in_app', 'email'],
			table: {
				headers: ['Type', 'Name'],
				rows: [
					...automations.map(({ title }) => ['Automation', title]),
					...stories.map(({ title }) => ['Story', title]),
				],
			},
		});
	} catch (error) {
		logger.error(`Paused scheduled work notification failed for user ${userId}`, {
			source: 'system',
			context: serializeError(error),
		});
	}
}

/** Emails admins once about members who became read-only, for example after seats were removed. */
export async function notifyAdminsOfReadOnlyMembers(organizationId: string): Promise<void> {
	try {
		const states = await seatQueries.listOrganizationSeatStates(organizationId);
		const claimed = await Promise.all(
			states
				.filter(({ isReadOnly, adminNotifiedAt }) => isReadOnly && adminNotifiedAt === null)
				.map(async ({ userId }) =>
					(await seatQueries.claimSeatNotification(organizationId, userId, 'admin')) ? userId : null,
				),
		);
		const readOnlyUserIds = new Set(claimed.filter((userId) => userId !== null));
		if (readOnlyUserIds.size === 0) {
			return;
		}
		const members = await organizationQueries.listOrgMembersWithUsers(organizationId);
		const readOnlyMembers = (await seatQueries.listOrgSeatCandidates(organizationId)).filter(({ id }) =>
			readOnlyUserIds.has(id),
		);
		await notifyUsers(
			members.filter(({ role }) => role === 'admin').map(({ id }) => id),
			{
				category: 'seats',
				title: `${readOnlyMembers.length} ${readOnlyMembers.length === 1 ? 'member is' : 'members are'} now read-only`,
				body: 'Your organization has more people than seats. Read-only members can view content but cannot chat, run queries or schedule work until you add seats or choose who keeps one.',
				linkUrl: '/settings/organization/billing',
				ctaLabel: 'Manage seats',
				projectId: '',
				channels: ['email'],
				table: { headers: ['Name', 'Email'], rows: readOnlyMembers.map(({ name, email }) => [name, email]) },
			},
		);
	} catch (error) {
		logger.error(`Read-only member notification failed for organization ${organizationId}`, {
			source: 'system',
			context: serializeError(error),
		});
	}
}
