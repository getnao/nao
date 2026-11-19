import type { ShareRole, Visibility } from '@nao/shared/types';

import type { ShareCandidate, ShareGrant } from '@/lib/share-access';
import type { FolderItem } from '@/lib/stories-page';

/** What the dialog will save: nothing is applied until the user confirms. */
export interface ShareDraft {
	visibility: Visibility;
	projectRole: ShareRole;
	grants: ShareGrant[];
}

export interface ShareSavedState {
	isShared: boolean;
	visibility: Visibility;
	projectRole: ShareRole;
	grants: ShareGrant[];
}

export function createShareDraft(saved: ShareSavedState, canShareToProject: boolean): ShareDraft {
	if (!saved.isShared) {
		return { visibility: canShareToProject ? 'project' : 'specific', projectRole: 'viewer', grants: [] };
	}
	return { visibility: saved.visibility, projectRole: saved.projectRole, grants: saved.grants };
}

/** A draft naming nobody shares with no one: saving it stops sharing. */
export function isShareDraftEmpty(draft: ShareDraft): boolean {
	return draft.visibility === 'specific' && draft.grants.length === 0;
}

export const STOP_SHARING_DRAFT: ShareDraft = { visibility: 'specific', projectRole: 'viewer', grants: [] };

export function isShareDraftChanged(draft: ShareDraft, saved: ShareSavedState): boolean {
	if (!saved.isShared) {
		return true;
	}
	return (
		draft.visibility !== saved.visibility ||
		draft.projectRole !== saved.projectRole ||
		describeGrants(toSavedGrants(draft)) !== describeGrants(saved.grants)
	);
}

export function findGrant(draft: ShareDraft, key: string): ShareGrant | undefined {
	return draft.grants.find((grant) => grant.key === key);
}

export function toggleGrant(draft: ShareDraft, candidate: ShareCandidate, role: ShareRole = 'viewer'): ShareDraft {
	if (findGrant(draft, candidate.key)) {
		return { ...draft, grants: draft.grants.filter((grant) => grant.key !== candidate.key) };
	}
	return { ...draft, grants: [...draft.grants, { ...candidate, role }] };
}

export function setGrantRole(draft: ShareDraft, candidate: ShareCandidate, role: ShareRole): ShareDraft {
	const others = draft.grants.filter((grant) => grant.key !== candidate.key);
	return { ...draft, grants: [...others, { ...candidate, role }] };
}

/** In project mode a person only needs their own grant when their role differs from everyone else's. */
export function setProjectMemberRole(draft: ShareDraft, candidate: ShareCandidate, role: ShareRole): ShareDraft {
	const others = draft.grants.filter((grant) => grant.key !== candidate.key);
	if (role === draft.projectRole) {
		return { ...draft, grants: others };
	}
	return { ...draft, grants: [...others, { ...candidate, role }] };
}

export function setRoleForWholeProject(draft: ShareDraft, role: ShareRole): ShareDraft {
	return { ...draft, projectRole: role, grants: [] };
}

export function projectMemberRole(draft: ShareDraft, key: string): ShareRole {
	return findGrant(draft, key)?.role ?? draft.projectRole;
}

export function isProjectOverride(draft: ShareDraft, key: string): boolean {
	return projectMemberRole(draft, key) !== draft.projectRole;
}

type FolderAudienceFields = Pick<FolderItem, 'visibility' | 'teamGroupIds'>;

/**
 * Opens the draft to the audience of the folder the story is filed in: the whole project for the root
 * and open folders, otherwise specific people, plus the groups of a team folder.
 * The groups the previous folder brought in are dropped, except in a private folder, which keeps everyone.
 */
export function fitDraftToFolder(
	draft: ShareDraft,
	folder: FolderAudienceFields | null,
	candidates: ShareCandidate[],
	previousFolder: FolderAudienceFields | null = null,
): ShareDraft {
	const grants =
		folder?.visibility === 'private' ? draft.grants : withoutTeamGroupsOf(draft.grants, previousFolder, folder);
	if (folder === null || (folder.visibility !== 'private' && folder.teamGroupIds.length === 0)) {
		return { ...draft, visibility: 'project', grants };
	}
	const missingTeamGroups = candidates.filter(
		(candidate) =>
			candidate.kind === 'group' &&
			folder.teamGroupIds.includes(candidate.id) &&
			!grants.some((grant) => grant.key === candidate.key),
	);
	const teamGrants = missingTeamGroups.map((group): ShareGrant => ({ ...group, role: 'viewer' }));
	return { ...draft, visibility: 'specific', grants: [...grants, ...teamGrants] };
}

/** Project-wide shares keep only per-person roles, which is what the project list shows. */
export function toSavedGrants(draft: ShareDraft): ShareGrant[] {
	if (draft.visibility === 'project') {
		return draft.grants.filter((grant) => grant.kind === 'user' && grant.role !== draft.projectRole);
	}
	return draft.grants;
}

function withoutTeamGroupsOf(
	grants: ShareGrant[],
	previousFolder: FolderAudienceFields | null,
	folder: FolderAudienceFields | null,
): ShareGrant[] {
	const droppedGroupIds = (previousFolder?.teamGroupIds ?? []).filter(
		(groupId) => !folder?.teamGroupIds.includes(groupId),
	);
	return grants.filter((grant) => grant.kind !== 'group' || !droppedGroupIds.includes(grant.id));
}

function describeGrants(grants: ShareGrant[]): string {
	return grants
		.map((grant) => `${grant.key}=${grant.role}`)
		.sort()
		.join(',');
}
