import { useState } from 'react';
import { ChevronDown, CornerDownLeft, Pencil, ArrowUpToLine, Trash2 } from 'lucide-react';
import { Button } from './ui/button';
import { useMessageQueueStore } from '@/hooks/use-message-queue-store';
import { useChatId } from '@/hooks/use-chat-id';
import { cn } from '@/lib/utils';
import { messageQueueStore } from '@/stores/chat-message-queue';

interface ChatInputMessageQueueProps {
	onEditMessage?: (text: string) => void;
	onSubmitNow?: (messageId: string) => Promise<void>;
}

export const ChatInputMessageQueue = ({ onEditMessage, onSubmitNow }: ChatInputMessageQueueProps) => {
	const chatId = useChatId();
	const { queuedMessages } = useMessageQueueStore(chatId);
	const [isExpanded, setIsExpanded] = useState(true);

	if (!queuedMessages.length) {
		return null;
	}

	return (
		<div className='flex flex-col w-full mx-auto border border-input/50 rounded-2xl rounded-b-none -mb-4 pb-5 bg-muted/50 overflow-hidden'>
			<button
				type='button'
				onClick={() => setIsExpanded(!isExpanded)}
				className='flex items-center gap-1.5 px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors cursor-pointer select-none'
			>
				<ChevronDown className={cn('size-3 transition-transform duration-200', !isExpanded && '-rotate-90')} />
				<span>{queuedMessages.length} Queued</span>
			</button>

			{isExpanded && (
				<div className='flex flex-col px-3'>
					{queuedMessages.map((qm, idx) => (
						<QueuedMessageRow
							key={qm.id}
							chatId={chatId}
							messageId={qm.id}
							text={qm.text}
							isFirst={idx === 0}
							showPromote={queuedMessages.length > 1}
							onEdit={onEditMessage}
							onSubmitNow={onSubmitNow}
						/>
					))}
				</div>
			)}
		</div>
	);
};

function QueuedMessageRow({
	chatId,
	messageId,
	text,
	isFirst,
	showPromote,
	onEdit,
	onSubmitNow,
}: {
	chatId: string | undefined;
	messageId: string;
	text: string;
	isFirst: boolean;
	showPromote: boolean;
	onEdit?: (text: string) => void;
	onSubmitNow?: (messageId: string) => Promise<void>;
}) {
	return (
		<div className={cn('flex w-full items-center gap-2 text-sm group h-8', !isFirst && 'text-muted-foreground/75')}>
			<span className='truncate flex-1 min-w-0'>{text}</span>

			<div className='flex items-center shrink-0'>
				<button
					type='button'
					onClick={() => onSubmitNow?.(messageId)}
					className='group-hover:hidden flex items-center gap-1 text-xs text-muted-foreground/50 hover:text-muted-foreground transition-colors cursor-pointer'
				>
					<CornerDownLeft className='size-3' />
					<span>to submit</span>
				</button>

				<div className='hidden group-hover:flex items-center'>
					<Button
						variant='ghost-muted'
						size='icon-xs'
						type='button'
						onClick={() => {
							messageQueueStore.remove(chatId, messageId);
							onEdit?.(text);
						}}
					>
						<Pencil className='size-3' />
					</Button>
					{showPromote && !isFirst && (
						<Button
							variant='ghost-muted'
							size='icon-xs'
							type='button'
							onClick={() => messageQueueStore.promoteToFront(chatId, messageId)}
						>
							<ArrowUpToLine className='size-3' />
						</Button>
					)}
					<Button
						variant='ghost-muted'
						size='icon-xs'
						type='button'
						className='hover:text-destructive'
						onClick={() => messageQueueStore.remove(chatId, messageId)}
					>
						<Trash2 className='size-3' />
					</Button>
				</div>
			</div>
		</div>
	);
}
