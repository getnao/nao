import { useQuery } from '@tanstack/react-query';

import { getCloudBillingAccessRefetchInterval } from '@/lib/cloud-billing-access';
import { trpc } from '@/main';

export function useCloudBillingAccess({
	enabled,
	pollWhileRestricted = false,
}: {
	enabled: boolean;
	pollWhileRestricted?: boolean;
}) {
	return useQuery({
		...trpc.billing.getAccess.queryOptions(),
		enabled,
		refetchInterval: pollWhileRestricted
			? (query) => getCloudBillingAccessRefetchInterval(query.state.data)
			: false,
	});
}
