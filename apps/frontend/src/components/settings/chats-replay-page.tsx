import { useEffect, useMemo, useState } from 'react';

import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { getCoreRowModel, useReactTable } from '@tanstack/react-table';
import type { PaginationState, SortingState } from '@tanstack/react-table';

import type { UsageSource } from '@nao/backend/usage';
import type { ChatReplayFeedbackState, ChatReplayToolState } from '@nao/shared/types';
import { getChatsReplayColumns } from '@/components/settings/chats-replay-columns';
import { ChatsReplayTable } from '@/components/settings/chats-replay-table';
import { trpc } from '@/main';

type ChatsReplayPageProps = {
	selectedUserNames: string[] | undefined;
	selectedFeedbackStates: ChatReplayFeedbackState[] | undefined;
	selectedToolStates: ChatReplayToolState[] | undefined;
	selectedSources: UsageSource[] | undefined;
	onOpenChat: (chatId: string) => void;
};

type ProjectChatsFilter = {
	id: 'userName' | 'feedback' | 'toolState' | 'source';
	values: string[];
};

export function ChatsReplayPage({
	selectedUserNames,
	selectedFeedbackStates,
	selectedToolStates,
	selectedSources,
	onOpenChat,
}: ChatsReplayPageProps) {
	const [sorting, setSorting] = useState<SortingState>([]);
	const [pagination, setPagination] = useState<PaginationState>({
		pageIndex: 0,
		pageSize: 30,
	});
	const columns = useMemo(() => getChatsReplayColumns(), []);

	useEffect(() => {
		setPagination((current) => ({ ...current, pageIndex: 0 }));
	}, [selectedFeedbackStates, selectedSources, selectedToolStates, selectedUserNames]);

	const queryInput = useMemo(() => {
		const filters: ProjectChatsFilter[] = [];
		if (selectedUserNames?.length) {
			filters.push({ id: 'userName', values: selectedUserNames });
		}
		if (selectedFeedbackStates?.length) {
			filters.push({ id: 'feedback', values: selectedFeedbackStates });
		}
		if (selectedToolStates?.length) {
			filters.push({ id: 'toolState', values: selectedToolStates });
		}
		if (selectedSources?.length) {
			filters.push({ id: 'source', values: selectedSources });
		}

		return {
			page: pagination.pageIndex,
			pageSize: pagination.pageSize,
			filters: filters.length ? filters : undefined,
			sorting: sorting.length ? sorting : undefined,
		};
	}, [
		pagination.pageIndex,
		pagination.pageSize,
		selectedFeedbackStates,
		selectedSources,
		selectedToolStates,
		selectedUserNames,
		sorting,
	]);

	const projectChatsQuery = useQuery({
		...trpc.project.getProjectChats.queryOptions(queryInput),
		placeholderData: keepPreviousData,
	});
	const chats = projectChatsQuery.data?.chats ?? [];
	const total = projectChatsQuery.data?.total ?? 0;

	const table = useReactTable({
		data: chats,
		columns,
		state: { sorting, pagination },
		onSortingChange: setSorting,
		onPaginationChange: setPagination,
		getCoreRowModel: getCoreRowModel(),
		manualPagination: true,
		manualSorting: true,
		rowCount: total,
		pageCount: Math.ceil(total / pagination.pageSize),
	});

	return (
		<div className='flex h-full flex-1 w-full min-h-0 overflow-hidden'>
			<div className='w-full h-full flex-1 min-w-0 min-h-0 flex flex-col overflow-hidden'>
				<ChatsReplayTable table={table} onRowClick={(chat) => onOpenChat(chat.id)} />
			</div>
		</div>
	);
}
