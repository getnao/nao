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
	const points = useMemo<MapPoint[]>(
		() => buildMapPoints(data, resolvedConfig).slice(0, MAX_MAP_POINTS),
		[data, resolvedConfig],
	);

	return (
		<div className='flex min-h-0 min-w-0 w-full flex-1 flex-col overflow-hidden bg-background text-foreground'>
			<McpAppHeader title={config.title}>{naoUrl ? <OpenInNaoButton url={naoUrl} /> : null}</McpAppHeader>
			<div className='min-h-0 flex-1 overflow-auto'>
				<div className='mx-auto flex w-full min-w-0 max-w-5xl flex-col p-4 md:p-8'>
					<Suspense fallback={<Skeleton className='w-full aspect-3/2 rounded-lg' />}>
						<MapView
							points={points}
							rows={data}
							config={resolvedConfig}
							customBoundaries={customBoundaries}
							boundaryProjectId={projectId}
						/>
					</Suspense>
				</div>
			</div>
		</div>
	);
});
