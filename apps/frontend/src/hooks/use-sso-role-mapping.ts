import { useQuery } from '@tanstack/react-query';

import { trpc } from '@/main';

export function useSsoRoleMapping() {
	const { data } = useQuery(trpc.authConfig.oidc.getConfig.queryOptions());

	return {
		rolesManagedByIdp: data?.rolesManagedByIdp ?? false,
		providerName: data?.providerName ?? 'SSO',
	};
}
