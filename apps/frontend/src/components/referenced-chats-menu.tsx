import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { ChevronDown, GitFork, Loader2, MessageSquare, Plus } from 'lucide-react';
import type { inferRouterOutputs } from '@trpc/server';
import type { TrpcRouter } from '@nao/backend/trpc';

import { Button } from '@/components/ui/button';
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useProjectSwitch } from '@/hooks/use-project-switch';
import { useStartChatWithStories } from '@/hooks/use-start-chat-with-stories';
import { trpc } from '@/main';

type ReferencingChat = inferRouterOutputs<TrpcRouter>['story']['listReferencingChats']['chats'][number];

export interface ReferencedChatsControls {
	storyId: string | null;
	/** Mentions the story in a new chat. Archived stories cannot be mentioned. */
	canStartChat: boolean;
	/** Copies the story into a new chat of the user. */
	canFork: boolean;
	/** Offered while a standalone story has no chat: attaches the story to a new chat to edit it there. */
	onOpenInChat?: () => void;
	isOpeningInChat?: boolean;
}

/** The user's chats around a story: the one that created it first, then those that reference it. */
export function ReferencedChatsMenu({
	storyId,
	canStartChat,
	canFork,
	onOpenInChat,
	isOpeningInChat = false,
}: ReferencedChatsControls) {
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const startChatWithStories = useStartChatWithStories();
	const { data: currentProject } = useQuery(trpc.project.getCurrent.queryOptions());
	const switchProject = useProjectSwitch(currentProject?.id);
	const { data: resolvedStory } = useQuery({
		...trpc.story.resolve.queryOptions({ storyId: storyId ?? '' }),
		enabled: Boolean(storyId),
	});
	const [isOpen, setIsOpen] = useState(false);
	const { data, isPending } = useQuery({
		...trpc.story.listReferencingChats.queryOptions({ storyId: storyId ?? '' }),
		enabled: isOpen && Boolean(storyId),
	});
	const forkMutation = useMutation(
		trpc.chatFork.forkStory.mutationOptions({
			onSuccess: async ({ chatId }) => {
				await switchToStoryProject();
				queryClient.invalidateQueries({ queryKey: [['chat', 'listGrouped']] });
				queryClient.invalidateQueries({ queryKey: trpc.story.listAll.queryKey() });
				navigate({ to: '/$chatId', params: { chatId }, state: { openStorySlug: resolvedStory?.slug } });
			},
		}),
	);
	const chats = data?.chats ?? [];
	const originChat = chats.find((chat) => chat.isOrigin);
	const otherChats = chats.filter((chat) => !chat.isOrigin);
	const canOpenInChat = !originChat && Boolean(onOpenInChat);
	const isBusy = isOpeningInChat || forkMutation.isPending;
	const isDisabled = isBusy || !resolvedStory;

	/** The chats around a story live in its project, so the project is switched before reaching them. */
	const switchToStoryProject = async () => {
		if (resolvedStory?.projectId) {
			await switchProject(resolvedStory.projectId);
		}
	};

	const openChat = async (chat: ReferencingChat) => {
		await switchToStoryProject();
		navigate({
			to: '/$chatId',
			params: { chatId: chat.chatId },
			state: chat.isOrigin ? { openStorySlug: resolvedStory?.slug } : undefined,
		});
	};

	const startChat = async () => {
		if (!storyId) {
			return;
		}
		await switchToStoryProject();
		startChatWithStories({ storyIds: [storyId], folderIds: [] });
	};

	const forkStory = () => {
		if (storyId) {
			forkMutation.mutate({ storyId });
		}
	};

	return (
		<DropdownMenu open={isOpen} onOpenChange={setIsOpen}>
			<DropdownMenuTrigger asChild>
				<Button variant='outline' size='sm' className='gap-1.5 rounded-full text-xs' disabled={isDisabled}>
					{isBusy ? (
						<Loader2 className='size-3.5 animate-spin' strokeWidth={2.25} />
					) : (
						<MessageSquare className='size-3.5' strokeWidth={2.25} />
					)}
					<span>Referenced chats</span>
					<ChevronDown className='size-3' strokeWidth={2.25} />
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align='end' className='w-64'>
				{isPending && (
					<DropdownMenuItem disabled>
						<Loader2 className='animate-spin' strokeWidth={2.25} />
						<span>Loading chats…</span>
					</DropdownMenuItem>
				)}
				{!isPending && chats.length === 0 && !canOpenInChat && (
					<DropdownMenuItem disabled>
						<span>No chat references this story yet</span>
					</DropdownMenuItem>
				)}
				{(originChat || canOpenInChat) && (
					<>
						<DropdownMenuLabel className='text-xs text-muted-foreground'>Origin chat</DropdownMenuLabel>
						{originChat ? (
							<ChatItem chat={originChat} onOpen={openChat} />
						) : (
							<DropdownMenuItem onSelect={onOpenInChat}>
								<MessageSquare strokeWidth={2.25} />
								<span>Open in a chat</span>
							</DropdownMenuItem>
						)}
					</>
				)}
				{(originChat || canOpenInChat) && otherChats.length > 0 && <DropdownMenuSeparator />}
				{otherChats.length > 0 && (
					<>
						<DropdownMenuLabel className='text-xs text-muted-foreground'>Referenced in</DropdownMenuLabel>
						{otherChats.map((chat) => (
							<ChatItem key={chat.chatId} chat={chat} onOpen={openChat} />
						))}
					</>
				)}
				{(canStartChat || canFork) && <DropdownMenuSeparator />}
				{canStartChat && (
					<DropdownMenuItem onSelect={startChat}>
						<Plus strokeWidth={2.25} />
						<span>Start a chat from this story</span>
					</DropdownMenuItem>
				)}
				{canFork && (
					<DropdownMenuItem onSelect={forkStory}>
						<GitFork strokeWidth={2.25} />
						<span>Fork this story</span>
					</DropdownMenuItem>
				)}
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

function ChatItem({ chat, onOpen }: { chat: ReferencingChat; onOpen: (chat: ReferencingChat) => void }) {
	return (
		<DropdownMenuItem onSelect={() => onOpen(chat)}>
			<MessageSquare strokeWidth={2.25} />
			<span className='truncate'>{chat.title}</span>
		</DropdownMenuItem>
	);
}
