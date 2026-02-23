import { memo, useMemo, useRef } from 'react';
import { Pencil, Check, Copy } from 'lucide-react';
import type { UIMessage } from '@nao/backend/chat';
import { cn } from '@/lib/utils';
import { useAgentContext } from '@/contexts/agent.provider';
import { useCopyToClipboard } from '@/hooks/use-copy-to-clipboard';
import { messageEditStore, useIsEditingMessage } from '@/hooks/use-message-edit-store';
import { useClickOutside } from '@/hooks/use-click-outside';
import { ChatInputInline } from '@/components/chat-input';
import { getMessageText } from '@/lib/ai';
import { Button } from '@/components/ui/button';

export const UserMessage = memo(({ message }: { message: UIMessage }) => {
	const { isRunning, editMessage } = useAgentContext();
	const { isCopied, copy } = useCopyToClipboard();
	const isEditing = useIsEditingMessage(message.id);
	const editContainerRef = useRef<HTMLDivElement>(null);
	const text = useMemo(() => getMessageText(message), [message]);

	useClickOutside(
		{
			ref: editContainerRef,
			enabled: isEditing,
			onClickOutside: () => messageEditStore.setEditing(null),
		},
		[isEditing],
	);

	if (isEditing) {
		return (
			<div ref={editContainerRef}>
				<ChatInputInline
					initialText={text}
					className='p-0 **:data-[slot=input-group]:shadow-none!'
					onCancel={() => messageEditStore.setEditing(null)}
					onSubmitMessage={async ({ text: nextText }) => {
						messageEditStore.setEditing(null);
						await editMessage({ messageId: message.id, text: nextText });
					}}
				/>
			</div>
		);
	}

	return (
		<div className='group flex flex-col gap-2'>
			<div className={cn('rounded-2xl px-3 py-2 bg-card text-card-foreground ml-auto max-w-xl border')}>
				<span className='whitespace-pre-wrap wrap-break-word'>{text}</span>
			</div>

			<div
				className={cn(
					'ml-auto flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity duration-200',
					isRunning && 'group-last:opacity-0 invisible',
				)}
			>
				<Button variant='ghost-muted' size='icon-sm' onClick={() => messageEditStore.setEditing(message.id)}>
					<Pencil />
				</Button>
				<Button variant='ghost-muted' size='icon-sm' onClick={() => copy(getMessageText(message))}>
					{isCopied ? <Check className='size-4' /> : <Copy />}
				</Button>
			</div>
		</div>
	);
});
