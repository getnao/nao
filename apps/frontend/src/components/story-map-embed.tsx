import { buildMapPoints, MAX_MAP_POINTS, resolveMapConfig } from '@nao/shared';
import { lazy, Suspense, useMemo } from 'react';
import { mapBlockToInput } from '@nao/shared/story-segments';
import type { MapPoint } from '@nao/shared';
import type { ParsedMapBlock } from '@nao/shared/story-segments';

import { Skeleton } from '@/components/ui/skeleton';

const MapView = lazy(() => import('@/components/tool-calls/display-map-view'));

/** Renders a parsed story `<map>` block from resolved query rows, shared by the live and static embeds. */
export function StoryMapRender({ map, data }: { map: ParsedMapBlock; data: Record<string, unknown>[] }) {
	const config = useMemo(() => resolveMapConfig(data, mapBlockToInput(map)), [map, data]);
	const points = useMemo<MapPoint[]>(() => buildMapPoints(data, config), [data, config]);
	const visiblePoints = useMemo(() => points.slice(0, MAX_MAP_POINTS), [points]);
	const isChoropleth = config.map_type === 'choropleth';

	if (!isChoropleth && config.latitude_key === config.longitude_key) {
		return <StoryMapFallback>The latitude and longitude keys resolve to the same column.</StoryMapFallback>;
	}

	if (!isChoropleth && points.length === 0) {
		return <StoryMapFallback>No rows contain valid coordinates.</StoryMapFallback>;
	}

	return (
		<div className='flex flex-col gap-2'>
			<Suspense fallback={<Skeleton className='w-full aspect-3/2 rounded-lg' />}>
				<MapView points={visiblePoints} rows={data} config={config} />
			</Suspense>
			{!isChoropleth && points.length > MAX_MAP_POINTS && (
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
