import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

const DEFAULT_PAGE_SIZE_OPTIONS = [10, 20, 50, 100];

interface TablePaginationCompactProps {
	totalRows: number;
	pageIndex: number;
	pageSize: number;
	pageCount: number;
	pageSizeOptions?: number[];
	onPageChange: (page: number) => void;
	onPageSizeChange: (size: number) => void;
}

export function TablePaginationCompact({
	totalRows,
	pageIndex,
	pageSize,
	pageCount,
	pageSizeOptions = DEFAULT_PAGE_SIZE_OPTIONS,
	onPageChange,
	onPageSizeChange,
}: TablePaginationCompactProps) {
	const canPrevious = pageIndex > 0;
	const canNext = pageIndex < pageCount - 1;

	return (
		<div className='flex shrink-0 flex-wrap items-center justify-between gap-2 px-4 py-2 text-xs text-muted-foreground border-t'>
			<span>{totalRows} rows</span>

			<div className='flex flex-wrap items-center justify-end gap-2'>
				<div className='flex items-center gap-1.5'>
					<span>Rows per page</span>
					<Select value={`${pageSize}`} onValueChange={(v) => onPageSizeChange(Number(v))}>
						<SelectTrigger size='sm' variant='ghost' className='h-6 gap-1 px-1.5 text-xs'>
							<SelectValue />
						</SelectTrigger>
						<SelectContent align='end' className='bg-background'>
							{pageSizeOptions.map((size) => (
								<SelectItem key={size} value={`${size}`} className='text-xs'>
									{size}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				</div>

				<span>
					Page {pageCount === 0 ? 0 : pageIndex + 1} of {pageCount}
				</span>

				<div className='flex items-center gap-0.5'>
					<Button
						type='button'
						variant='ghost-muted'
						size='icon-xs'
						className='transition-colors hover:rounded-full'
						onClick={() => onPageChange(0)}
						disabled={!canPrevious}
						aria-label='Go to first page'
					>
						<ChevronsLeft />
					</Button>
					<Button
						type='button'
						variant='ghost-muted'
						size='icon-xs'
						className='transition-colors hover:rounded-full'
						onClick={() => onPageChange(pageIndex - 1)}
						disabled={!canPrevious}
						aria-label='Go to previous page'
					>
						<ChevronLeft />
					</Button>
					<Button
						type='button'
						variant='ghost-muted'
						size='icon-xs'
						className='transition-colors hover:rounded-full'
						onClick={() => onPageChange(pageIndex + 1)}
						disabled={!canNext}
						aria-label='Go to next page'
					>
						<ChevronRight />
					</Button>
					<Button
						type='button'
						variant='ghost-muted'
						size='icon-xs'
						className='transition-colors hover:rounded-full'
						onClick={() => onPageChange(pageCount - 1)}
						disabled={!canNext}
						aria-label='Go to last page'
					>
						<ChevronsRight />
					</Button>
				</div>
			</div>
		</div>
	);
}
