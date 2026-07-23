import { CircleAlert, CircleHelp, Globe2, Lightbulb, Shield, ThumbsDown, ThumbsUp } from 'lucide-react';
import { differenceInDays, format, isToday, isYesterday } from 'date-fns';
import type { ColumnDef } from '@tanstack/react-table';

import type { ProjectChatListItem } from '@nao/shared/types';
import { Badge } from '@/components/ui/badge';
import McpIcon from '@/components/icons/model-context-protocol.svg';
import TeamsIcon from '@/components/icons/microsoft-teams.svg';
import SlackIcon from '@/components/icons/slack.svg';
import TelegramIcon from '@/components/icons/telegram.svg';
import WhatsAppIcon from '@/components/icons/whatsapp.svg';

const sourceConfig = {
	web: { label: 'Web', icon: <Globe2 className='size-3.5' /> },
	slack: { label: 'Slack', icon: <SlackIcon className='size-3.5' /> },
	teams: { label: 'Teams', icon: <TeamsIcon className='size-3.5' /> },
	telegram: { label: 'Telegram', icon: <TelegramIcon className='size-3.5' /> },
	whatsapp: { label: 'WhatsApp', icon: <WhatsAppIcon className='size-3.5' /> },
	admin: { label: 'Admin mode', icon: <Shield className='size-3.5' /> },
	mcp: { label: 'MCP', icon: <McpIcon className='size-3.5' /> },
	contextRecommendations: {
		label: 'Context recommendations',
		icon: <Lightbulb className='size-3.5' />,
	},
} as const;

export function getChatsReplayColumns(): ColumnDef<ProjectChatListItem>[] {
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
			accessorKey: 'title',
			header: 'Title',
			cell: ({ getValue }) => {
				const value = getValue<string>() ?? '';
				return (
					<span className='block truncate max-w-[280px]' title={value}>
						{value}
					</span>
				);
			},
		},
		{
			accessorKey: 'userName',
			header: 'User',
		},
		{
			accessorKey: 'source',
			header: 'Source',
			enableSorting: false,
			cell: ({ getValue }) => {
				const source = getValue<string | null>();
				if (!source) {
					return <span className='text-muted-foreground'>—</span>;
				}

				const config = sourceConfig[source as keyof typeof sourceConfig];
				return (
					<span className='flex items-center gap-1.5 text-xs text-muted-foreground'>
						<span className='opacity-60'>{config?.icon ?? <CircleHelp className='size-3.5' />}</span>
						{config?.label ?? source}
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
	];
}

export function formatLastUpdate(value: number): string {
	const date = new Date(value);
	if (isToday(date)) {
		return 'Today ' + format(date, 'HH:mm');
	}
	if (isYesterday(date)) {
		return 'Yesterday ' + format(date, 'HH:mm');
	}
	const daysAgo = differenceInDays(Date.now(), date);
	if (daysAgo >= 0 && daysAgo < 7) {
		return format(date, 'EEE HH:mm');
	}
	return format(date, 'dd/MM/yyyy');
}
