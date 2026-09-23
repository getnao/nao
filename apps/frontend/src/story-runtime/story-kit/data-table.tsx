import { TableDisplay } from '@nao/shared/table-display';
import {
	ChevronLeftIcon,
	ChevronRightIcon,
	ChevronsLeftIcon,
	ChevronsRightIcon,
	CopyIcon,
	DownloadIcon,
	MaximizeIcon,
	XIcon,
} from 'lucide-react';
import { useRef, useState } from 'react';
import { useClickOutside } from '../../hooks/use-click-outside';
import { copyTable, exportTable } from '../story-host';
import { Block, BlockState } from './block';
import { isNumericColumn, withNumericValues } from './columns';
import { useBlockData } from './use-block-data';
import type { TablePaginationProps } from '@nao/shared/table-display';
import type { CSSProperties } from 'react';
import type { StoryTableExportFormat } from '@nao/shared/story-app';
import type { BlockDataSource, Row } from './use-block-data';
import type { BlockProps } from './block';

export type ColumnInput = string | { key: string; label?: string };

export interface DataTableProps extends BlockProps, BlockDataSource {
	columns?: ColumnInput[];
	maxRows?: number;
	maxHeight?: number;
}

interface ResolvedColumn {
	key: string;
	label?: string;
	numeric: boolean;
}

const DEFAULT_PAGE_SIZE = 10;
const PAGE_SIZE_OPTIONS = [10, 20, 50, 100];

export function DataTable({
	queryId,
	data,
	columns,
	maxRows = DEFAULT_PAGE_SIZE,
	maxHeight = 420,
	...block
}: DataTableProps) {
	const source = useBlockData({ queryId, data });
	const [fullscreen, setFullscreen] = useState(false);
	const title = block.title ?? 'table';

	return (
		<Block kind='data-table' {...block}>
			<BlockState data={source}>
				{(rows, resultColumns) => {
					const visible = resolveColumns(rows, resultColumns, columns);
					return (
						<div className='nao-table-wrap'>
							<div className='nao-table__toolbar'>
								<TableActions
									rows={rows}
									columns={visible}
									filename={title}
									onFullscreen={() => setFullscreen(true)}
								/>
							</div>
							<TableView rows={rows} columns={visible} pageSize={maxRows} maxHeight={maxHeight} />
							{fullscreen && (
								<div className='nao-table__overlay' role='dialog' aria-label={title}>
									<div className='nao-table__overlay-card'>
										<div className='nao-table__toolbar'>
											<TableActions rows={rows} columns={visible} filename={title} />
											<button
												type='button'
												className='nao-table__overlay-close'
												onClick={() => setFullscreen(false)}
												aria-label='Close fullscreen'
											>
												<XIcon />
											</button>
										</div>
										<TableView rows={rows} columns={visible} pageSize={maxRows} />
									</div>
								</div>
							)}
						</div>
					);
				}}
			</BlockState>
		</Block>
	);
}

function resolveColumns(rows: Row[], resultColumns: string[], columns?: ColumnInput[]): ResolvedColumn[] {
	const inputs: ColumnInput[] = columns ?? resultColumns;
	return inputs.map((input) => {
		const spec = typeof input === 'string' ? { key: input } : input;
		return { key: spec.key, label: spec.label, numeric: isNumericColumn(rows, spec.key) };
	});
}

interface TableActionsProps {
	rows: Row[];
	columns: ResolvedColumn[];
	filename: string;
	onFullscreen?: () => void;
}

