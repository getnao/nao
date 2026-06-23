import { memo, useMemo, useRef, useState } from 'react';
import { Pencil, Check, Copy, Table, RotateCcw, ChevronLeft, ChevronRight } from 'lucide-react';
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
import { ChatMessagesCitationChip } from '@/components/chat-messages/chat-messages-citation-chip';
import { ImageLightbox } from '@/components/image-lightbox';
import { getMessageText, getMessageImages } from '@/lib/ai';
import { parseChatMessageCitation } from '@/lib/chat-messages-citation-parser';
import { Button } from '@/components/ui/button';
import { SimpleTooltip } from '@/components/ui/tooltip';
import { useTimeAgo } from '@/hooks/use-time-ago';
import { editedMessageIdStore } from '@/stores/chat-edited-message';
import { trpc } from '@/main';
import { STORY_MENTION_ID } from '@/components/chat-input-prompt';
import StoryIcon from '@/components/ui/story-icon';
import SlackIcon from '@/components/icons/slack.svg';
import TeamsIcon from '@/components/icons/microsoft-teams.svg';
import McpIcon from '@/components/icons/model-context-protocol.svg';
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
		backgroundColor: 'var(--background)',
		color: 'var(--foreground)',
		padding: 'calc(var(--spacing) * 1) calc(var(--spacing) * 2.5)',
		borderRadius: '9999px',
	},
};

const tableIcon = <Table className='size-4' />;

const MESSAGE_SOURCES = {
	slack: { icon: <SlackIcon className='size-3.5' />, label: 'sent in Slack' },
	teams: { icon: <TeamsIcon className='size-4' />, label: 'sent in Teams' },
	telegram: { icon: <TelegramIcon className='size-4' />, label: 'sent in Telegram' },
	whatsapp: { icon: <WhatsAppIcon className='size-4' />, label: 'sent in WhatsApp' },
	mcp: { icon: <McpIcon className='size-4' />, label: 'sent via MCP' },
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
			{ id: STORY_MENTION_ID, label: 'Story mode', icon: <StoryIcon className='size-4' strokeWidth={2.25} /> },
		];

		return [
			{ trigger: '@', options: dbOptions },
			{ trigger: '/', options: skillOptions, showTrigger: true },
			{ trigger: '#', options: storyOptions },
		];
	}, [databaseObjects, skills]);
}

export const UserMessageBubble = memo(({ message }: { message: UIMessage }) => {
	const rawText = useMemo(() => getMessageText(message), [message]);
	const images = useMemo(() => getMessageImages(message), [message]);
	const mentionConfigs = useMentionConfigs();
	const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);

	const legacyCitation = useMemo(() => parseChatMessageCitation(rawText), [rawText]);
	const citation = message.citation ?? legacyCitation;
	const displayText = legacyCitation ? legacyCitation.question : rawText;

	return (
		<div className='rounded-2xl px-3 py-2 bg-panel text-card-foreground ml-auto max-w-xl'>
			<MessageSourceBadge source={message.source} />
			{citation && (
				<ChatMessagesCitationChip
					start={citation.start}
					end={citation.end}
					text={citation.text}
					storySlug={citation.storySlug}
				/>
			)}
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
			{displayText && (
				<Message
					value={displayText}
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
	const { isRunning, editMessage, resendMessage, switchMessageVersion } = useAgentContext();
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

			<div className='flex items-center gap-1'>
				<div
					className={cn(
						'flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity duration-200',
						isRunning && 'group-last:opacity-0 invisible',
					)}
				>
					{message.createdAt && <MessageTimestamp createdAt={message.createdAt} />}
					<SimpleTooltip content='Resend'>
						<Button
							variant='ghost-muted'
							size='icon-sm'
							className='hover:rounded-full'
							aria-label='Resend'
							disabled={isRunning}
							onClick={() => resendMessage({ messageId: message.id })}
						>
							<RotateCcw />
						</Button>
					</SimpleTooltip>
					<SimpleTooltip content='Edit'>
						<Button
							variant='ghost-muted'
							size='icon-sm'
							className='hover:rounded-full'
							aria-label='Edit'
							onClick={() => editedMessageIdStore.setEditingId(message.id)}
						>
							<Pencil />
						</Button>
					</SimpleTooltip>
					<SimpleTooltip content='Copy'>
						<Button
							variant='ghost-muted'
							size='icon-sm'
							className='hover:rounded-full'
							aria-label='Copy'
							onClick={() => copy(getMessageText(message))}
						>
							{isCopied ? <Check className='size-4' /> : <Copy />}
						</Button>
					</SimpleTooltip>
				</div>

				{message.versionInfo && message.versionInfo.totalVersions > 1 && (
					<MessageVersionNav
						versionInfo={message.versionInfo}
						disabled={isRunning}
						onSwitch={(messageId) => switchMessageVersion({ messageId })}
					/>
				)}
			</div>
		</div>
	);
});

function MessageTimestamp({ createdAt }: { createdAt: number }) {
	const { humanReadable } = useTimeAgo(createdAt);
	return (
		<SimpleTooltip content={new Date(createdAt).toLocaleString()}>
			<span className='px-1 text-xs text-muted-foreground cursor-default select-none'>{humanReadable}</span>
		</SimpleTooltip>
	);
}

function MessageVersionNav({
	versionInfo,
	disabled,
	onSwitch,
}: {
	versionInfo: NonNullable<UIMessage['versionInfo']>;
	disabled: boolean;
	onSwitch: (messageId: string) => void;
}) {
	const { currentVersion, totalVersions, versionIds } = versionInfo;
	const goToPrevious = () => onSwitch(versionIds[currentVersion - 2]);
	const goToNext = () => onSwitch(versionIds[currentVersion]);

	return (
		<div className='flex items-center text-xs text-muted-foreground'>
			<Button
				variant='ghost-muted'
				size='icon-sm'
				className='hover:rounded-full size-6'
				aria-label='Previous version'
				disabled={disabled || currentVersion <= 1}
				onClick={goToPrevious}
			>
				<ChevronLeft />
			</Button>
			<span className='tabular-nums select-none'>
				{currentVersion}/{totalVersions}
			</span>
			<Button
				variant='ghost-muted'
				size='icon-sm'
				className='hover:rounded-full size-6'
				aria-label='Next version'
				disabled={disabled || currentVersion >= totalVersions}
				onClick={goToNext}
			>
				<ChevronRight />
			</Button>
		</div>
	);
}
