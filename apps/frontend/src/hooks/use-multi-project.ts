import { useLicenseFeatures } from '@/hooks/use-license';
import { useIsCloud } from '@/hooks/use-nao-mode';

export type ProjectSwitcherMode = 'switch' | 'static' | 'upgrade';

export function useMultiProject(): ProjectSwitcherMode {
	const features = useLicenseFeatures();
	const isCloud = useIsCloud();

	if (features.isPending) {
		return 'static';
	}

	if (features.data?.['multi-project'] !== true) {
		return 'upgrade';
	}

	return isCloud ? 'switch' : 'static';
}
