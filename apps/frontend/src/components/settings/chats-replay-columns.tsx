import { CircleAlert, Eye, ThumbsDown, ThumbsUp } from 'lucide-react';
import { differenceInDays, format, isToday, isYesterday } from 'date-fns';
import type { ColumnDef } from '@tanstack/react-table';

import type { UserRole } from '@nao/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

export type ProjectChatRow = {
	id: string;
	updatedAt: number;
	userId: string;
	userName: string;
	userRole: UserRole | null;
	title: string;
	numberOfMessages: number;
	totalTokens: number;
	feedbackText: string;
	downvotes: number;
	upvotes: number;
	toolErrorCount: number;
	toolAvailableCount: number;
};

export function getChatsReplayColumns(args: {
	onOpenChat: (chat: ProjectChatRow) => void;
}): ColumnDef<ProjectChatRow>[] {
	const { onOpenChat } = args;

	return [
		{
			accessorKey: 'updatedAt',
			header: 'Last update',
			cell: ({ getValue }) => {
				const value = getValue<number>();
				const formatted = value ? formatLastUpdate(value) : '—';
				return <span className='text-muted-foreground text-xs whitespace-nowrap'>{formatted}</span>;
			},
		},
		{
			accessorKey: 'userName',
			header: 'User',
		},
		{
			accessorKey: 'userRole',
			header: 'Role',
		},
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
		{ accessorKey: 'numberOfMessages', header: 'Messages' },
		{ accessorKey: 'totalTokens', header: 'Tokens' },
		{
			id: 'feedback',
			accessorFn: (row) => ({
				up: row.upvotes ?? 0,
				down: row.downvotes ?? 0,
			}),
			header: 'Votes',
			cell: ({ row }) => {
				const up = row.original.upvotes ?? 0;
				const down = row.original.downvotes ?? 0;
				const total = up + down;
				const hasErrors = down > 0;

				return (
					<div className='flex items-center gap-2'>
						{total > 0 ? (
							hasErrors ? (
								<ThumbsDown className='size-4 text-red-500' />
							) : (
								<ThumbsUp className='size-4 text-green-500' />
							)
						) : null}
						{total > 0 && (
							<Badge variant={hasErrors ? 'destructive' : 'secondary'} className='h-4 px-1.5 text-xs'>
								{down}/{total}
							</Badge>
						)}
					</div>
				);
			},
		},
		{
			id: 'toolState',
			header: 'Tool State',
			accessorFn: (row) => ({
				errors: row.toolErrorCount ?? 0,
				available: row.toolAvailableCount ?? 0,
			}),
			cell: ({ row }) => {
				const errors = row.original.toolErrorCount ?? 0;
				const available = row.original.toolAvailableCount ?? 0;
				if (errors + available === 0) {
					return null;
				}
				return (
					<div className='flex items-center gap-1'>
						{errors > 0 && <CircleAlert className='size-3.5 text-destructive' />}
						<Badge variant={errors > 0 ? 'destructive' : 'secondary'} className='h-4 px-1.5 text-xs'>
							{errors}/{errors + available}
						</Badge>
					</div>
				);
			},
		},
		{
			id: 'actions',
			header: '',
			enableHiding: false,
			cell: ({ row }) => {
				const chat = row.original;
				return (
					<Button size='sm' variant='outline' onClick={() => onOpenChat(chat)}>
						<Eye className='size-4' />
					</Button>
				);
			},
		},
	];
}

function formatLastUpdate(value: number): string {
	const date = new Date(value);
	if (isToday(date)) {
		return 'Today ' + format(date, 'HH:mm');
	}
	if (isYesterday(date)) {
		return 'Yest ' + format(date, 'HH:mm');
	}
	const daysAgo = differenceInDays(Date.now(), date);
	if (daysAgo >= 0 && daysAgo < 7) {
		return format(date, 'EEE HH:mm');
	}
	return format(date, 'dd/MM/yyyy');
}
