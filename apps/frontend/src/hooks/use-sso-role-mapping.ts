import { useQuery } from '@tanstack/react-query';

import { trpc } from '@/main';

export function useSsoRoleMapping() {
	const { data, isLoading } = useQuery(trpc.authConfig.oidc.getConfig.queryOptions());

	return {
		isLoading,
		rolesManagedByIdp: data?.rolesManagedByIdp ?? false,
		providerName: data?.providerName ?? 'SSO',
	};
}
