import { buildMapPoints, MAX_MAP_POINTS, resolveMapConfig } from '@nao/shared';
import { lazy, memo, Suspense, useMemo } from 'react';
import { McpAppHeader } from './mcp-app-header';
import { OpenInNaoButton } from './open-in-nao-button';
import type { CustomBoundarySet, MapPoint, McpMapEmbedStoredConfig } from '@nao/shared';

import { Skeleton } from '@/components/ui/skeleton';

const MapView = lazy(() => import('@/components/tool-calls/display-map-view'));

interface MapAppViewProps {
	config: McpMapEmbedStoredConfig;
	data: Record<string, unknown>[];
	columns: string[];
	naoUrl?: string;
	projectId?: string;
	customBoundaries?: CustomBoundarySet[];
}

export const MapAppView = memo(function MapAppView({
	config,
	data,
	naoUrl,
	projectId,
	customBoundaries,
}: MapAppViewProps) {
	const resolvedConfig = useMemo(() => resolveMapConfig(data, config), [data, config]);
	const points = useMemo<MapPoint[]>(() => buildMapPoints(data, resolvedConfig), [data, resolvedConfig]);
	const visiblePoints = useMemo<MapPoint[]>(() => points.slice(0, MAX_MAP_POINTS), [points]);

	const isChoropleth = resolvedConfig.map_type === 'choropleth';
	const errorMessage = mapErrorMessage(resolvedConfig, points, isChoropleth);
	const isTruncated = !isChoropleth && points.length > MAX_MAP_POINTS;

	return (
		<div className='flex min-h-0 min-w-0 w-full flex-1 flex-col overflow-hidden bg-background text-foreground'>
			<McpAppHeader title={config.title}>{naoUrl ? <OpenInNaoButton url={naoUrl} /> : null}</McpAppHeader>
			<div className='min-h-0 flex-1 overflow-auto'>
				<div className='mx-auto flex w-full min-w-0 max-w-5xl flex-col p-4 md:p-8'>
					{errorMessage ? (
						<div className='my-2 text-foreground/50 text-sm'>{errorMessage}</div>
					) : (
						<Suspense fallback={<Skeleton className='w-full aspect-3/2 rounded-lg' />}>
							<MapView
								points={visiblePoints}
								rows={data}
								config={resolvedConfig}
								customBoundaries={customBoundaries}
								boundaryProjectId={projectId}
							/>
						</Suspense>
					)}
					{isTruncated && (
						<span className='mt-2 px-1 text-xs text-foreground/50'>
							Showing the first {MAX_MAP_POINTS.toLocaleString()} of {points.length.toLocaleString()}{' '}
							points.
						</span>
					)}
				</div>
			</div>
		</div>
	);
});

function mapErrorMessage(config: McpMapEmbedStoredConfig, points: MapPoint[], isChoropleth: boolean): string | null {
	if (isChoropleth) {
		return null;
	}
	if (config.latitude_key === config.longitude_key) {
		return 'Could not display the map because the latitude and longitude keys resolve to the same column.';
	}
	if (points.length === 0) {
		return 'Could not display the map because no rows contain valid coordinates.';
	}
	return null;
}
