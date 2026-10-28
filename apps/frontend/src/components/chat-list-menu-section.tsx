import { useState } from 'react';
import { ChevronDown, RotateCw } from 'lucide-react';

import { DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator } from '@/components/ui/dropdown-menu';
import { getTimeAgo } from '@/lib/time-ago';

const MAX_COLLAPSED_CHATS = 5;

export function ChatListSection({
	title,
	query,
	chats,
	hasSeparator = true,
	onOpen,
}: {
	title: string;
	query: { isError: boolean; refetch: () => unknown };
	chats: { chatId: string; title: string; updatedAt: string | Date }[];
	hasSeparator?: boolean;
	onOpen: (chatId: string) => void;
}) {
	const [isExpanded, setIsExpanded] = useState(false);

	if (!query.isError && chats.length === 0) {
		return null;
	}

	const listedChats = isExpanded ? chats : chats.slice(0, MAX_COLLAPSED_CHATS);
	const hiddenCount = chats.length - listedChats.length;

	return (
		<>
			{hasSeparator && <DropdownMenuSeparator />}
			<DropdownMenuLabel className='flex items-center justify-between pt-1.5 text-[11px] uppercase tracking-wide'>
				<span>{title}</span>
				<span className='tabular-nums'>{chats.length}</span>
			</DropdownMenuLabel>
			{query.isError && (
				<DropdownMenuItem
					onSelect={(event) => {
						event.preventDefault();
						query.refetch();
					}}
				>
					<RotateCw strokeWidth={2.25} />
					<span>Couldn't load, retry</span>
				</DropdownMenuItem>
			)}
			{listedChats.map((chat) => (
				<DropdownMenuItem key={chat.chatId} onSelect={() => onOpen(chat.chatId)} className='gap-3 pr-2'>
					<span className='min-w-0 flex-1 truncate font-normal'>{chat.title}</span>
					<span className='shrink-0 font-normal text-muted-foreground tabular-nums'>
						{getTimeAgo(new Date(chat.updatedAt).getTime()).humanReadable}
					</span>
				</DropdownMenuItem>
			))}
			{hiddenCount > 0 && (
				<DropdownMenuItem
					onSelect={(event) => {
						event.preventDefault();
						setIsExpanded(true);
					}}
					className='font-normal text-muted-foreground'
				>
					<ChevronDown strokeWidth={2.25} />
					<span>Show {hiddenCount} older</span>
				</DropdownMenuItem>
			)}
		</>
	);
}
