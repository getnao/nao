import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useCallback } from 'react';

import { setActiveOrganizationId } from '@/lib/active-organization';

export function useOpenOrganizationBilling() {
	const navigate = useNavigate();
	const queryClient = useQueryClient();

	return useCallback(
		async (organizationId: string) => {
			setActiveOrganizationId(organizationId);
			await queryClient.invalidateQueries();
			await navigate({
				to: '/settings/organization/billing',
				search: { checkout: undefined, portal: undefined },
			});
		},
		[navigate, queryClient],
	);
}
