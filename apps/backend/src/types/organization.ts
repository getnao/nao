export type OrgRole = 'admin' | 'user';

export const ORG_ROLES = ['admin', 'user'] as const satisfies readonly OrgRole[];

export type OrgChatsResponse = {
	chats: {
		id: string;
		title: string;
		createdAt: number;
		updatedAt: number;
		warningTypes: ('error' | 'downvote')[];
		warningSummary: string;
		userId: string;
		userName: string;
		userRole: string;
	}[];
};
