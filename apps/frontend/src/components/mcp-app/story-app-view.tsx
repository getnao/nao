import { splitCodeIntoSegments } from '@nao/shared/story-segments';
import { Download, Loader2 } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';
import { McpAppHeader } from './mcp-app-header';
import { OpenInNaoButton } from './open-in-nao-button';
import type { ParsedChartBlock, ParsedTableBlock } from '@nao/shared/story-segments';
import type { DownloadFormat } from '@nao/shared/types';

import type { QueryDataMap } from '@/components/story-embeds';
import { StoryChartEmbed, StoryTableEmbed } from '@/components/story-embeds';
import { SegmentList } from '@/components/story-rendering';
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
	const segments = useMemo(() => splitCodeIntoSegments(code), [code]);

	const renderChart = useCallback(
		(chart: ParsedChartBlock) => <StoryChartEmbed chart={chart} queryData={queryData} />,
		[queryData],
	);

	const renderTable = useCallback(
		(table: ParsedTableBlock) => <StoryTableEmbed table={table} queryData={queryData} />,
		[queryData],
	);

	return (
		<div className='min-h-0 flex-1 overflow-auto'>
			<div className='mx-auto flex w-full min-w-0 max-w-5xl flex-col gap-4 p-4 md:p-8'>
				<SegmentList segments={segments} renderChart={renderChart} renderTable={renderTable} />
			</div>
		</div>
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
