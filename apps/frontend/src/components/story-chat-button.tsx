import { useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { AtSign, ChevronDown, Loader2, MessageCircle } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

import { ChatListSection } from '@/components/chat-list-menu-section';
import { Button } from '@/components/ui/button';
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useKeyboardShortcuts } from '@/hooks/use-keyboard-shortcuts';
import { useProjectSwitch } from '@/hooks/use-project-switch';
import { useStartChatWithStories } from '@/hooks/use-start-chat-with-stories';
import { trpc } from '@/main';
import { requestAsk } from '@/stores/ask-bar';

export type StoryChatMode = 'edit' | 'ask' | 'mention';

export interface StoryChatControls {
	storyId: string | null;
	isOwner: boolean;
	/** False for project viewers and archived stories, which can only be read. */
	canChat: boolean;
	onOpenInChat?: () => void;
	isOpeningInChat?: boolean;
}

const MODES: Record<StoryChatMode, { label: string; icon: LucideIcon }> = {
	edit: { label: 'Edit story', icon: MessageCircle },
	ask: { label: 'Ask story', icon: MessageCircle },
	mention: { label: 'Mention story', icon: AtSign },
};

export function StoryChatButton({
	storyId,
	isOwner,
	canChat,
	onOpenInChat,
	isOpeningInChat = false,
}: StoryChatControls) {
	const mode: StoryChatMode = isOwner ? 'edit' : 'ask';
	const actions = useStoryChatActions(storyId, onOpenInChat);
	const lists = useStoryChatLists(storyId, canChat);
	const isDisabled = isOpeningInChat || !actions.isReady;

	useKeyboardShortcuts({
		'toggle-story-chat': canChat && !isDisabled ? () => actions.run(mode) : undefined,
	});

	if (!canChat || !storyId) {
		return null;
	}

	const { label, icon: Icon } = MODES[mode];

	return (
		<div className='flex h-7 items-center overflow-hidden rounded-full border bg-background'>
			<Button
				variant='ghost'
				size='sm'
				className='h-full gap-1.5 rounded-l-full rounded-r-none pr-2 text-xs'
				disabled={isDisabled}
				onClick={() => actions.run(mode)}
			>
				{isOpeningInChat ? (
					<Loader2 className='size-3.5 animate-spin' strokeWidth={2.25} />
				) : (
					<Icon className='size-3.5 overflow-visible' strokeWidth={2.25} />
				)}
				<span>{label}</span>
			</Button>
			<DropdownMenu>
				<DropdownMenuTrigger asChild>
					<Button
						variant='ghost'
						size='sm'
						className='h-full rounded-l-none rounded-r-full border-l px-1.5'
						disabled={isDisabled}
						aria-label='More ways to talk to this story'
					>
						<ChevronDown className='size-3' strokeWidth={2.25} />
					</Button>
				</DropdownMenuTrigger>
				<DropdownMenuContent align='end' className='w-72'>
					<MentionItem onSelect={() => actions.run('mention')} />
					<StoryChatLists
						lists={lists}
						onOpenQuickQuestion={(chatId) => requestAsk({ chatId })}
						onOpenChat={actions.openChat}
					/>
				</DropdownMenuContent>
			</DropdownMenu>
		</div>
	);
}

function MentionItem({ onSelect }: { onSelect: () => void }) {
	const { label, icon: Icon } = MODES.mention;
	return (
		<DropdownMenuItem onSelect={onSelect}>
			<span className='flex size-7 shrink-0 items-center justify-center rounded-md'>
				<Icon strokeWidth={2.25} />
			</span>
			<span className='flex min-w-0 flex-col items-start! gap-0.5!'>
				<span>{label}</span>
				<span className='font-normal text-muted-foreground'>Start a new chat about this story</span>
			</span>
		</DropdownMenuItem>
	);
}

function StoryChatLists({
	lists,
	onOpenQuickQuestion,
	onOpenChat,
}: {
	lists: ReturnType<typeof useStoryChatLists>;
	onOpenQuickQuestion: (chatId: string) => void;
	onOpenChat: (chatId: string) => void;
}) {
	const { quickQuestions, mentioningChats } = lists;
	const mentions = (mentioningChats.data?.chats ?? []).filter((chat) => !chat.isOrigin);

	return (
		<>
			<ChatListSection
				title='Quick questions'
				query={quickQuestions}
				chats={quickQuestions.data ?? []}
				onOpen={onOpenQuickQuestion}
			/>
			<ChatListSection title='Mentions' query={mentioningChats} chats={mentions} onOpen={onOpenChat} />
		</>
	);
}

function useStoryChatLists(storyId: string | null, canChat: boolean) {
	const enabled = canChat && Boolean(storyId);
	const quickQuestions = useQuery({
		...trpc.story.listQuickQuestions.queryOptions({ storyId: storyId ?? '' }),
		enabled,
	});
	const mentioningChats = useQuery({
		...trpc.story.listMentioningChats.queryOptions({ storyId: storyId ?? '' }),
		enabled,
	});
	return { quickQuestions, mentioningChats };
}

/** The chats around a story live in its project, so the project is switched before reaching them. */
function useStoryChatActions(storyId: string | null, onOpenInChat: (() => void) | undefined) {
	const navigate = useNavigate();
	const startChatWithStories = useStartChatWithStories();
	const { data: currentProject } = useQuery(trpc.project.getCurrent.queryOptions());
	const switchProject = useProjectSwitch(currentProject?.id);
	const { data: resolvedStory } = useQuery({
		...trpc.story.resolve.queryOptions({ storyId: storyId ?? '' }),
		enabled: Boolean(storyId),
	});

	const switchToStoryProject = async () => {
		if (resolvedStory?.projectId) {
			await switchProject(resolvedStory.projectId);
		}
	};

	const openChat = async (chatId: string, openStorySlug?: string) => {
		await switchToStoryProject();
		navigate({ to: '/$chatId', params: { chatId }, state: openStorySlug ? { openStorySlug } : undefined });
	};

	const run = async (mode: StoryChatMode) => {
		if (!storyId || !resolvedStory) {
			return;
		}
		if (mode === 'ask') {
			requestAsk();
			return;
		}
		if (mode === 'mention') {
			await switchToStoryProject();
			startChatWithStories({ storyIds: [storyId], folderIds: [] });
			return;
		}
		if (resolvedStory.chatId) {
			await openChat(resolvedStory.chatId, resolvedStory.slug);
			return;
		}
		onOpenInChat?.();
	};

	return { run, openChat: (chatId: string) => openChat(chatId), isReady: Boolean(resolvedStory) };
}
