import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';

import type { UserRole } from '@nao/shared/types';
import { trpc } from '@/main';

export function usePermissions() {
	const project = useQuery(trpc.project.getCurrent.queryOptions());
	const org = useQuery(trpc.organization.get.queryOptions());
	const role = project.data?.userRole as UserRole | undefined;

	return useMemo(
		() => ({
			role,
			isAdmin: role === 'admin',
			isUser: role === 'user',
			isViewer: role === 'viewer',
			isOrgAdmin: org.data?.role === 'admin',
			canSendMessages: role === 'admin' || role === 'user',
			canShare: role === 'admin' || role === 'user',
			canEditSettings: role === 'admin',
			canInvite: role === 'admin',
			canViewUsage: role === 'admin',
			canViewChatReplay: role === 'admin',
			canStartNewChat: role !== 'viewer' && !!role,
			canViewSharedObjects: !!role,
		}),
		[role, org.data?.role],
	);
}

export type Permissions = ReturnType<typeof usePermissions>;
export type PermissionKey = keyof Omit<Permissions, 'role'>;
