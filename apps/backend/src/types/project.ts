import type { MemberStatus, ProjectChatListItem, ProjectChatReplayFacets, UserRole } from '@nao/shared/types';

export interface UserWithRole {
	id: string;
	name: string;
	email: string;
	role: UserRole;
	status: MemberStatus;
}

export type ProjectChatsFacetKey = 'userName' | 'userRole' | 'toolState' | 'feedback' | 'source';

export interface ListProjectChatsResponse {
	chats: ProjectChatListItem[];
	total: number;
	facets: ProjectChatReplayFacets<UserRole>;
}
