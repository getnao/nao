import type { ShareRole, Visibility } from '@nao/shared/types';

import type { ShareCandidate, ShareGrant } from '@/lib/share-access';

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

/** Project-wide shares keep only per-person roles, which is what the project list shows. */
export function toSavedGrants(draft: ShareDraft): ShareGrant[] {
	if (draft.visibility === 'project') {
		return draft.grants.filter((grant) => grant.kind === 'user' && grant.role !== draft.projectRole);
	}
	return draft.grants;
}

function describeGrants(grants: ShareGrant[]): string {
	return grants
		.map((grant) => `${grant.key}=${grant.role}`)
		.sort()
		.join(',');
}
