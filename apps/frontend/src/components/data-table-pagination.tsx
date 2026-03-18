import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react';
import type { Table } from '@tanstack/react-table';

import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

export function DataTablePagination<TData>({ table }: { table: Table<TData> }) {
	const pagination = table.getState().pagination;
	const pageCount = table.getPageCount();

	return (
		<div className='flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between'>
			<div className='text-sm text-muted-foreground'>
				Page {pageCount === 0 ? 0 : pagination.pageIndex + 1} of {pageCount}
			</div>

			<div className='flex flex-wrap items-center gap-2 justify-end'>
				<div className='flex items-center gap-2'>
					<div className='text-sm text-muted-foreground'>Rows per page</div>
					<Select
						value={`${pagination.pageSize}`}
						onValueChange={(value) => {
							table.setPageSize(Number(value));
						}}
					>
						<SelectTrigger size='sm' variant='default'>
							<SelectValue placeholder={pagination.pageSize} />
						</SelectTrigger>
						<SelectContent align='end'>
							{[10, 20, 30, 40, 50].map((size) => (
								<SelectItem key={size} value={`${size}`}>
									{size}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				</div>

				<div className='flex items-center gap-1'>
					<Button
						type='button'
						variant='outline'
						size='icon-sm'
						onClick={() => {
							table.setPageIndex(0);
						}}
						disabled={!table.getCanPreviousPage()}
						aria-label='Go to first page'
					>
						<ChevronsLeft />
					</Button>
					<Button
						type='button'
						variant='outline'
						size='icon-sm'
						onClick={() => {
							table.previousPage();
						}}
						disabled={!table.getCanPreviousPage()}
						aria-label='Go to previous page'
					>
						<ChevronLeft />
					</Button>
					<Button
						type='button'
						variant='outline'
						size='icon-sm'
						onClick={() => {
							table.nextPage();
						}}
						disabled={!table.getCanNextPage()}
						aria-label='Go to next page'
					>
						<ChevronRight />
					</Button>
					<Button
						type='button'
						variant='outline'
						size='icon-sm'
						onClick={() => {
							table.setPageIndex(pageCount - 1);
						}}
						disabled={!table.getCanNextPage()}
						aria-label='Go to last page'
					>
						<ChevronsRight />
					</Button>
				</div>
			</div>
		</div>
	);
}
