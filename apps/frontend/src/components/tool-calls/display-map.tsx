import { lazy, Suspense, useMemo } from 'react';
import { Code } from 'lucide-react';
import { buildMapPoints, MAX_MAP_POINTS, resolveMapConfig } from '@nao/shared';
import { Skeleton } from '../ui/skeleton';
import { TextShimmer } from '../ui/text-shimmer';
import { Button } from '../ui/button';
import { ToolCallWrapper } from './tool-call-wrapper';
import type { ToolCallComponentProps } from '.';
import type { displayMap } from '@nao/shared/tools';
import type { MapPoint } from '@nao/shared';
import { useSourceQuery } from '@/hooks/use-source-query';

const MapView = lazy(() => import('./display-map-view'));

export const DisplayMapToolCall = ({ toolPart: { state, input, output } }: ToolCallComponentProps<'display_map'>) => {
	const config = state !== 'input-streaming' ? input : undefined;
	const { sourceQuery, sourceData, handleViewQuery } = useSourceQuery(config?.query_id);

	const resolvedConfig = useMemo<displayMap.Input | undefined>(() => {
		if (!config || !sourceData?.data) {
			return config;
		}
		return resolveMapConfig(sourceData.data, config);
	}, [config, sourceData?.data]);

	const points = useMemo<MapPoint[]>(() => {
		if (!sourceData?.data || !resolvedConfig) {
			return [];
		}
		return buildMapPoints(sourceData.data, resolvedConfig);
	}, [sourceData?.data, resolvedConfig]);

	const visiblePoints = useMemo<MapPoint[]>(() => {
		return points.slice(0, MAX_MAP_POINTS);
	}, [points]);

	if (output && output.error) {
		return (
			<ToolCallWrapper defaultExpanded title='Could not display the map'>
				<div className='p-4 text-red-400 text-sm'>{output.error}</div>
			</ToolCallWrapper>
		);
	}

	if (!config) {
		return (
			<div className='my-4 flex flex-col gap-2 items-center aspect-3/2'>
				<Skeleton className='w-1/2 h-4' />
				<Skeleton className='w-full flex-1 flex items-center justify-center'>
					<TextShimmer text='Loading map' />
				</Skeleton>
			</div>
		);
	}

	if (!sourceData) {
		return (
			<div className='my-2 text-foreground/50 text-sm'>
				Could not display the map because the data is missing.
			</div>
		);
	}

	const mapConfig = resolvedConfig ?? config;

	if (mapConfig.latitude_key === mapConfig.longitude_key) {
		return (
			<div className='my-2 text-foreground/50 text-sm'>
				Could not display the map because the latitude and longitude keys resolve to the same column.
			</div>
		);
	}

	if (points.length === 0) {
		return (
			<div className='my-2 text-foreground/50 text-sm'>
				Could not display the map because no rows contain valid coordinates.
			</div>
		);
	}

	return (
		<div className='flex flex-col items-center my-4 gap-2'>
			<div className='flex w-full items-center justify-between gap-2'>
				<span className='text-sm font-medium text-foreground flex-1'>{config.title}</span>
				{sourceQuery?.input && (
					<Button
						variant='ghost'
						size='icon-xs'
						className='hover:rounded-full'
						onClick={handleViewQuery}
						title='View SQL query and data'
					>
						<Code className='size-4' />
					</Button>
				)}
			</div>
			<Suspense fallback={<Skeleton className='w-full aspect-3/2' />}>
				<MapView points={visiblePoints} config={mapConfig} />
			</Suspense>
			{points.length > MAX_MAP_POINTS && (
				<span className='text-xs text-foreground/50'>
					Showing the first {MAX_MAP_POINTS.toLocaleString()} of {points.length.toLocaleString()} points.
				</span>
			)}
		</div>
	);
};
