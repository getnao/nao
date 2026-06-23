import { useCallback, useEffect, useMemo, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Check, MessageSquare, ThumbsDown, ThumbsUp, X } from 'lucide-react';
import { Button } from './ui/button';
import StoryIcon from './ui/story-icon';
import type { UIMessage } from '@nao/backend/chat';
import { useAgentContext } from '@/contexts/agent.provider';
import { useChatId } from '@/hooks/use-chat-id';
import { useInactivityTrigger } from '@/hooks/use-inactivity-trigger';
import { checkAssistantMessageHasContent, NEW_CHAT_ID } from '@/lib/ai';
import { countDisplayCharts } from '@/lib/charts.utils';
import { createLocalStorage } from '@/lib/local-storage';
import { findStoryIds } from '@/lib/story.utils';
import { cn } from '@/lib/utils';
import { trpc } from '@/main';

/** Milliseconds of inactivity before we ask the user how the conversation went. */
const FEEDBACK_INACTIVITY_MS = 10_000;
/** How many charts must exist in a chat before we offer to turn them into a story. */
const STORY_CHART_THRESHOLD = 2;
/** Message sent on behalf of the user when they accept the story suggestion. */
const STORY_SUGGESTION_MESSAGE = 'Create a story from the charts in this conversation.';

const storyProposalDisabledStorage = createLocalStorage<boolean>('nao-story-proposal-disabled', false);

/**
 * A floating panel that sits above the chat input and surfaces a single
 * contextual prompt. Only one suggestion is shown at a time — the story
 * suggestion takes priority over the conversation feedback prompt.
 */
export function ChatInputSuggestions() {
	const { isReadonly } = useAgentContext();
	const story = useStorySuggestion();
	const feedback = useConversationFeedback();

	if (isReadonly) {
		return null;
	}

	if (story.isVisible) {
		return (
			<SuggestionCard
				tone='primary'
				icon={<StoryIcon className='size-4 text-primary' />}
				message='Would you want to create a story?'
			>
				<Button variant='primary-gradient' size='sm' className='rounded-full' onClick={story.accept}>
					Yes
				</Button>
				<Button variant='ghost' size='sm' className='rounded-full' onClick={story.dismiss}>
					No
				</Button>
				<Button
					variant='ghost'
					size='sm'
					className='rounded-full text-muted-foreground'
					onClick={story.neverPropose}
				>
					Do not propose again
				</Button>
			</SuggestionCard>
		);
	}

	if (feedback.showThanks) {
		return (
			<SuggestionCard
				tone='primary'
				icon={<Check className='size-4 text-primary' />}
				message='Thanks for your feedback!'
			/>
		);
	}

	if (feedback.isVisible) {
		return (
			<SuggestionCard
				icon={<MessageSquare className='size-4 text-muted-foreground' />}
				message='How was this conversation?'
			>
				<Button
					variant='ghost'
					size='icon-sm'
					className='hover:rounded-full'
					onClick={() => feedback.vote('up')}
					disabled={feedback.isPending}
					aria-label='Good conversation'
				>
					<ThumbsUp className='size-4' />
				</Button>
				<Button
					variant='ghost'
					size='icon-sm'
					className='hover:rounded-full'
					onClick={() => feedback.vote('down')}
					disabled={feedback.isPending}
					aria-label='Bad conversation'
				>
					<ThumbsDown className='size-4' />
				</Button>
				<Button
					variant='ghost'
					size='icon-sm'
					className='hover:rounded-full text-muted-foreground'
					onClick={feedback.dismiss}
					aria-label='Dismiss'
				>
					<X className='size-4' />
				</Button>
			</SuggestionCard>
		);
	}

	return null;
}

interface StorySuggestion {
	isVisible: boolean;
	accept: () => void;
	dismiss: () => void;
	neverPropose: () => void;
}

function useStorySuggestion(): StorySuggestion {
	const { messages, isRunning, queueOrSendMessage } = useAgentContext();
	const chatId = useChatId();

	const [neverPropose, setNeverPropose] = useState(() => storyProposalDisabledStorage.get() ?? false);
	const [dismissedChats, setDismissedChats] = useState<ReadonlySet<string>>(() => new Set());

	const chartCount = useMemo(() => countDisplayCharts(messages), [messages]);
	const hasStory = useMemo(() => findStoryIds(messages).length > 0, [messages]);

	const isPersistedChat = !!chatId && chatId !== NEW_CHAT_ID;
	const isDismissed = !!chatId && dismissedChats.has(chatId);
	const isVisible =
		isPersistedChat &&
		!isRunning &&
		!neverPropose &&
		!hasStory &&
		!isDismissed &&
		chartCount >= STORY_CHART_THRESHOLD;

	const dismiss = useCallback(() => {
		if (chatId) {
			setDismissedChats((prev) => new Set(prev).add(chatId));
		}
	}, [chatId]);

	const accept = useCallback(() => {
		void queueOrSendMessage({ text: STORY_SUGGESTION_MESSAGE });
		dismiss();
	}, [queueOrSendMessage, dismiss]);

	const handleNeverPropose = useCallback(() => {
		setNeverPropose(true);
		storyProposalDisabledStorage.set(true);
	}, []);

	return { isVisible, accept, dismiss, neverPropose: handleNeverPropose };
}

