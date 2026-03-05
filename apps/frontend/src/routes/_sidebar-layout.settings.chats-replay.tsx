import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { ChevronDown } from 'lucide-react';
import {
	flexRender,
	getCoreRowModel,
	getFilteredRowModel,
	getPaginationRowModel,
	getSortedRowModel,
	useReactTable,
} from '@tanstack/react-table';
import type { ColumnDef, PaginationState, SortingState } from '@tanstack/react-table';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Input } from '@/components/ui/input';
import { DataTablePagination } from '@/components/data-table-pagination';
import { SettingsCard } from '@/components/ui/settings-card';
import { trpc } from '@/main';
import { cn } from '@/lib/utils';

type OrgChatRow = {
	id: string;
	createdAt: number;
	updatedAt: number;
	title: string;
	warningSummary: string;
	userName: string;
	userRole: string;
};

export const Route = createFileRoute('/_sidebar-layout/settings/chats-replay')({
	component: RouteComponent,
});

function RouteComponent() {
	const columns = useMemo<ColumnDef<OrgChatRow>[]>(
		() => [
			{
				accessorKey: 'createdAt',
				header: 'Date',
				cell: ({ getValue }) => {
					const value = getValue<number>();
					if (!value) {
						return '';
					}
					// Formatage : jour/mois/année heure:minute
					const date = new Date(value);
					return date.toLocaleString('fr-FR', {
						year: 'numeric',
						month: '2-digit',
						day: '2-digit',
						hour: '2-digit',
						minute: '2-digit',
					});
				},
			},
			{ accessorKey: 'userName', header: 'User' },
			{ accessorKey: 'userRole', header: 'Role' },
			{
				accessorKey: 'title',
				header: 'Title',
				cell: ({ getValue }) => {
					const value = getValue<string>() ?? '';
					return (
						<span className='block truncate max-w-[200px]' title={value}>
							{value}
						</span>
					);
				},
			},
			{
				accessorKey: 'updatedAt',
				header: 'Updated',
				cell: ({ getValue }) => {
					const value = getValue<number>();
					if (!value) {
						return '';
					}
					const date = new Date(value);
					return date.toLocaleString('fr-FR', {
						year: 'numeric',
						month: '2-digit',
						day: '2-digit',
						hour: '2-digit',
						minute: '2-digit',
					});
				},
			},
			{ accessorKey: 'warningSummary', header: 'Warnings' },
		],
		[],
	);

	const orgChats = useQuery(trpc.organization.getOrgChats.queryOptions(undefined));

	const chats = useMemo<OrgChatRow[]>(() => {
		return (orgChats.data?.chats ?? []).map((chat) => ({
			id: chat.id,
			title: chat.title,
			createdAt: chat.createdAt,
			updatedAt: chat.updatedAt,
			warningSummary: chat.warningSummary,
			userName: chat.userName,
			userRole: chat.userRole,
		}));
	}, [orgChats.data?.chats]);

	const [sorting, setSorting] = useState<SortingState>([]);
	const [globalFilter, setGlobalFilter] = useState('');
	const [pagination, setPagination] = useState<PaginationState>({
		pageIndex: 0,
		pageSize: 30,
	});

	const table = useReactTable({
		data: chats,
		columns,
		state: { sorting, globalFilter, pagination },
		onSortingChange: setSorting,
		onGlobalFilterChange: setGlobalFilter,
		onPaginationChange: setPagination,
		getCoreRowModel: getCoreRowModel(),
		getSortedRowModel: getSortedRowModel(),
		getFilteredRowModel: getFilteredRowModel(),
		getPaginationRowModel: getPaginationRowModel(),
	});

	return (
		<SettingsCard title='Chats Replay' description='Browse chats across the organization and replay them.'>
			<div className='flex items-center'>
				<Input
					type='text'
					value={globalFilter}
					onChange={(e) => setGlobalFilter(e.target.value)}
					placeholder='Search chats...'
					className='h-8 text-sm max-w-sm'
				/>
			</div>

			<Table>
				<TableHeader>
					{table.getHeaderGroups().map((headerGroup) => (
						<TableRow key={headerGroup.id}>
							{headerGroup.headers.map((header) => {
								return (
									<TableHead
										key={header.id}
										onClick={header.column.getToggleSortingHandler()}
										className='cursor-pointer select-none'
									>
										<div className='flex items-center space-x-1'>
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
								);
							})}
						</TableRow>
					))}
				</TableHeader>

				<TableBody>
					{table.getRowModel().rows.map((row) => (
						<TableRow key={row.id}>
							{row.getVisibleCells().map((cell) => (
								<TableCell key={cell.id}>
									{flexRender(cell.column.columnDef.cell, cell.getContext())}
								</TableCell>
							))}
						</TableRow>
					))}
					<TableRow>
						<TableCell colSpan={columns.length}>
							<DataTablePagination table={table} />
						</TableCell>
					</TableRow>
				</TableBody>
			</Table>
		</SettingsCard>
	);
}
