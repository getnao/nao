import { buildMapPoints, MAX_MAP_POINTS, resolveMapConfig } from '@nao/shared';
import { lazy, Suspense, useMemo } from 'react';
import type { MapPoint } from '@nao/shared';
import type { ParsedMapBlock } from '@nao/shared/story-segments';
import type { displayMap } from '@nao/shared/tools';

import { Skeleton } from '@/components/ui/skeleton';

const MapView = lazy(() => import('@/components/tool-calls/display-map-view'));

function mapBlockToConfig(map: ParsedMapBlock): displayMap.Input {
	return {
		query_id: map.queryId,
		map_type: (map.mapType || 'points') as displayMap.Input['map_type'],
		latitude_key: map.latitudeKey,
		longitude_key: map.longitudeKey,
		label_key: map.labelKey,
		tooltip_keys: map.tooltipKeys,
		marker_color: map.markerColor,
		marker_radius: map.markerRadius,
		title: map.title,
	};
}

/** Renders a parsed story `<map>` block from resolved query rows, shared by the live and static embeds. */
export function StoryMapRender({ map, data }: { map: ParsedMapBlock; data: Record<string, unknown>[] }) {
	const config = useMemo(() => resolveMapConfig(data, mapBlockToConfig(map)), [map, data]);
	const points = useMemo<MapPoint[]>(() => buildMapPoints(data, config), [data, config]);
	const visiblePoints = useMemo(() => points.slice(0, MAX_MAP_POINTS), [points]);

	if (config.latitude_key === config.longitude_key) {
		return <StoryMapFallback>The latitude and longitude keys resolve to the same column.</StoryMapFallback>;
	}

	if (points.length === 0) {
		return <StoryMapFallback>No rows contain valid coordinates.</StoryMapFallback>;
	}

	return (
		<div className='flex flex-col gap-2'>
			<Suspense fallback={<Skeleton className='w-full aspect-3/2 rounded-lg' />}>
				<MapView points={visiblePoints} config={config} />
			</Suspense>
			{points.length > MAX_MAP_POINTS && (
				<span className='text-xs text-foreground/50'>
					Showing the first {MAX_MAP_POINTS.toLocaleString()} of {points.length.toLocaleString()} points.
				</span>
			)}
		</div>
	);
}

function StoryMapFallback({ children }: { children: React.ReactNode }) {
	return <div className='my-2 text-sm text-foreground/50'>{children}</div>;
}