interface ConversationFeedback {
	isVisible: boolean;
	showThanks: boolean;
	isPending: boolean;
	vote: (vote: 'up' | 'down') => void;
	dismiss: () => void;
}

function useConversationFeedback(): ConversationFeedback {
	const { messages, isRunning } = useAgentContext();
	const chatId = useChatId();

	const [dismissedChats, setDismissedChats] = useState<ReadonlySet<string>>(() => new Set());
	const [thanksForChat, setThanksForChat] = useState<string | null>(null);

	const submitFeedback = useMutation(
		trpc.feedback.submit.mutationOptions({
			onSuccess: (data, variables, _, ctx) => {
				ctx.client.setQueryData(trpc.chat.get.queryKey({ chatId: variables.chatId }), (prev) =>
					prev
						? {
								...prev,
								messages: prev.messages.map((message) =>
									message.id === variables.messageId ? { ...message, feedback: data } : message,
								),
							}
						: prev,
				);
			},
		}),
	);

	const lastAssistantMessage = useMemo(() => findLastAssistantWithContent(messages), [messages]);

	const isPersistedChat = !!chatId && chatId !== NEW_CHAT_ID;
	const isDismissed = !!chatId && dismissedChats.has(chatId);
	const hasFeedback = !!lastAssistantMessage?.feedback;
	const isEligible = isPersistedChat && !isRunning && !!lastAssistantMessage && !hasFeedback && !isDismissed;

	const isTriggered = useInactivityTrigger({
		enabled: isEligible,
		delayMs: FEEDBACK_INACTIVITY_MS,
		resetKey: `${chatId}:${messages.length}`,
	});

	const showThanks = !!chatId && thanksForChat === chatId;

	useEffect(() => {
		if (!showThanks) {
			return;
		}
		const timer = window.setTimeout(() => {
			if (chatId) {
				setDismissedChats((prev) => new Set(prev).add(chatId));
			}
			setThanksForChat(null);
		}, 2_500);
		return () => window.clearTimeout(timer);
	}, [showThanks, chatId]);

	const vote = useCallback(
		(value: 'up' | 'down') => {
			if (!chatId || !lastAssistantMessage) {
				return;
			}
			submitFeedback.mutate({ chatId, messageId: lastAssistantMessage.id, vote: value });
			setThanksForChat(chatId);
		},
		[chatId, lastAssistantMessage, submitFeedback],
	);

	const dismiss = useCallback(() => {
		if (chatId) {
			setDismissedChats((prev) => new Set(prev).add(chatId));
		}
	}, [chatId]);

	return {
		isVisible: isEligible && isTriggered,
		showThanks,
		isPending: submitFeedback.isPending,
		vote,
		dismiss,
	};
}

function SuggestionCard({
	icon,
	tone = 'muted',
	message,
	children,
}: {
	icon?: React.ReactNode;
	tone?: 'muted' | 'primary';
	message: string;
	children?: React.ReactNode;
}) {
	return (
		<div className='mb-2 flex items-center gap-3 rounded-lg border bg-background px-3 py-2.5 shadow-xs animate-in fade-in slide-in-from-bottom-2 duration-200'>
			{icon && (
				<div
					className={cn(
						'flex size-9 shrink-0 items-center justify-center rounded-lg border',
						tone === 'primary'
							? 'border-primary/20 bg-gradient-to-br from-primary/15 to-primary/5'
							: 'border-border bg-muted/50',
					)}
				>
					{icon}
				</div>
			)}
			<p className='min-w-0 flex-1 truncate text-sm font-medium text-foreground'>{message}</p>
			{children && <div className='flex shrink-0 items-center gap-1'>{children}</div>}
		</div>
	);
}

function findLastAssistantWithContent(messages: UIMessage[]): UIMessage | undefined {
	for (let i = messages.length - 1; i >= 0; i--) {
		const message = messages[i];
		if (message.role === 'assistant' && checkAssistantMessageHasContent(message)) {
			return message;
		}
	}
	return undefined;
}
