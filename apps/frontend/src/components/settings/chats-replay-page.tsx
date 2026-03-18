import { useCallback, useMemo, useState } from 'react';

import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { getCoreRowModel, useReactTable } from '@tanstack/react-table';
import type { ColumnFiltersState, PaginationState, SortingState, VisibilityState } from '@tanstack/react-table';

import type { UpdatedAtFilter } from '@nao/shared';
import type { ProjectChatRow } from '@/components/settings/chats-replay-columns';
import { getChatsReplayColumns } from '@/components/settings/chats-replay-columns';
import { ChatsReplayPanel } from '@/components/settings/chats-replay-panel';
import { ChatsReplayTable } from '@/components/settings/chats-replay-table';
import { ChatsReplayToolbar } from '@/components/settings/chats-replay-toolbar';
import { SettingsCard } from '@/components/ui/settings-card';
import { cn } from '@/lib/utils';
import { trpc } from '@/main';

export function ChatsReplayPage() {
	const [sorting, setSorting] = useState<SortingState>([]);
	const [globalFilter, setGlobalFilter] = useState('');
	const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
	const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({
		userRole: false,
		title: false,
	});
	const [pagination, setPagination] = useState<PaginationState>({
		pageIndex: 0,
		pageSize: 30,
	});
	const [selectedChat, setSelectedChat] = useState<ProjectChatRow | null>(null);
	const [isPanelOpen, setIsPanelOpen] = useState(false);

	const openChatPanel = useCallback((chat: ProjectChatRow) => {
		setSelectedChat(chat);
		setIsPanelOpen(true);
	}, []);

	const closeChatPanel = useCallback(() => {
		setIsPanelOpen(false);
		setSelectedChat(null);
	}, []);

	const columns = useMemo(() => getChatsReplayColumns({ onOpenChat: openChatPanel }), [openChatPanel]);

	const queryInput = useMemo(() => {
		const filters = columnFilters
			.map((f) => ({ id: f.id, values: (f.value as string[]) ?? [] }))
			.filter(
				(f): f is { id: 'userName' | 'userRole' | 'toolState'; values: string[] } =>
					(f.id === 'userName' || f.id === 'userRole' || f.id === 'toolState') && f.values.length > 0,
			);
		const updatedAtFilter = columnFilters.find((f) => f.id === 'updatedAt')?.value as UpdatedAtFilter | undefined;
		const hasValidDateFilter =
			updatedAtFilter &&
			((updatedAtFilter.mode === 'single' && updatedAtFilter.value) ||
				(updatedAtFilter.mode === 'range' && updatedAtFilter.start && updatedAtFilter.end));
		return {
			page: pagination.pageIndex,
			pageSize: pagination.pageSize,
			search: globalFilter || undefined,
			filters: filters.length ? filters : undefined,
			updatedAtFilter: hasValidDateFilter ? updatedAtFilter : undefined,
			sorting: sorting.length ? sorting : undefined,
		};
	}, [columnFilters, globalFilter, pagination.pageIndex, pagination.pageSize, sorting]);

	const projectChatsQuery = useQuery({
		...trpc.project.getProjectChats.queryOptions(queryInput),
		placeholderData: keepPreviousData,
	});
	const chats = projectChatsQuery.data?.chats ?? [];
	const total = projectChatsQuery.data?.total ?? 0;
	const defaultToolStateFacet = { noToolsUsed: 0, toolsNoErrors: 0, toolsWithErrors: 0 };
	const facets = projectChatsQuery.data?.facets ?? {
		userNames: [],
		userNameCounts: {},
		userRoles: [],
		userRoleCounts: {},
		toolState: defaultToolStateFacet,
	};

	const table = useReactTable({
		data: chats,
		columns,
		state: { sorting, columnFilters, globalFilter, pagination, columnVisibility },
		onSortingChange: setSorting,
		onGlobalFilterChange: setGlobalFilter,
		onColumnFiltersChange: setColumnFilters,
		onColumnVisibilityChange: setColumnVisibility,
		onPaginationChange: setPagination,
		getCoreRowModel: getCoreRowModel(),
		manualPagination: true,
		manualSorting: true,
		manualFiltering: true,
		rowCount: total,
		pageCount: Math.ceil(total / pagination.pageSize),
	});

	return (
		<div className='flex w-full h-full min-h-0'>
			{!isPanelOpen ? (
				<div className={cn('w-full h-full min-w-0 min-h-0 flex flex-col transition-all duration-200 p-4')}>
					<div className='flex flex-col md:p-4 max-w-4xl'>
						<h2 className='text-foreground font-semibold text-xl'>Chats Replay</h2>
						<p className='text-muted-foreground text-sm'>
							Browse chats across the organization and replay them.
						</p>
					</div>
					<SettingsCard rootClassName='h-full min-h-0' className='flex-1 min-h-0 overflow-hidden'>
						<div className='flex flex-col gap-3 h-full min-h-0'>
							<ChatsReplayToolbar
								globalFilter={globalFilter}
								onGlobalFilterChange={setGlobalFilter}
								columnFilters={columnFilters}
								onColumnFiltersChange={setColumnFilters}
								facets={facets}
								table={table}
							/>

							<ChatsReplayTable table={table} />
						</div>
					</SettingsCard>
				</div>
			) : (
				<ChatsReplayPanel
					chatInfo={
						selectedChat
							? {
									chatId: selectedChat.id,
									userName: selectedChat.userName,
									updatedAt: selectedChat.updatedAt,
									feedbackCount: selectedChat.upvotes + selectedChat.downvotes,
									feedbackText: selectedChat.feedbackText,
									toolErrorCount: selectedChat.toolErrorCount,
								}
							: null
					}
					onClose={closeChatPanel}
				/>
			)}
		</div>
	);
}
