import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

const DEFAULT_PAGE_SIZE_OPTIONS = [10, 20, 50, 100];

interface TablePaginationProps {
	totalRows: number;
	pageIndex: number;
	pageSize: number;
	pageCount: number;
	pageSizeOptions?: number[];
	onPageChange: (page: number) => void;
	onPageSizeChange: (size: number) => void;
}

export function TablePagination({
	totalRows,
	pageIndex,
	pageSize,
	pageCount,
	pageSizeOptions = DEFAULT_PAGE_SIZE_OPTIONS,
	onPageChange,
	onPageSizeChange,
}: TablePaginationProps) {
	const canPrevious = pageIndex > 0;
	const canNext = pageIndex < pageCount - 1;

	return (
		<div className='shrink-0 border-t border-border px-4 py-2'>
			<div className='flex shrink-0 items-center justify-between'>
				<span className='text-sm text-muted-foreground'>{totalRows} rows</span>

				<div className='flex flex-wrap items-center gap-2 justify-end'>
					<div className='flex items-center gap-2'>
						<span className='text-sm text-muted-foreground'>Rows per page</span>
						<Select value={`${pageSize}`} onValueChange={(v) => onPageSizeChange(Number(v))}>
							<SelectTrigger size='sm' variant='default'>
								<SelectValue />
							</SelectTrigger>
							<SelectContent align='end'>
								{pageSizeOptions.map((size) => (
									<SelectItem key={size} value={`${size}`}>
										{size}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					</div>

					<span className='text-sm text-muted-foreground'>
						Page {pageCount === 0 ? 0 : pageIndex + 1} of {pageCount}
					</span>

					<div className='flex items-center gap-1'>
						<Button
							type='button'
							variant='outline'
							size='icon-sm'
							onClick={() => onPageChange(0)}
							disabled={!canPrevious}
							aria-label='Go to first page'
						>
							<ChevronsLeft />
						</Button>
						<Button
							type='button'
							variant='outline'
							size='icon-sm'
							onClick={() => onPageChange(pageIndex - 1)}
							disabled={!canPrevious}
							aria-label='Go to previous page'
						>
							<ChevronLeft />
						</Button>
						<Button
							type='button'
							variant='outline'
							size='icon-sm'
							onClick={() => onPageChange(pageIndex + 1)}
							disabled={!canNext}
							aria-label='Go to next page'
						>
							<ChevronRight />
						</Button>
						<Button
							type='button'
							variant='outline'
							size='icon-sm'
							onClick={() => onPageChange(pageCount - 1)}
							disabled={!canNext}
							aria-label='Go to last page'
						>
							<ChevronsRight />
						</Button>
					</div>
				</div>
			</div>
		</div>
	);
}
