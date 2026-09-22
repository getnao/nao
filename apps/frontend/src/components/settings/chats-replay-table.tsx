import { ChevronDown } from 'lucide-react';
import { flexRender } from '@tanstack/react-table';
import type { Table } from '@tanstack/react-table';
import type { KeyboardEvent } from 'react';

import type { ProjectChatListItem } from '@nao/shared/types';
import { TablePagination } from '@/components/ui/table-pagination';
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { cn } from '@/lib/utils';

type ChatsReplayTableProps = {
	table: Table<ProjectChatListItem>;
	onRowClick: (chat: ProjectChatListItem) => void;
};

export function ChatsReplayTable({ table, onRowClick }: ChatsReplayTableProps) {
	const colSpan = table.getVisibleLeafColumns().length;
	const edgeCellClassName = 'first:pl-4 first:md:pl-8 last:pr-4 last:md:pr-8';

	return (
		<div className='flex h-full flex-col flex-1 min-h-0 overflow-hidden'>
			<div className='flex-1 min-h-0 overflow-auto overscroll-contain'>
				<table className='w-full min-w-[1000px] caption-bottom text-sm'>
					<TableHeader className='sticky top-0 z-10 bg-background shadow-[inset_0_1px_0_var(--border),inset_0_-1px_0_var(--border)] [&_tr]:border-b-0'>
						{table.getHeaderGroups().map((headerGroup) => (
							<TableRow key={headerGroup.id}>
								{headerGroup.headers.map((header) => (
									<TableHead
										key={header.id}
										onClick={header.column.getToggleSortingHandler()}
										className={cn(
											edgeCellClassName,
											header.column.getCanSort() && 'cursor-pointer select-none',
										)}
									>
										<div className='flex items-center space-x-1 text-muted-foreground'>
											<span>
												{flexRender(header.column.columnDef.header, header.getContext())}
											</span>
											<ChevronDown
												size={14}
												className={cn(
													'transition-transform text-muted-foreground',
													header.column.getIsSorted() === 'asc' &&
														'rotate-180 text-foreground',
													header.column.getIsSorted() === 'desc' && 'text-foreground',
													header.column.getIsSorted() === false && 'opacity-30',
												)}
											/>
										</div>
									</TableHead>
								))}
							</TableRow>
						))}
					</TableHeader>

					<TableBody>
						{table.getRowModel().rows.length === 0 ? (
							<TableRow>
								<TableCell
									colSpan={colSpan}
									className='text-center py-10 text-muted-foreground text-sm'
								>
									No chats match your filters.
								</TableCell>
							</TableRow>
						) : (
							table.getRowModel().rows.map((row) => (
								<TableRow
									key={row.id}
									onClick={() => onRowClick(row.original)}
									onKeyDown={(event) => handleRowKeyDown(event, row.original, onRowClick)}
									tabIndex={0}
									aria-label={`Open chat: ${row.original.title || 'Untitled'}`}
									className='!border-0 cursor-pointer hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
								>
									{row.getVisibleCells().map((cell) => (
										<TableCell key={cell.id} className={edgeCellClassName}>
											{flexRender(cell.column.columnDef.cell, cell.getContext())}
										</TableCell>
									))}
								</TableRow>
							))
						)}
					</TableBody>
				</table>
			</div>

			<div className='shrink-0 bg-background'>
				<TablePagination
					totalRows={table.getRowCount()}
					pageIndex={table.getState().pagination.pageIndex}
					pageSize={table.getState().pagination.pageSize}
					pageCount={table.getPageCount()}
					onPageChange={(p) => table.setPageIndex(p)}
					onPageSizeChange={(s) => table.setPageSize(s)}
				/>
			</div>
		</div>
	);
}

function handleRowKeyDown(
	event: KeyboardEvent<HTMLTableRowElement>,
	chat: ProjectChatListItem,
	onRowClick: (chat: ProjectChatListItem) => void,
) {
	if (event.key !== 'Enter' && event.key !== ' ') {
		return;
	}

	event.preventDefault();
	onRowClick(chat);
}
