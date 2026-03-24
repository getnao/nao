import type { UserRole } from '@nao/shared/types';

export interface UserWithRole {
	id: string;
	name: string;
	email: string;
	role: UserRole;
	messagingProviderCode: string | null;
}

export type ProjectChatsFacetKey = 'userName' | 'userRole' | 'toolState';

export interface ProjectChatListItem {
	id: string;
	updatedAt: number;
	userId: string;
	userName: string;
	userRole: UserRole | null;
	title: string;
	numberOfMessages: number;
	totalTokens: number;
	feedbackText: string;
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
		userNameCounts: Record<string, number>;
		userRoles: (UserRole | 'Former member')[];
		userRoleCounts: Partial<Record<UserRole | 'Former member', number>>;
		toolState: {
			noToolsUsed: number;
			toolsNoErrors: number;
			toolsWithErrors: number;
		};
	};
}
