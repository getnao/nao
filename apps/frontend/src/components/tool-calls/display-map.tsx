import { lazy, Suspense, useMemo, useState } from 'react';
import { Code, Map as MapIcon, Table as TableIcon } from 'lucide-react';
import { buildMapPoints, MAX_MAP_POINTS, resolveMapConfig } from '@nao/shared';
import { Skeleton } from '../ui/skeleton';
import { TextShimmer } from '../ui/text-shimmer';
import { Button } from '../ui/button';
import GraphLoaderAnimated from '../icons/graph-loader-animated';
import { TableDisplay } from './display-table';
import { SqlQueryDisplay } from './sql-query-display';
import { ToolCallWrapper } from './tool-call-wrapper';
import type { ToolCallComponentProps } from '.';
import type { ReactNode } from 'react';
import type { displayMap } from '@nao/shared/tools';
import type { MapPoint } from '@nao/shared';
import { cn } from '@/lib/utils';
import { useSourceQuery } from '@/hooks/use-source-query';

const MapView = lazy(() => import('./display-map-view'));

type MapViewMode = 'map' | 'table' | 'query';

export const DisplayMapToolCall = ({ toolPart: { state, input, output } }: ToolCallComponentProps<'display_map'>) => {
	const config = state !== 'input-streaming' ? input : undefined;
	const { sourceQuery, sourceData } = useSourceQuery(config?.query_id);
	const [viewMode, setViewMode] = useState<MapViewMode>('map');

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
				<Skeleton className='w-full flex-1 flex flex-col items-center justify-center gap-3'>
					<GraphLoaderAnimated className='w-96 h-64 text-muted-foreground' />
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
		<div className='group -mx-3 my-4 flex flex-col gap-2'>
			<div
				className={cn(
					'overflow-hidden rounded-lg border transition-colors',
					viewMode === 'map' ? 'border-transparent group-hover:border-border' : 'border-border',
				)}
			>
				<div className='flex items-center justify-between gap-2 px-3 pt-2 pb-1'>
					<span className='text-sm font-medium text-foreground flex-1 truncate'>{config.title}</span>
					<div className='flex items-center gap-1'>
						<ViewToggleButton
							icon={<MapIcon className='size-3 text-muted-foreground/70' strokeWidth={2.25} />}
							title='View map'
							isActive={viewMode === 'map'}
							onClick={() => setViewMode('map')}
						/>
						<ViewToggleButton
							icon={<TableIcon className='size-3 text-muted-foreground/70' strokeWidth={2.25} />}
							title='View data table'
							isActive={viewMode === 'table'}
							onClick={() => setViewMode('table')}
						/>
						{sourceQuery?.input && (
							<ViewToggleButton
								icon={<Code className='size-3 text-muted-foreground/70' strokeWidth={2.25} />}
								title='View SQL query'
								isActive={viewMode === 'query'}
								onClick={() => setViewMode('query')}
							/>
						)}
					</div>
				</div>

				{viewMode === 'map' && (
					<div className='px-3 pb-3'>
						<Suspense fallback={<Skeleton className='w-full aspect-3/2 rounded-lg' />}>
							<MapView points={visiblePoints} config={mapConfig} />
						</Suspense>
					</div>
				)}

				{viewMode === 'table' && (
					<TableDisplay
						data={sourceData.data as Record<string, unknown>[]}
						columns={sourceData.columns}
						tableContainerClassName='max-h-[28rem]'
						maxRowsBeforePagination={10}
						compactFooter
						humanizeColumnLabels
					/>
				)}

				{viewMode === 'query' && sourceQuery?.input && (
					<div className='border-t'>
						<SqlQueryDisplay query={sourceQuery.input.sql_query} />
					</div>
				)}
			</div>

			{viewMode === 'map' && points.length > MAX_MAP_POINTS && (
				<span className='px-3 text-xs text-foreground/50'>
					Showing the first {MAX_MAP_POINTS.toLocaleString()} of {points.length.toLocaleString()} points.
				</span>
			)}
		</div>
	);
};

interface ViewToggleButtonProps {
	icon: ReactNode;
	title: string;
	isActive: boolean;
	onClick: () => void;
}

function ViewToggleButton({ icon, title, isActive, onClick }: ViewToggleButtonProps) {
	return (
		<Button
			variant='ghost-muted'
			size='icon-xs'
			className={cn('hover:rounded-full hover:bg-accent/70', isActive && 'rounded-full bg-accent/70')}
			onClick={onClick}
			title={title}
		>
			{icon}
		</Button>
	);
}
