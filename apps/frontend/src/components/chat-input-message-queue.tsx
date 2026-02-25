import { ArrowRight, X } from 'lucide-react';
import { Button } from './ui/button';
import { useMessageQueueStore } from '@/hooks/use-message-queue-store';
import { useChatId } from '@/hooks/use-chat-id';
import { cn } from '@/lib/utils';
import { messageQueueStore } from '@/stores/chat-message-queue';

export const ChatInputMessageQueue = () => {
	const chatId = useChatId();
	const { queuedMessages } = useMessageQueueStore(chatId);

	if (!queuedMessages.length) {
		return null;
	}

	return (
		<div className='flex flex-col gap-0 px-3 py-2 pb-5.5 w-full mx-auto border border-input/50 rounded-2xl rounded-b-none -mb-4 bg-muted/50'>
			{queuedMessages.map((qm, idx) => (
				<div
					key={qm.id}
					className={cn(
						'flex w-full items-center gap-2 text-sm [&_>_svg]:shrink-0 group cursor-pointer h-7',
						idx !== 0 && '[&_span]:text-muted-foreground/75 [&>*:first-child]:text-muted-foreground/50',
					)}
				>
					<ArrowRight className={cn('size-3.5 group-hover:hidden flex', idx !== 0 && '')} />

					<Button
						variant='ghost-muted'
						size='icon-xs'
						className='group-hover:flex hidden -m-1.25 hover:text-destructive'
						onClick={() => messageQueueStore.remove(chatId, qm.id)}
					>
						<X className='size-3.5 group-hover:flex hidden' />
					</Button>

					<span className='truncate'>{qm.text}</span>
				</div>
			))}
		</div>
	);
};
