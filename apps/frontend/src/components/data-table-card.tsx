import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Copy, Download, Maximize2 } from 'lucide-react';
import { TableDisplay } from '@/components/tool-calls/display-table';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { downloadCsv, tableToCsv, tableToTsv } from '@/lib/table-export';
import { cn } from '@/lib/utils';
import { trpc } from '@/main';

interface DataTableCardProps {
	columns: string[];
	data: Record<string, unknown>[];
	title?: string;
	className?: string;
	tableContainerClassName?: string;
	maxRowsBeforePagination?: number;
	chatId?: string;
}

export function DataTableCard({
	columns,
	data,
	title,
	className,
	tableContainerClassName,
	maxRowsBeforePagination = 10,
	chatId,
}: DataTableCardProps) {
	const [isFullscreen, setIsFullscreen] = useState(false);
	const logDownload = useMutation(trpc.analyticsEvent.logChatDownload.mutationOptions());

	const resolvedColumns = columns.length > 0 ? columns : inferColumns(data);

	if (resolvedColumns.length === 0) {
		return null;
	}

	const handleCopy = () => navigator.clipboard.writeText(tableToTsv(resolvedColumns, data));
	const handleDownload = () => {
		downloadCsv('table.csv', tableToCsv(resolvedColumns, data));
		if (chatId) {
			logDownload.mutate({ chatId, format: 'csv', title });
		}
	};

	return (
		<div className={cn('flex flex-col gap-2 border rounded-lg pt-2', className)}>
			<div className={cn('flex items-center gap-1 px-3', title ? 'justify-between' : 'justify-end')}>
				{title ? <span className='text-sm font-medium truncate'>{title}</span> : null}
				<div className='flex items-center gap-1'>
					<Button
						variant='ghost-muted'
						size='icon-xs'
						className='hover:rounded-full hover:bg-accent/70'
						onClick={handleCopy}
						title='Copy rows'
					>
						<Copy className='size-3 text-muted-foreground/70' />
					</Button>
					<Button
						variant='ghost-muted'
						size='icon-xs'
						className='hover:rounded-full hover:bg-accent/70'
						onClick={handleDownload}
						title='Download as CSV'
					>
						<Download className='size-3 text-muted-foreground/70' />
					</Button>
					<Button
						variant='ghost-muted'
						size='icon-xs'
						className='hover:rounded-full hover:bg-accent/70'
						onClick={() => setIsFullscreen(true)}
						title='View fullscreen'
					>
						<Maximize2 className='size-3 text-muted-foreground/70' />
					</Button>
				</div>
			</div>

			<TableDisplay
				data={data}
				columns={resolvedColumns}
				tableContainerClassName={tableContainerClassName}
				maxRowsBeforePagination={maxRowsBeforePagination}
				compactFooter={true}
			/>

			<Dialog open={isFullscreen} onOpenChange={setIsFullscreen}>
				<DialogContent className='w-[95vw] max-w-[95vw] gap-2'>
					<DialogTitle className='sr-only'>{title ?? 'Table'}</DialogTitle>
					<div className='flex flex-row justify-end gap-1 -my-1 px-5'>
						<Button
							variant='ghost-muted'
							size='icon-xs'
							className='hover:rounded-full'
							onClick={handleCopy}
							title='Copy rows'
						>
							<Copy className='size-3.5' />
						</Button>
						<Button
							variant='ghost-muted'
							size='icon-xs'
							className='hover:rounded-full'
							onClick={handleDownload}
							title='Download as CSV'
						>
							<Download className='size-3.5' />
						</Button>
					</div>
					<TableDisplay
						data={data}
						columns={resolvedColumns}
						className='min-w-0 overflow-hidden rounded-lg border'
						tableContainerClassName='max-h-[75vh] border-t-0'
						maxRowsBeforePagination={maxRowsBeforePagination}
						compactFooter={true}
					/>
				</DialogContent>
			</Dialog>
		</div>
	);
}

function inferColumns(data: Record<string, unknown>[]): string[] {
	const seen = new Set<string>();
	const columns: string[] = [];

	for (const row of data) {
		for (const column of Object.keys(row)) {
			if (seen.has(column)) {
				continue;
			}
			seen.add(column);
			columns.push(column);
		}
	}

	return columns;
}
