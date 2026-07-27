import type { ProjectChatListItem, ProjectChatReplayFacets, UserRole } from '@nao/shared/types';

export interface UserWithRole {
	id: string;
	name: string;
	email: string;
	role: UserRole;
	messagingProviderCode: string | null;
}

export type ProjectChatsFacetKey = 'userName' | 'userRole' | 'toolState' | 'feedback' | 'source';

export interface ListProjectChatsResponse {
	chats: ProjectChatListItem[];
	total: number;
	facets: ProjectChatReplayFacets<UserRole>;
}
