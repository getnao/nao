import { lazy, Suspense, useMemo, useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Code, Download, Map as MapIcon, Pencil, Table as TableIcon } from 'lucide-react';
import { buildMapPoints, MAX_MAP_POINTS, resolveMapConfig } from '@nao/shared';
import { Skeleton } from '../ui/skeleton';
import { TextShimmer } from '../ui/text-shimmer';
import { Button } from '../ui/button';
import GraphLoaderAnimated from '../icons/graph-loader-animated';
import { TableDisplay } from './display-table';
import { DisplayMapEditDialog } from './display-map-edit-dialog';
import { SqlQueryDisplay } from './sql-query-display';
import { ToolCallWrapper } from './tool-call-wrapper';
import type { ToolCallComponentProps } from '.';
import type { ReactNode } from 'react';
import type { displayMap } from '@nao/shared/tools';
import type { MapPoint } from '@nao/shared';
import type { MapViewHandle } from './display-map-view';
import { cn } from '@/lib/utils';
import { trpc } from '@/main';
import { useChatId } from '@/hooks/use-chat-id';
import { useSourceQuery } from '@/hooks/use-source-query';
import { useOptionalAgentContext } from '@/contexts/agent.provider';

const MapView = lazy(() => import('./display-map-view'));

type MapViewMode = 'map' | 'table' | 'query';

export const DisplayMapToolCall = ({
	toolPart: { state, input, output, toolCallId },
}: ToolCallComponentProps<'display_map'>) => {
	const agent = useOptionalAgentContext();
	const chatId = useChatId();
	const config = state !== 'input-streaming' ? input : undefined;
	const { sourceQuery, sourceData } = useSourceQuery(config?.query_id);
	const [viewMode, setViewMode] = useState<MapViewMode>('map');
	const [isEditOpen, setIsEditOpen] = useState(false);
	const mapViewRef = useRef<MapViewHandle>(null);
	const isEditable = Boolean(agent && !agent.isReadonly && !agent.isRunning);
	const logDownload = useMutation(trpc.analyticsEvent.logChatDownload.mutationOptions());

	const handleDownloadPng = async () => {
		const dataUrl = mapViewRef.current?.captureImage('image/png');
		if (!dataUrl) {
			return;
		}
		const title = config?.title ?? '';
		const link = document.createElement('a');
		link.href = await addTitleToPng(dataUrl, title);
		link.download = `${title || 'map'}.png`;
		link.click();
		if (chatId) {
			logDownload.mutate({ chatId, format: 'png', queryId: config?.query_id, title: config?.title });
		}
	};

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
						{viewMode === 'map' && (
							<ViewToggleButton
								icon={<Download className='size-3 text-muted-foreground/70' strokeWidth={2.25} />}
								title='Download as PNG'
								isActive={false}
								onClick={handleDownloadPng}
							/>
						)}
						{isEditable && (
							<ViewToggleButton
								icon={<Pencil className='size-3 text-muted-foreground/70' strokeWidth={2.25} />}
								title='Edit map'
								isActive={false}
								onClick={() => setIsEditOpen(true)}
							/>
						)}
					</div>
				</div>

				{isEditable && (
					<DisplayMapEditDialog
						open={isEditOpen}
						onOpenChange={setIsEditOpen}
						toolCallId={toolCallId}
						config={config}
					/>
				)}

				{viewMode === 'map' && (
					<div className='px-3 pb-3'>
						<Suspense fallback={<Skeleton className='w-full aspect-3/2 rounded-lg' />}>
							<MapView ref={mapViewRef} points={visiblePoints} config={mapConfig} />
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

const EXPORT_FONT = '300 15px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
const EXPORT_TITLE_COLOR = '#0a0a0a';
const EXPORT_BACKGROUND_COLOR = '#ffffff';
const EXPORT_PADDING = 5;
const EXPORT_TITLE_HEIGHT = 24;
const EXPORT_MAP_RADIUS = 12;

async function addTitleToPng(mapDataUrl: string, title: string): Promise<string> {
	const image = await loadImage(mapDataUrl);
	const scale = window.devicePixelRatio || 1;
	const padding = EXPORT_PADDING * scale;
	const titleHeight = title ? EXPORT_TITLE_HEIGHT * scale : 0;
	const radius = EXPORT_MAP_RADIUS * scale;

	const canvas = document.createElement('canvas');
	canvas.width = image.width + padding * 2;
	canvas.height = image.height + titleHeight + padding * 2;
	const context = canvas.getContext('2d');
	if (!context) {
		return mapDataUrl;
	}

	context.fillStyle = EXPORT_BACKGROUND_COLOR;
	context.fillRect(0, 0, canvas.width, canvas.height);

	if (title) {
		context.fillStyle = EXPORT_TITLE_COLOR;
		context.font = scaleFont(EXPORT_FONT, scale);
		context.textAlign = 'center';
		context.textBaseline = 'middle';
		context.fillText(title, canvas.width / 2, padding + titleHeight / 2, image.width);
	}

	const mapTop = padding + titleHeight;
	context.save();
	context.beginPath();
	context.roundRect(padding, mapTop, image.width, image.height, radius);
	context.clip();
	context.drawImage(image, padding, mapTop + padding);
	context.restore();

	return canvas.toDataURL('image/png');
}

function scaleFont(font: string, scale: number): string {
	return font.replace(/(\d+)px/, (_, size) => `${Number(size) * scale}px`);
}

function loadImage(src: string): Promise<HTMLImageElement> {
	return new Promise((resolve, reject) => {
		const image = new Image();
		image.onload = () => resolve(image);
		image.onerror = reject;
		image.src = src;
	});
}
