import { useQuery } from '@tanstack/react-query';

import { useDevOverrides } from '@/lib/dev-overrides';
import { trpc } from '@/main';

export function useLicense() {
	return useQuery(trpc.license.getStatus.queryOptions());
}

export function useLicenseDetails() {
	return useQuery(trpc.license.getDetails.queryOptions());
}

export function useLicenseFeatures() {
	const features = useQuery(trpc.license.getFeatures.queryOptions());
	const { license } = useDevOverrides();

	if (license === 'on') {
		return { ...features, data: enabledLicenseFeatures };
	}

	if (license === 'off') {
		return { ...features, data: disabledLicenseFeatures };
	}

	return features;
}

const enabledLicenseFeatures = {
	sso: true,
	'white-label': true,
	'user-budget': true,
	'multi-project': true,
} as const;

const disabledLicenseFeatures = {
	sso: false,
	'white-label': false,
	'user-budget': false,
	'multi-project': false,
} as const;
