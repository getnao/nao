import type { ShareRole, Visibility } from '@nao/shared/types';
import { TRPCError } from '@trpc/server';

import type { AutomationOwner, AutomationWithAccess } from '../queries/automation.queries';
import * as automationShareQueries from '../queries/automation-share.queries';
import * as userQueries from '../queries/user.queries';
import { assertCanShareToProject, assertCanShareWith } from './project-sharing.service';
import { assertShareableUserGroupIds } from './shareable-user-groups.service';
import type { ShareActor } from './story-share-settings.service';

export type AutomationShareSettings = {
	automationId: string;
	canManage: boolean;
	isShared: boolean;
	visibility: Visibility;
	projectRole: ShareRole;
	owner: AutomationOwner | null;
	users: automationShareQueries.AutomationUserGrant[];
	groups: automationShareQueries.AutomationGroupGrant[];
};

type ShareGrantChange = { id: string; role: ShareRole };

export type AutomationShareChange = {
	visibility: Visibility;
	projectRole: ShareRole;
	users: ShareGrantChange[];
	groups: ShareGrantChange[];
};

export async function getAutomationShareSettings(
	automation: AutomationWithAccess,
	actor: ShareActor,
): Promise<AutomationShareSettings> {
	const [owner, shares, users, groups] = await Promise.all([
		userQueries.getUser({ id: automation.userId }),
		automationShareQueries.listAutomationShares(automation.id),
		automationShareQueries.listAutomationUserGrants(automation.id),
		automationShareQueries.listAutomationGroupGrants(automation.id),
	]);
	const projectShare = shares.find(isProjectShare);
	return {
		automationId: automation.id,
		canManage: canManageAutomationShare(automation, actor),
		isShared: shares.length > 0,
		visibility: projectShare ? 'project' : 'specific',
		projectRole: projectShare?.role ?? 'viewer',
		owner: owner ? { id: owner.id, name: owner.name, email: owner.email } : null,
		users,
		groups,
	};
}

/** Replaces who can access the automation; sharing with nobody makes it private to its owner again. */
export async function saveAutomationShareSettings(
	automation: AutomationWithAccess,
	actor: ShareActor,
	change: AutomationShareChange,
): Promise<void> {
	if (!canManageAutomationShare(automation, actor)) {
		throw new TRPCError({ code: 'FORBIDDEN', message: 'Only the owner or an admin can change who has access.' });
	}
	const users = change.users.filter((user) => user.id !== automation.userId);
	const groups = change.visibility === 'project' ? [] : change.groups;
	if (change.visibility === 'project') {
		await assertCanShareToProject(actor.projectId, actor.id);
	}
	await assertCanAddRecipients(automation.id, actor, { users, groups });

	const userShares = users.map((user) => ({ userId: user.id, groupId: null, role: user.role }));
	const groupShares = groups.map((group) => ({ userId: null, groupId: group.id, role: group.role }));
	const projectShares =
		change.visibility === 'project' ? [{ userId: null, groupId: null, role: change.projectRole }] : [];
	await automationShareQueries.replaceAutomationShares(automation.id, [
		...projectShares,
		...groupShares,
		...userShares,
	]);
}

function canManageAutomationShare(automation: AutomationWithAccess, actor: ShareActor): boolean {
	return automation.accessRole === 'owner' || actor.role === 'admin';
}

/** Only the people and groups a save adds are checked: those already on the share keep their access. */
async function assertCanAddRecipients(
	automationId: string,
	actor: ShareActor,
	recipients: { users: ShareGrantChange[]; groups: ShareGrantChange[] },
): Promise<void> {
	const current = await automationShareQueries.listAutomationShares(automationId);
	const currentUserIds = new Set(current.map((share) => share.userId));
	const currentGroupIds = new Set(current.map((share) => share.groupId));
	const newRecipients = {
		userIds: recipients.users.map((user) => user.id).filter((id) => !currentUserIds.has(id)),
		groupIds: recipients.groups.map((group) => group.id).filter((id) => !currentGroupIds.has(id)),
	};
	await assertShareableUserGroupIds(actor.projectId, newRecipients.groupIds);
	await assertCanShareWith(actor.projectId, actor.id, newRecipients);
}

function isProjectShare(share: automationShareQueries.AutomationShareEntry): boolean {
	return share.userId === null && share.groupId === null;
}
