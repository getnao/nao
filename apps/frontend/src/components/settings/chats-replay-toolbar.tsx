import { Columns2, Filter, Users, X } from 'lucide-react';
import type { ColumnFiltersState, Table } from '@tanstack/react-table';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
	DropdownMenu,
	DropdownMenuCheckboxItem,
	DropdownMenuContent,
	DropdownMenuSeparator,
	DropdownMenuSub,
	DropdownMenuSubContent,
	DropdownMenuSubTrigger,
	DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

export type ChatsReplayFacets = {
	userNames: string[];
	userRoles: string[];
	toolErrorCount: number;
};

type ChatsReplayToolbarProps<TData> = {
	globalFilter: string;
	onGlobalFilterChange: (value: string) => void;
	columnFilters: ColumnFiltersState;
	onColumnFiltersChange: (next: ColumnFiltersState) => void;
	facets: ChatsReplayFacets;
	table: Table<TData>;
};

export function ChatsReplayToolbar<TData>({
	globalFilter,
	onGlobalFilterChange,
	columnFilters,
	onColumnFiltersChange,
	facets,
	table,
}: ChatsReplayToolbarProps<TData>) {
	const userNameFilter = (columnFilters.find((f) => f.id === 'userName')?.value as string[]) ?? [];

	const activeFilters = columnFilters.filter((f) => (f.value as string[])?.length > 0);

	const removeFilterValue = (columnId: string, value: string) => {
		onColumnFiltersChange(
			columnFilters
				.map((f) => {
					if (f.id !== columnId) {
						return f;
					}
					const next = (f.value as string[]).filter((v) => v !== value);
					return { ...f, value: next };
				})
				.filter((f) => (f.value as string[])?.length > 0),
		);
	};

	const clearAllFilters = () => {
		onColumnFiltersChange([]);
		onGlobalFilterChange('');
	};

	const toggleableColumns = table.getAllLeafColumns().filter((col) => col.getCanHide());
	const visibleCount = toggleableColumns.filter((col) => col.getIsVisible()).length;
	const hiddenCount = toggleableColumns.length - visibleCount;

	const filterConfigs = [{ id: 'userRole', label: 'Role', values: facets.userRoles }] as const;

	return (
		<div className='flex flex-col gap-2'>
			<div className='flex items-center justify-end gap-2'>
				<Input
					type='text'
					value={globalFilter}
					onChange={(e) => onGlobalFilterChange(e.target.value)}
					placeholder='Search chats...'
					className='h-8 text-sm max-w-sm'
				/>

				<DropdownMenu>
					<DropdownMenuTrigger asChild>
						<Button variant='ghost' size='sm' className={cn(userNameFilter.length > 0 && 'text-primary')}>
							<Users className='size-4 mr-1' />
							Users
							{userNameFilter.length > 0 && (
								<Badge variant='secondary' className='ml-1 h-4 px-1 text-xs'>
									{userNameFilter.length}
								</Badge>
							)}
						</Button>
					</DropdownMenuTrigger>
					<DropdownMenuContent align='end' className='w-48 max-h-64 overflow-y-auto'>
						{facets.userNames.length === 0 ? (
							<div className='px-2 py-3 text-xs text-center text-muted-foreground'>No users</div>
						) : (
							<>
								{userNameFilter.length > 0 && (
									<>
										<button
											className='w-full text-left px-2 py-1 text-xs text-muted-foreground hover:text-foreground'
											onClick={() => {
												onColumnFiltersChange(columnFilters.filter((f) => f.id !== 'userName'));
											}}
										>
											Clear ({userNameFilter.length})
										</button>
										<DropdownMenuSeparator />
									</>
								)}
								{facets.userNames.map((name) => (
									<DropdownMenuCheckboxItem
										key={name}
										checked={userNameFilter.includes(name)}
										onCheckedChange={(checked) => {
											const next = checked
												? [...userNameFilter, name]
												: userNameFilter.filter((v) => v !== name);
											const nextFilters = columnFilters.filter((f) => f.id !== 'userName');
											if (next.length) {
												nextFilters.push({ id: 'userName', value: next });
											}
											onColumnFiltersChange(nextFilters);
										}}
									>
										<span className='text-sm'>{name}</span>
									</DropdownMenuCheckboxItem>
								))}
							</>
						)}
					</DropdownMenuContent>
				</DropdownMenu>

				<DropdownMenu>
					<DropdownMenuTrigger asChild>
						<Button variant='ghost' size='sm' className={cn(hiddenCount > 0 && 'text-primary')}>
							<Columns2 className='size-4 mr-1' />
							Columns
							<Badge variant='secondary' className='ml-1 h-4 px-1 text-xs'>
								{visibleCount}
							</Badge>
						</Button>
					</DropdownMenuTrigger>
					<DropdownMenuContent align='end' className='w-48'>
						<div className='px-2 py-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide'>
							Visible columns
						</div>
						<DropdownMenuSeparator />
						{toggleableColumns.map((column) => (
							<DropdownMenuCheckboxItem
								key={column.id}
								checked={column.getIsVisible()}
								onCheckedChange={(value) => column.toggleVisibility(!!value)}
							>
								<span className='text-sm capitalize'>
									{typeof column.columnDef.header === 'string' ? column.columnDef.header : column.id}
								</span>
							</DropdownMenuCheckboxItem>
						))}
						{hiddenCount > 0 && (
							<>
								<DropdownMenuSeparator />
								<button
									className='w-full text-left px-2 py-1.5 text-xs text-muted-foreground hover:text-foreground'
									onClick={() => table.resetColumnVisibility()}
								>
									Show all
								</button>
							</>
						)}
					</DropdownMenuContent>
				</DropdownMenu>

				<DropdownMenu>
					<DropdownMenuTrigger asChild>
						<Button variant='ghost' size='sm' className={cn(activeFilters.length > 0 && 'text-primary')}>
							<Filter className='size-4 mr-1' />
							Filter
							{activeFilters.length > 0 && (
								<Badge variant='secondary' className='ml-1 h-4 px-1 text-xs'>
									{activeFilters.reduce((acc, f) => acc + (f.value as string[]).length, 0)}
								</Badge>
							)}
						</Button>
					</DropdownMenuTrigger>

					<DropdownMenuContent align='end' className='w-56'>
						<div className='px-2 py-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide'>
							Filter by
						</div>
						<DropdownMenuSeparator />

						{filterConfigs.map((cfg) => {
							const selected = (columnFilters.find((f) => f.id === cfg.id)?.value as string[]) ?? [];

							const toggleValue = (value: string, checked: boolean) => {
								const next = checked ? [...selected, value] : selected.filter((v) => v !== value);
								const nextFilters = columnFilters.filter((f) => f.id !== cfg.id);
								if (next.length) {
									nextFilters.push({ id: cfg.id, value: next });
								}
								onColumnFiltersChange(nextFilters);
							};

							return (
								<DropdownMenuSub key={cfg.id}>
									<DropdownMenuSubTrigger className='flex items-center justify-between'>
										<span className='capitalize'>{cfg.label}</span>
										{selected.length > 0 && (
											<Badge variant='secondary' className='ml-auto h-4 px-1 text-xs'>
												{selected.length}
											</Badge>
										)}
									</DropdownMenuSubTrigger>

									<DropdownMenuSubContent className='w-48 max-h-64 overflow-y-auto'>
										{cfg.values.length === 0 ? (
											<div className='px-2 py-3 text-xs text-center text-muted-foreground'>
												No values
											</div>
										) : (
											<>
												{selected.length > 0 && (
													<>
														<button
															className='w-full text-left px-2 py-1 text-xs text-muted-foreground hover:text-foreground'
															onClick={() => {
																const nextFilters = columnFilters.filter(
																	(f) => f.id !== cfg.id,
																);
																onColumnFiltersChange(nextFilters);
															}}
														>
															Clear ({selected.length})
														</button>
														<DropdownMenuSeparator />
													</>
												)}
												{cfg.values.map((value) => (
													<DropdownMenuCheckboxItem
														key={value}
														checked={selected.includes(value)}
														onCheckedChange={(checked) => toggleValue(value, checked)}
													>
														<span className='text-sm'>{value}</span>
													</DropdownMenuCheckboxItem>
												))}
											</>
										)}
									</DropdownMenuSubContent>
								</DropdownMenuSub>
							);
						})}

						{(activeFilters.length > 0 || globalFilter) && (
							<>
								<DropdownMenuSeparator />
								<button
									className='w-full text-left px-2 py-1.5 text-xs text-red-500 hover:text-red-600'
									onClick={clearAllFilters}
								>
									Clear all
								</button>
							</>
						)}
					</DropdownMenuContent>
				</DropdownMenu>
			</div>

			{(activeFilters.length > 0 || globalFilter) && (
				<div className='flex flex-wrap gap-1.5 items-center'>
					<span className='text-xs text-muted-foreground'>Active:</span>

					{globalFilter && (
						<Badge variant='secondary' className='flex items-center gap-1 pl-2 pr-1 py-0.5 text-xs'>
							<span className='text-muted-foreground'>search:</span>
							<span className='truncate max-w-[220px]'>{globalFilter}</span>
							<button
								onClick={() => onGlobalFilterChange('')}
								className='ml-0.5 rounded-full hover:bg-muted p-0.5'
							>
								<X className='size-2.5' />
							</button>
						</Badge>
					)}

					{activeFilters.flatMap((filter) =>
						(filter.value as string[]).map((val) => (
							<Badge
								key={`${filter.id}-${val}`}
								variant='secondary'
								className='flex items-center gap-1 pl-2 pr-1 py-0.5 text-xs'
							>
								<span className='text-muted-foreground capitalize'>{filter.id}:</span>
								{val}
								<button
									onClick={() => removeFilterValue(filter.id, val)}
									className='ml-0.5 rounded-full hover:bg-muted p-0.5'
								>
									<X className='size-2.5' />
								</button>
							</Badge>
						)),
					)}

					<button
						onClick={clearAllFilters}
						className='text-xs text-muted-foreground hover:text-foreground underline underline-offset-2'
					>
						Clear all
					</button>
				</div>
			)}
		</div>
	);
}
