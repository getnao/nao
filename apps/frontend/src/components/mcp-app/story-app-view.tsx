import { Download, Loader2 } from 'lucide-react';
import { useCallback, useState } from 'react';
import { McpAppHeader } from './mcp-app-header';
import { OpenInNaoButton } from './open-in-nao-button';
import type { ParsedChartBlock, ParsedMapBlock, ParsedTableBlock } from '@nao/shared/story-segments';
import type { DownloadFormat } from '@nao/shared/types';

import type { QueryDataMap } from '@/components/story-embeds';
import { StoryChartEmbed, StoryMapEmbed, StoryTableEmbed } from '@/components/story-embeds';
import { StoryTabbedContent } from '@/components/story-tabbed-content';
import { Button } from '@/components/ui/button';
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

interface StoryAppViewProps {
	title: string;
	code: string;
	queryData: QueryDataMap | null;
	naoUrl?: string;
	onDownload?: (format: DownloadFormat) => Promise<void>;
}

export function StoryAppView({ title, code, queryData, naoUrl, onDownload }: StoryAppViewProps) {
	return (
		<div className='flex min-h-0 min-w-0 w-full flex-1 flex-col overflow-hidden bg-background text-foreground'>
			<McpAppHeader title={title}>
				{onDownload ? <StoryDownloadButton onDownload={onDownload} /> : null}
				{naoUrl ? <OpenInNaoButton url={naoUrl} /> : null}
			</McpAppHeader>
			<StoryBody code={code} queryData={queryData} />
		</div>
	);
}

function StoryBody({ code, queryData }: { code: string; queryData: QueryDataMap | null }) {
	const renderChart = useCallback(
		(
			chart: ParsedChartBlock,
			{
				queryData: data,
				hasActiveFilters,
				isRefreshing,
			}: {
				queryData: QueryDataMap | null;
				hasActiveFilters: boolean;
				isRefreshing: boolean;
			},
		) => (
			<StoryChartEmbed
				chart={chart}
				queryData={data}
				hasActiveFilters={hasActiveFilters}
				isRefreshing={isRefreshing}
			/>
		),
		[],
	);

	const renderTable = useCallback(
		(
			table: ParsedTableBlock,
			{
				queryData: data,
				hasActiveFilters,
				isRefreshing,
			}: { queryData: QueryDataMap | null; hasActiveFilters: boolean; isRefreshing: boolean },
		) => (
			<StoryTableEmbed
				table={table}
				queryData={data}
				hasActiveFilters={hasActiveFilters}
				isRefreshing={isRefreshing}
			/>
		),
		[],
	);

	const renderMap = useCallback(
		(
			map: ParsedMapBlock,
			{
				queryData: data,
				hasActiveFilters,
				isRefreshing,
			}: { queryData: QueryDataMap | null; hasActiveFilters: boolean; isRefreshing: boolean },
		) => (
			<StoryMapEmbed
				map={map}
				queryData={data}
				hasActiveFilters={hasActiveFilters}
				isRefreshing={isRefreshing}
				allowExpand
			/>
		),
		[],
	);

	return (
		<StoryTabbedContent
			code={code}
			baselineQueryData={queryData}
			renderChart={renderChart}
			renderTable={renderTable}
			renderMap={renderMap}
		/>
	);
}

function StoryDownloadButton({ onDownload }: { onDownload: (format: DownloadFormat) => Promise<void> }) {
	const [isDownloading, setIsDownloading] = useState(false);

	const handleSelect = async (format: DownloadFormat) => {
		setIsDownloading(true);
		try {
			await onDownload(format);
		} finally {
			setIsDownloading(false);
		}
	};

	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<Button variant='outline' size='sm' className='gap-1.5' disabled={isDownloading}>
					{isDownloading ? <Loader2 className='size-3.5 animate-spin' /> : <Download className='size-3.5' />}
					<span className='hidden sm:inline'>Download</span>
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align='end'>
				<DropdownMenuItem onClick={() => handleSelect('pdf')}>PDF</DropdownMenuItem>
				<DropdownMenuItem onClick={() => handleSelect('html')}>HTML</DropdownMenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
