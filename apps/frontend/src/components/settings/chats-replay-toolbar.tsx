import { Columns2, Filter, Users, X } from 'lucide-react';
import { ChatsReplayDateFilter } from './chats-replay-date-filter';
import type { ColumnFiltersState, Table } from '@tanstack/react-table';

import type { UpdatedAtFilter } from '@nao/shared';
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
	userNameCounts: Record<string, number>;
	userRoles: string[];
	userRoleCounts: Record<string, number>;
	toolState: {
		noToolsUsed: number;
		toolsNoErrors: number;
		toolsWithErrors: number;
	};
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
	const selectedUsers =
		(columnFilters.find((f) => f.id === 'userName')?.value as string[] | undefined) ?? facets.userNames;
	const someUsersUnchecked = selectedUsers.length < facets.userNames.length;

	const updatedAtFilter = columnFilters.find((f) => f.id === 'updatedAt')?.value as UpdatedAtFilter | undefined;

	const setUpdatedAtFilter = (value: UpdatedAtFilter | undefined) => {
		const next = value
			? [...columnFilters.filter((f) => f.id !== 'updatedAt'), { id: 'updatedAt', value }]
			: columnFilters.filter((f) => f.id !== 'updatedAt');
		onColumnFiltersChange(next);
	};

	const toolStateValues = [
		{ value: 'noToolsUsed', label: 'No tools used', count: facets.toolState.noToolsUsed },
		{ value: 'toolsNoErrors', label: 'Tools, no errors', count: facets.toolState.toolsNoErrors },
		{ value: 'toolsWithErrors', label: 'Tools with errors', count: facets.toolState.toolsWithErrors },
	].filter((o) => o.count > 0);

	const getAllValuesForFilterId = (id: string): string[] => {
		if (id === 'userName') {
			return facets.userNames;
		}
		if (id === 'userRole') {
			return facets.userRoles;
		}
		if (id === 'toolState') {
			return toolStateValues.map((o) => o.value);
		}
		return [];
	};

	const activeFilters = columnFilters.filter((f) => {
		if (f.id === 'updatedAt') {
			const v = f.value as UpdatedAtFilter | undefined;
			return !!(v && ((v.mode === 'single' && v.value) || (v.mode === 'range' && v.start && v.end)));
		}
		const v = (f.value as string[]) ?? [];
		const all = getAllValuesForFilterId(f.id);
		return v.length > 0 && v.length < all.length;
	});

	const setSelectedUsers = (next: string[]) => {
		const nextFilters = columnFilters.filter((f) => f.id !== 'userName');
		if (next.length > 0 && next.length < facets.userNames.length) {
			nextFilters.push({ id: 'userName', value: next });
		}
		onColumnFiltersChange(nextFilters);
	};

	const removeFilterValue = (columnId: string, value: string) => {
		onColumnFiltersChange(
			columnFilters
				.map((f) => {
					if (f.id !== columnId) {
						return f;
					}
					const current = (f.value as string[]) ?? [];
					const next = current.filter((v) => v !== value);
					return { ...f, value: next };
				})
				.filter((f) => {
					const v = f.value as string[];
					const all = getAllValuesForFilterId(f.id);
					return v.length > 0 && v.length < all.length;
				}),
		);
	};

	const clearAllFilters = () => {
		onColumnFiltersChange([]);
		onGlobalFilterChange('');
	};

	const removeUpdatedAtFilter = () => {
		onColumnFiltersChange(columnFilters.filter((f) => f.id !== 'updatedAt'));
	};

	const toggleableColumns = table.getAllLeafColumns().filter((col) => col.getCanHide());
	const visibleCount = toggleableColumns.filter((col) => col.getIsVisible()).length;
	const hiddenCount = toggleableColumns.length - visibleCount;

	const filterConfigs = [
		{
			id: 'userRole',
			label: 'Role',
			values: facets.userRoles,
			valueCounts: facets.userRoles.reduce<Record<string, number>>((acc, role) => {
				acc[role] = facets.userRoleCounts?.[role] ?? 0;
				return acc;
			}, {}),
		},
		{
			id: 'toolState',
			label: 'Tool State',
			values: toolStateValues.map((o) => o.value),
			valueLabels: Object.fromEntries(toolStateValues.map((o) => [o.value, o.label])),
			valueCounts: Object.fromEntries(toolStateValues.map((o) => [o.value, o.count])),
		},
	] as const;

	const totalFilterSelectedCount = filterConfigs.reduce((acc, cfg) => {
		const selected = (columnFilters.find((f) => f.id === cfg.id)?.value as string[] | undefined) ?? cfg.values;
		return acc + selected.length;
	}, 0);

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

				<ChatsReplayDateFilter value={updatedAtFilter} onChange={setUpdatedAtFilter} />

				<DropdownMenu>
					<DropdownMenuTrigger asChild>
						<Button variant='ghost' size='sm' className={cn(someUsersUnchecked && 'text-primary')}>
							<Users className='size-4 mr-1' />
							Users
							<Badge variant='secondary' className='ml-1 h-4 px-1 text-xs'>
								{selectedUsers.length}
							</Badge>
						</Button>
					</DropdownMenuTrigger>
					<DropdownMenuContent align='end' className='w-48 max-h-64 overflow-y-auto'>
						<div className='px-2 py-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide'>
							Users
						</div>
						<DropdownMenuSeparator />
						{facets.userNames.length === 0 ? (
							<div className='px-2 py-3 text-xs text-center text-muted-foreground'>No users</div>
						) : (
							<>
								{facets.userNames.map((name) => (
									<DropdownMenuCheckboxItem
										key={name}
										checked={selectedUsers.includes(name)}
										onCheckedChange={(checked) => {
											const next = checked
												? [...selectedUsers, name]
												: selectedUsers.filter((v) => v !== name);
											setSelectedUsers(next);
										}}
									>
										<div className='flex w-full items-center justify-between'>
											<span className='text-sm'>{name}</span>
											{typeof facets.userNameCounts?.[name] === 'number' &&
												facets.userNameCounts[name] > 0 && (
													<Badge variant='secondary' className='ml-2 h-4 px-1 text-xs'>
														{facets.userNameCounts[name]}
													</Badge>
												)}
										</div>
									</DropdownMenuCheckboxItem>
								))}
								{someUsersUnchecked && (
									<>
										<DropdownMenuSeparator />
										<button
											className='w-full text-left px-2 py-1.5 text-xs text-muted-foreground hover:text-foreground'
											onClick={() => setSelectedUsers(facets.userNames)}
										>
											Show all
										</button>
									</>
								)}
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
							<Badge variant='secondary' className='ml-1 h-4 px-1 text-xs'>
								{totalFilterSelectedCount}
							</Badge>
						</Button>
					</DropdownMenuTrigger>

					<DropdownMenuContent align='end' className='w-56'>
						<div className='px-2 py-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide'>
							Filter by
						</div>
						<DropdownMenuSeparator />

						{filterConfigs.map((cfg) => {
							const selected =
								(columnFilters.find((f) => f.id === cfg.id)?.value as string[] | undefined) ??
								cfg.values;
							const someUnchecked = selected.length < cfg.values.length;

							const toggleValue = (value: string, checked: boolean) => {
								const next = checked ? [...selected, value] : selected.filter((v) => v !== value);
								const nextFilters = columnFilters.filter((f) => f.id !== cfg.id);
								if (next.length > 0 && next.length < cfg.values.length) {
									nextFilters.push({ id: cfg.id, value: next });
								}
								onColumnFiltersChange(nextFilters);
							};

							const showAll = () => {
								onColumnFiltersChange(columnFilters.filter((f) => f.id !== cfg.id));
							};

							return (
								<DropdownMenuSub key={cfg.id}>
									<DropdownMenuSubTrigger className='flex items-center justify-between'>
										<span className='capitalize'>{cfg.label}</span>
										{someUnchecked && (
											<Badge variant='secondary' className='ml-auto h-4 px-1 text-xs'>
												{selected.length}
											</Badge>
										)}
									</DropdownMenuSubTrigger>

									<DropdownMenuSubContent className='w-48 max-h-64 overflow-y-auto'>
										<div className='px-2 py-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide'>
											{cfg.label}
										</div>
										<DropdownMenuSeparator />
										{cfg.values.length === 0 ? (
											<div className='px-2 py-3 text-xs text-center text-muted-foreground'>
												No values
											</div>
										) : (
											<>
												{cfg.values.map((value) => (
													<DropdownMenuCheckboxItem
														key={value}
														checked={selected.includes(value)}
														onCheckedChange={(checked) => toggleValue(value, checked)}
													>
														<div className='flex w-full items-center justify-between'>
															<span className='text-sm'>
																{cfg.id === 'toolState' && cfg.valueLabels?.[value]
																	? cfg.valueLabels[value]
																	: value}
															</span>
															{typeof cfg.valueCounts?.[value] === 'number' &&
																cfg.valueCounts[value] > 0 && (
																	<Badge
																		variant='secondary'
																		className='ml-2 h-4 px-1 text-xs'
																	>
																		{cfg.valueCounts[value]}
																	</Badge>
																)}
														</div>
													</DropdownMenuCheckboxItem>
												))}
												{someUnchecked && (
													<>
														<DropdownMenuSeparator />
														<button
															className='w-full text-left px-2 py-1.5 text-xs text-muted-foreground hover:text-foreground'
															onClick={showAll}
														>
															Show all
														</button>
													</>
												)}
											</>
										)}
									</DropdownMenuSubContent>
								</DropdownMenuSub>
							);
						})}

						{(activeFilters.length > 0 || globalFilter || updatedAtFilter) && (
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

			{(activeFilters.length > 0 || globalFilter || updatedAtFilter) && (
				<div className='flex flex-wrap gap-1.5 items-center'>
					<span className='text-xs text-muted-foreground'>Active:</span>

					{updatedAtFilter &&
						((updatedAtFilter.mode === 'single' && updatedAtFilter.value) ||
							(updatedAtFilter.mode === 'range' && updatedAtFilter.start && updatedAtFilter.end)) && (
							<Badge variant='secondary' className='flex items-center gap-1 pl-2 pr-1 py-0.5 text-xs'>
								<span className='text-muted-foreground'>Last update:</span>
								<span>
									{updatedAtFilter.mode === 'single'
										? updatedAtFilter.value
										: `${updatedAtFilter.start} – ${updatedAtFilter.end}`}
								</span>
								<button
									onClick={removeUpdatedAtFilter}
									className='ml-0.5 rounded-full hover:bg-muted p-0.5'
								>
									<X className='size-2.5' />
								</button>
							</Badge>
						)}

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

					{activeFilters
						.filter((f) => f.id !== 'updatedAt')
						.flatMap((filter) => {
							const cfg = filterConfigs.find((c) => c.id === filter.id);
							const getLabel = (val: string) =>
								cfg && cfg.id === 'toolState' && cfg.valueLabels?.[val] ? cfg.valueLabels[val] : val;
							return (filter.value as string[]).map((val) => (
								<Badge
									key={`${filter.id}-${val}`}
									variant='secondary'
									className='flex items-center gap-1 pl-2 pr-1 py-0.5 text-xs'
								>
									<span className='text-muted-foreground capitalize'>{filter.id}:</span>
									{getLabel(val)}
									<button
										onClick={() => removeFilterValue(filter.id, val)}
										className='ml-0.5 rounded-full hover:bg-muted p-0.5'
									>
										<X className='size-2.5' />
									</button>
								</Badge>
							));
						})}

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
