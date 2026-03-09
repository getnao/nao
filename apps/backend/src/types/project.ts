export type UserRole = 'admin' | 'user' | 'viewer';

export const USER_ROLES = ['admin', 'user', 'viewer'] as const satisfies readonly UserRole[];

export interface UserWithRole {
	id: string;
	name: string;
	email: string;
	role: UserRole;
}

export type ProjectChatsFacetKey = 'userName' | 'userRole' | 'toolErrorCount';

export interface ProjectChatListItem {
	id: string;
	updatedAt: number;
	userId: string;
	userName: string;
	userRole: string;
	title: string;
	numberOfMessages: number;
	totalTokens: number;
	downvotes: number;
	upvotes: number;
	toolErrorCount: number;
	toolAvailableCount: number;
}

export interface ListProjectChatsResponse {
	chats: ProjectChatListItem[];
	total: number;
	facets: {
		userNames: string[];
		userRoles: string[];
		toolErrorCount: number;
	};
}