function TableActions({ rows, columns, filename, onFullscreen }: TableActionsProps) {
	const [exportMenuOpen, setExportMenuOpen] = useState(false);
	const menuRef = useRef<HTMLDivElement>(null);

	useClickOutside(
		{ containerRef: menuRef, enabled: exportMenuOpen, onClickOutside: () => setExportMenuOpen(false) },
		[exportMenuOpen],
	);

	const columnKeys = columns.map((column) => column.key);
	const handleCopy = () => copyTable(columnKeys, rows);
	const handleExport = (format: StoryTableExportFormat) => {
		exportTable(format, filename, columnKeys, rows);
		setExportMenuOpen(false);
	};

	return (
		<div className='nao-table__actions'>
			<button type='button' onClick={handleCopy} title='Copy rows' aria-label='Copy rows'>
				<CopyIcon />
			</button>
			<div className='nao-table__export' ref={menuRef}>
				<button
					type='button'
					onClick={() => setExportMenuOpen((current) => !current)}
					title='Export data'
					aria-label='Export data'
				>
					<DownloadIcon />
				</button>
				{exportMenuOpen && (
					<div className='nao-table__export-menu'>
						<button type='button' onClick={() => handleExport('csv')}>
							CSV
						</button>
						<button type='button' onClick={() => handleExport('xlsx')}>
							Excel (XLSX)
						</button>
					</div>
				)}
			</div>
			{onFullscreen && (
				<button type='button' onClick={onFullscreen} title='View fullscreen' aria-label='View fullscreen'>
					<MaximizeIcon />
				</button>
			)}
		</div>
	);
}

interface TableViewProps {
	rows: Row[];
	columns: ResolvedColumn[];
	pageSize: number;
	maxHeight?: number;
}

function TableView({ rows, columns, pageSize, maxHeight }: TableViewProps) {
	const style =
		maxHeight === undefined ? undefined : ({ '--nao-table-max-height': `${maxHeight}px` } as CSSProperties);
	return (
		<div className='nao-table' style={style}>
			<TableDisplay
				data={withNumericValues(
					rows,
					columns.filter((column) => column.numeric).map((column) => column.key),
				)}
				columns={columns.map((column) => column.key)}
				columnLabels={columnLabelsOf(columns)}
				maxRowsBeforePagination={pageSize}
				compactFooter
				humanizeColumnLabels
				renderPagination={(pagination) => <TableFooter {...pagination} />}
			/>
		</div>
	);
}

function columnLabelsOf(columns: ResolvedColumn[]): Record<string, string> {
	return Object.fromEntries(
		columns.flatMap((column) => (column.label === undefined ? [] : [[column.key, column.label]])),
	);
}

function TableFooter({
	totalRows,
	pageIndex,
	pageSize,
	pageCount,
	onPageChange,
	onPageSizeChange,
}: TablePaginationProps) {
	const canPrevious = pageIndex > 0;
	const canNext = pageIndex < pageCount - 1;
	const pageSizeOptions = PAGE_SIZE_OPTIONS.includes(pageSize)
		? PAGE_SIZE_OPTIONS
		: [...PAGE_SIZE_OPTIONS, pageSize].sort((a, b) => a - b);

	return (
		<div className='nao-table__footer'>
			<span>{totalRows} rows</span>
			<div className='nao-table__pager'>
				<div className='nao-table__page-size'>
					<span>Rows per page</span>
					<select value={pageSize} onChange={(event) => onPageSizeChange(Number(event.target.value))}>
						{pageSizeOptions.map((size) => (
							<option key={size} value={size}>
								{size}
							</option>
						))}
					</select>
				</div>
				<span>
					Page {pageIndex + 1} of {pageCount}
				</span>
				<div className='nao-table__pager-buttons'>
					<button
						type='button'
						onClick={() => onPageChange(0)}
						disabled={!canPrevious}
						aria-label='Go to first page'
					>
						<ChevronsLeftIcon />
					</button>
					<button
						type='button'
						onClick={() => onPageChange(pageIndex - 1)}
						disabled={!canPrevious}
						aria-label='Go to previous page'
					>
						<ChevronLeftIcon />
					</button>
					<button
						type='button'
						onClick={() => onPageChange(pageIndex + 1)}
						disabled={!canNext}
						aria-label='Go to next page'
					>
						<ChevronRightIcon />
					</button>
					<button
						type='button'
						onClick={() => onPageChange(pageCount - 1)}
						disabled={!canNext}
						aria-label='Go to last page'
					>
						<ChevronsRightIcon />
					</button>
				</div>
			</div>
		</div>
	);
}
