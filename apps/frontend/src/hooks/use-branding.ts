/* @license Enterprise */

import { useQuery } from '@tanstack/react-query';

import { trpc } from '@/main';

export interface BrandingState {
	enabled: boolean;
	appName: string | null;
	tabTitle: string | null;
	brandColor: string | null;
	hasLogo: boolean;
	hasFavicon: boolean;
	updatedAt: number | null;
}

export function useBranding(): BrandingState {
	const { data } = useQuery({
		...trpc.branding.getPublic.queryOptions(),
		staleTime: 60_000,
	});
	return (
		data ?? {
			enabled: false,
			appName: null,
			tabTitle: null,
			brandColor: null,
			hasLogo: false,
			hasFavicon: false,
			updatedAt: null,
		}
	);
}

export function brandingAssetUrl(kind: 'logo' | 'favicon', version: number | null): string {
	const v = version ?? 0;
	return `/branding/${kind}?v=${v}`;
}
