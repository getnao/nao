import { useQuery } from '@tanstack/react-query';

import { useLicenseFeatures } from '@/hooks/use-license';
import { trpc } from '@/main';

export type ProjectSwitcherMode = 'switch' | 'static' | 'upgrade';

export function useMultiProject(): ProjectSwitcherMode {
	const config = useQuery(trpc.system.getPublicConfig.queryOptions());
	const features = useLicenseFeatures();

	if (config.isPending || features.isPending) {
		return 'static';
	}

	if (config.data?.naoMode !== 'cloud') {
		return 'static';
	}

	return features.data?.['multi-project'] ? 'switch' : 'upgrade';
}
