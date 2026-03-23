import { memo, useMemo, useRef } from 'react';
import { Pencil, Check, Copy, Table } from 'lucide-react';
import { Message } from 'prompt-mentions';
import { useQuery } from '@tanstack/react-query';
import type { UIMessage } from '@nao/backend/chat';
import type { MessageMentionConfig, MentionOption, PromptTheme } from 'prompt-mentions';
import { cn } from '@/lib/utils';
import { useAgentContext } from '@/contexts/agent.provider';
import { useCopyToClipboard } from '@/hooks/use-copy-to-clipboard';
import { useIsEditingMessage } from '@/hooks/use-is-editing-message-store';
import { useClickOutside } from '@/hooks/use-click-outside';
import { ChatInputInline } from '@/components/chat-input';
import { getMessageText } from '@/lib/ai';
import { Button } from '@/components/ui/button';
import { editedMessageIdStore } from '@/stores/chat-edited-message';
import { trpc } from '@/main';
import { STORY_MENTION_ID } from '@/components/chat-input-prompt';
import StoryIcon from '@/components/ui/story-icon';
import SlackIcon from '@/components/icons/slack.svg';
import TeamsIcon from '@/components/icons/microsoft-teams.svg';
import TelegramIcon from '@/components/icons/telegram.svg';

const messageTheme: PromptTheme = {
	backgroundColor: 'transparent',
	color: 'var(--color-foreground)',
	fontSize: '16px',
	fontFamily: 'inherit',
	borderColor: 'transparent',
	focusBorderColor: 'transparent',
	focusBoxShadow: 'none',
	padding: '0',
	minHeight: 'auto',
	pill: {
		backgroundColor: 'var(--accent)',
		color: 'var(--accent-foreground)',
		padding: 'calc(var(--spacing) * 0.4) calc(var(--spacing) * 1.2)',
		borderRadius: 'var(--radius-sm)',
	},
};

const tableIcon = <Table className='size-4' />;

function useMentionConfigs(): MessageMentionConfig[] {
	const { data: skills } = useQuery(trpc.skill.list.queryOptions());
	const { data: databaseObjects } = useQuery(trpc.project.getDatabaseObjects.queryOptions());

	return useMemo(() => {
		const dbOptions: MentionOption[] = (databaseObjects ?? []).map((obj) => ({
			id: obj.fqdn,
			label: obj.table,
			icon: tableIcon,
		}));

		const skillOptions: MentionOption[] = (skills ?? []).map((skill) => ({
			id: skill.name,
			label: skill.name,
		}));

		const storyOptions: MentionOption[] = [
			{ id: STORY_MENTION_ID, label: 'Story mode', icon: <StoryIcon className='size-4' /> },
		];

		return [
			{ trigger: '@', options: dbOptions },
			{ trigger: '/', options: skillOptions, showTrigger: true },
			{ trigger: '#', options: storyOptions },
		];
	}, [databaseObjects, skills]);
}

export const UserMessageBubble = memo(({ message }: { message: UIMessage }) => {
	const text = useMemo(() => getMessageText(message), [message]);
	const mentionConfigs = useMentionConfigs();

	return (
		<div className='rounded-2xl px-3 py-2 bg-card text-card-foreground ml-auto max-w-xl'>
			{message.source === 'slack' && (
				<span className='flex items-center justify-end gap-1 text-xs text-muted-foreground mb-2'>
					<SlackIcon className='size-3.5' />
					sent in Slack
				</span>
			)}
			{message.source === 'teams' && (
				<span className='flex items-center justify-end gap-1 text-xs text-muted-foreground mb-2'>
					<TeamsIcon className='size-4' />
					sent in Teams
				</span>
			)}
			{message.source === 'telegram' && (
				<span className='flex items-center justify-end gap-1 text-xs text-muted-foreground mb-2'>
					<TelegramIcon className='size-4' />
					sent in Telegram
				</span>
			)}
			<Message
				value={text}
				mentionConfigs={mentionConfigs}
				theme={messageTheme}
				className='flex items-center justify-end'
			/>
		</div>
	);
});

export const UserMessage = memo(({ message }: { message: UIMessage }) => {
	const { isRunning, editMessage } = useAgentContext();
	const { isCopied, copy } = useCopyToClipboard();
	const isEditing = useIsEditingMessage(message.id);
	const editContainerRef = useRef<HTMLDivElement>(null);
	const text = useMemo(() => getMessageText(message), [message]);

	useClickOutside(
		{
			containerRef: editContainerRef,
			enabled: isEditing,
			onClickOutside: () => editedMessageIdStore.setEditingId(undefined),
		},
		[isEditing],
	);

	if (isEditing) {
		return (
			<div ref={editContainerRef}>
				<ChatInputInline
					initialText={text}
					className='p-0 **:data-[slot=input-group]:shadow-none!'
					onCancel={() => editedMessageIdStore.setEditingId(undefined)}
					onSubmitMessage={async ({ text: nextText }) => {
						editedMessageIdStore.setEditingId(undefined);
						await editMessage({ messageId: message.id, text: nextText });
					}}
				/>
			</div>
		);
	}

	return (
		<div className='group flex flex-col gap-2 items-end w-full'>
			<UserMessageBubble message={message} />

			<div className='flex items-center gap-2'>
				<div
					className={cn(
						'flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity duration-200',
						isRunning && 'group-last:opacity-0 invisible',
					)}
				>
					<Button
						variant='ghost-muted'
						size='icon-sm'
						onClick={() => editedMessageIdStore.setEditingId(message.id)}
					>
						<Pencil />
					</Button>
					<Button variant='ghost-muted' size='icon-sm' onClick={() => copy(getMessageText(message))}>
						{isCopied ? <Check className='size-4' /> : <Copy />}
					</Button>
				</div>
			</div>
		</div>
	);
});
