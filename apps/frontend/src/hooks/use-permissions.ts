import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';

import type { UserRole } from '@nao/shared/types';
import { useCloudBillingAccess } from '@/hooks/use-cloud-billing-access';
import { trpc } from '@/main';

export function usePermissions() {
	const project = useQuery(trpc.project.getCurrent.queryOptions());
	const org = useQuery(trpc.organization.get.queryOptions());
	const config = useQuery(trpc.system.getPublicConfig.queryOptions());
	const billingAccess = useCloudBillingAccess({ enabled: config.data?.cloudBillingEnabled === true });
	const role = project.data?.userRole as UserRole | undefined;
	const isSeatReadOnly = billingAccess.data?.freeTierEnabled === true && billingAccess.data.isReadOnly;
	const hasWriteAccess = !isSeatReadOnly && role !== 'viewer' && !!role;

	return useMemo(
		() => ({
			role,
			isSeatReadOnly,
			isAdmin: role === 'admin',
			isUser: role === 'user',
			isViewer: role === 'viewer',
			isContextAdmin: role === 'context_admin',
			isOrgAdmin: org.data?.role === 'admin',
			canSendMessages: hasWriteAccess,
			canShare: hasWriteAccess,
			canEditSettings: role === 'admin' && !isSeatReadOnly,
			canInvite: role === 'admin' && !isSeatReadOnly,
			canViewUsage: role === 'admin' || role === 'user' || role === 'context_admin',
			canViewAllUsage: role === 'admin',
			canViewChatReplay: role === 'admin' || role === 'context_admin',
			canViewRecommendations: role === 'admin' || role === 'context_admin',
			canChatWithNaoData: !isSeatReadOnly && (role === 'admin' || role === 'context_admin'),
			canStartNewChat: hasWriteAccess,
			canViewSharedObjects: !!role,
		}),
		[hasWriteAccess, isSeatReadOnly, role, org.data?.role],
	);
}

export type Permissions = ReturnType<typeof usePermissions>;
export type PermissionKey = keyof Omit<Permissions, 'role'>;
