import { ChevronDown } from 'lucide-react';
import { flexRender } from '@tanstack/react-table';
import type { Table } from '@tanstack/react-table';

import { DataTablePagination } from '@/components/data-table-pagination';
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { cn } from '@/lib/utils';

export function ChatsReplayTable<TData>({ table }: { table: Table<TData> }) {
	const colSpan = table.getVisibleLeafColumns().length;

	return (
		<div className='flex flex-col flex-1 min-h-0'>
			<div className='flex-1 min-h-0 overflow-auto'>
				<table className='w-full caption-bottom text-sm'>
					<TableHeader className='sticky top-0 z-10 bg-card'>
						{table.getHeaderGroups().map((headerGroup) => (
							<TableRow key={headerGroup.id}>
								{headerGroup.headers.map((header) => (
									<TableHead
										key={header.id}
										onClick={header.column.getToggleSortingHandler()}
										className={cn(header.column.getCanSort() && 'cursor-pointer select-none')}
									>
										<div className='flex items-center space-x-1'>
											{header.id === 'actions' ? (
												<span>Open chat</span>
											) : (
												<>
													<span>
														{flexRender(
															header.column.columnDef.header,
															header.getContext(),
														)}
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
												</>
											)}
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
								<TableRow key={row.id}>
									{row.getVisibleCells().map((cell) => (
										<TableCell key={cell.id}>
											{flexRender(cell.column.columnDef.cell, cell.getContext())}
										</TableCell>
									))}
								</TableRow>
							))
						)}
					</TableBody>
				</table>
			</div>

			<div className='shrink-0 border-t border-border px-4 py-2'>
				<DataTablePagination table={table} />
			</div>
		</div>
	);
}
