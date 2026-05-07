import { useQuery } from '@tanstack/react-query';

import { trpc } from '@/main';

export function useLicense() {
	return useQuery(trpc.license.getStatus.queryOptions());
}

export function useLicenseDetails() {
	return useQuery(trpc.license.getDetails.queryOptions());
}

export function useLicenseFeatures() {
	return useQuery(trpc.license.getFeatures.queryOptions());
}
