import { memo, useMemo, useRef, useState } from 'react';
import { Pencil, Check, Copy, Table } from 'lucide-react';
import { Message } from 'prompt-mentions';
import { useQuery } from '@tanstack/react-query';
import { createPortal } from 'react-dom';
import type { UIMessage } from '@nao/backend/chat';
import type { MessageMentionConfig, MentionOption, PromptTheme } from 'prompt-mentions';
import { cn } from '@/lib/utils';
import { useAgentContext } from '@/contexts/agent.provider';
import { useCopyToClipboard } from '@/hooks/use-copy-to-clipboard';
import { useIsEditingMessage } from '@/hooks/use-is-editing-message-store';
import { useClickOutside } from '@/hooks/use-click-outside';
import { ChatInputInline } from '@/components/chat-input';
import { ImageLightbox } from '@/components/image-lightbox';
import { getMessageText, getMessageImages } from '@/lib/ai';
import { Button } from '@/components/ui/button';
import { editedMessageIdStore } from '@/stores/chat-edited-message';
import { trpc } from '@/main';
import { STORY_MENTION_ID } from '@/components/chat-input-prompt';
import StoryIcon from '@/components/ui/story-icon';
import SlackIcon from '@/components/icons/slack.svg';
import TeamsIcon from '@/components/icons/microsoft-teams.svg';
import TelegramIcon from '@/components/icons/telegram.svg';
import WhatsAppIcon from '@/components/icons/whatsapp.svg';

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

const MESSAGE_SOURCES = {
	slack: { icon: <SlackIcon className='size-3.5' />, label: 'sent in Slack' },
	teams: { icon: <TeamsIcon className='size-4' />, label: 'sent in Teams' },
	telegram: { icon: <TelegramIcon className='size-4' />, label: 'sent in Telegram' },
	whatsapp: { icon: <WhatsAppIcon className='size-4' />, label: 'sent in WhatsApp' },
} as const;

function MessageSourceBadge({ source }: { source: UIMessage['source'] }) {
	const config = source ? MESSAGE_SOURCES[source as keyof typeof MESSAGE_SOURCES] : null;
	if (!config) {
		return null;
	}

	return (
		<span className='flex items-center justify-end gap-1 text-xs text-muted-foreground mb-2'>
			{config.icon}
			{config.label}
		</span>
	);
}

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
	const images = useMemo(() => getMessageImages(message), [message]);
	const mentionConfigs = useMentionConfigs();
	const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);

	return (
		<div className='rounded-2xl px-3 py-2 bg-card text-card-foreground ml-auto max-w-xl'>
			<MessageSourceBadge source={message.source} />
			{images.length > 0 && (
				<div className='flex gap-2 flex-wrap mb-2'>
					{images.map((img, idx) => (
						<button
							key={idx}
							type='button'
							onClick={() => setLightboxSrc(img.url)}
							className='cursor-pointer'
						>
							<img src={img.url} alt='' className='max-w-48 max-h-48 rounded-lg object-cover' />
						</button>
					))}
				</div>
			)}
			{text && (
				<Message
					value={text}
					mentionConfigs={mentionConfigs}
					theme={messageTheme}
					className='flex items-center justify-end'
				/>
			)}
			{lightboxSrc &&
				createPortal(<ImageLightbox src={lightboxSrc} onClose={() => setLightboxSrc(null)} />, document.body)}
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
