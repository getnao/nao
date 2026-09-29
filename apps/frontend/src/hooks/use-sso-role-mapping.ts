import { useQuery } from '@tanstack/react-query';

import { trpc } from '@/main';

export function useSsoRoleMapping() {
	const { data, isLoading } = useQuery(trpc.authConfig.sso.getStatus.queryOptions());

	return {
		isLoading,
		organizationRolesManagedByIdp: data?.organizationRolesManagedByIdp ?? false,
		providerName: data?.providerName ?? 'SSO',
	};
}
