import type { ShareRole, Visibility } from '@nao/shared/types';

export type ShareSubjectKind = 'user' | 'group';

export interface ShareCandidate {
	key: string;
	kind: ShareSubjectKind;
	id: string;
	name: string;
	detail: string;
}

export interface ShareGrant extends ShareCandidate {
	role: ShareRole;
}

export interface ShareSelection {
	userIds: string[];
	groupIds: string[];
}

export interface ShareOwner {
	id: string;
	name: string;
	email: string;
}

export interface GeneralAccess {
	visibility: Visibility;
	projectRole: ShareRole;
}

export function shareSubjectKey(kind: ShareSubjectKind, id: string): string {
	return `${kind}:${id}`;
}

export function toShareSelection(items: Pick<ShareCandidate, 'kind' | 'id'>[]): ShareSelection {
	return {
		userIds: items.filter((item) => item.kind === 'user').map((item) => item.id),
		groupIds: items.filter((item) => item.kind === 'group').map((item) => item.id),
	};
}

export function toggleKey(keys: Set<string>, key: string): Set<string> {
	const next = new Set(keys);
	if (next.has(key)) {
		next.delete(key);
	} else {
		next.add(key);
	}
	return next;
}

export function formatMemberCount(memberCount: number): string {
	return `${memberCount} ${memberCount === 1 ? 'member' : 'members'}`;
}
