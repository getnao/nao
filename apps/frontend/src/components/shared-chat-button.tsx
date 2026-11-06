import { useQuery } from '@tanstack/react-query';
import { ChevronDown, MessageCircle } from 'lucide-react';

import { ChatListSection } from '@/components/chat-list-menu-section';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Spinner } from '@/components/ui/spinner';
import { cn } from '@/lib/utils';
import { trpc } from '@/main';
import { requestAsk } from '@/stores/ask-bar';

/** Continues the shared chat, with the user's quick questions about it a chevron away. */
export function SharedChatButton({
	shareId,
	label,
	isPending = false,
	onClick,
}: {
	shareId: string;
	label: string;
	isPending?: boolean;
	onClick: () => void;
}) {
	const quickQuestions = useQuery(trpc.chatFork.listSharedChatQuickQuestions.queryOptions({ shareId }));
	const chats = quickQuestions.data ?? [];
	const hasQuickQuestions = quickQuestions.isError || chats.length > 0;

	return (
		<div className='ml-auto flex h-7 shrink-0 items-center overflow-hidden rounded-full border bg-background'>
			<Button
				variant='ghost'
				size='sm'
				className={cn(
					'h-full gap-1.5 text-xs',
					hasQuickQuestions ? 'rounded-l-full rounded-r-none pr-2' : 'rounded-full',
				)}
				onClick={onClick}
				disabled={isPending}
			>
				{isPending ? (
					<Spinner className='size-3.5' />
				) : (
					<MessageCircle className='size-3.5 overflow-visible' strokeWidth={2.25} />
				)}
				<span>{label}</span>
			</Button>
			{hasQuickQuestions && (
				<DropdownMenu>
					<DropdownMenuTrigger asChild>
						<Button
							variant='ghost'
							size='sm'
							className='h-full rounded-l-none rounded-r-full border-l px-1.5'
							aria-label='Quick questions about this chat'
						>
							<ChevronDown className='size-3' strokeWidth={2.25} />
						</Button>
					</DropdownMenuTrigger>
					<DropdownMenuContent align='end' className='w-72'>
						<ChatListSection
							title='Quick questions'
							query={quickQuestions}
							chats={chats}
							hasSeparator={false}
							onOpen={(chatId) => requestAsk({ chatId })}
						/>
					</DropdownMenuContent>
				</DropdownMenu>
			)}
		</div>
	);
}
