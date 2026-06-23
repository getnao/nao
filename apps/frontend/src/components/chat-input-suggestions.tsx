import { useCallback, useEffect, useMemo, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { ThumbsDown, ThumbsUp, X } from 'lucide-react';
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
 * A floating panel that sits above the chat input and surfaces contextual
 * prompts: asking for feedback after a lull, or offering to turn charts into a
 * story once the conversation has produced a few.
 */
export function ChatInputSuggestions() {
	const { isReadonly } = useAgentContext();
	if (isReadonly) {
		return null;
	}

	return (
		<>
			<StorySuggestionPrompt />
			<ConversationFeedbackPrompt />
		</>
	);
}

function StorySuggestionPrompt() {
	const { messages, isRunning, queueOrSendMessage } = useAgentContext();
	const chatId = useChatId();

	const [neverPropose, setNeverPropose] = useState(() => storyProposalDisabledStorage.get() ?? false);
	const [dismissedChats, setDismissedChats] = useState<ReadonlySet<string>>(() => new Set());

	const chartCount = useMemo(() => countDisplayCharts(messages), [messages]);
	const hasStory = useMemo(() => findStoryIds(messages).length > 0, [messages]);

	const isPersistedChat = !!chatId && chatId !== NEW_CHAT_ID;
	const isDismissed = !!chatId && dismissedChats.has(chatId);
	const isEligible =
		isPersistedChat &&
		!isRunning &&
		!neverPropose &&
		!hasStory &&
		!isDismissed &&
		chartCount >= STORY_CHART_THRESHOLD;

	const dismissForChat = useCallback(() => {
		if (chatId) {
			setDismissedChats((prev) => new Set(prev).add(chatId));
		}
	}, [chatId]);

	const handleAccept = useCallback(() => {
		void queueOrSendMessage({ text: STORY_SUGGESTION_MESSAGE });
		dismissForChat();
	}, [queueOrSendMessage, dismissForChat]);

	const handleNeverPropose = useCallback(() => {
		setNeverPropose(true);
		storyProposalDisabledStorage.set(true);
	}, []);

	if (!isEligible) {
		return null;
	}

	return (
		<SuggestionCard
			icon={<StoryIcon className='size-4 shrink-0 text-primary' />}
			message='Would you want to create a story?'
		>
			<Button variant='primary-gradient' size='sm' className='rounded-full' onClick={handleAccept}>
				Yes
			</Button>
			<Button variant='ghost' size='sm' className='rounded-full' onClick={dismissForChat}>
				No
			</Button>
			<Button
				variant='ghost'
				size='sm'
				className='rounded-full text-muted-foreground'
				onClick={handleNeverPropose}
			>
				Do not propose again
			</Button>
		</SuggestionCard>
	);
}

function ConversationFeedbackPrompt() {
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

	const submitVote = useCallback(
		(vote: 'up' | 'down') => {
			if (!chatId || !lastAssistantMessage) {
				return;
			}
			submitFeedback.mutate({ chatId, messageId: lastAssistantMessage.id, vote });
			setThanksForChat(chatId);
		},
		[chatId, lastAssistantMessage, submitFeedback],
	);

	const dismissForChat = useCallback(() => {
		if (chatId) {
			setDismissedChats((prev) => new Set(prev).add(chatId));
		}
	}, [chatId]);

	if (showThanks) {
		return <SuggestionCard message='Thanks for your feedback!' />;
	}

	if (!isEligible || !isTriggered) {
		return null;
	}

	return (
		<SuggestionCard message='How was this conversation?'>
			<Button
				variant='ghost'
				size='icon-sm'
				className='hover:rounded-full'
				onClick={() => submitVote('up')}
				disabled={submitFeedback.isPending}
				aria-label='Good conversation'
			>
				<ThumbsUp className='size-4' />
			</Button>
			<Button
				variant='ghost'
				size='icon-sm'
				className='hover:rounded-full'
				onClick={() => submitVote('down')}
				disabled={submitFeedback.isPending}
				aria-label='Bad conversation'
			>
				<ThumbsDown className='size-4' />
			</Button>
			<Button
				variant='ghost'
				size='icon-sm'
				className='hover:rounded-full text-muted-foreground'
				onClick={dismissForChat}
				aria-label='Dismiss'
			>
				<X className='size-4' />
			</Button>
		</SuggestionCard>
	);
}

function SuggestionCard({
	icon,
	message,
	children,
}: {
	icon?: React.ReactNode;
	message: string;
	children?: React.ReactNode;
}) {
	return (
		<div
			className={cn(
				'mb-2 flex items-center gap-2.5 rounded-2xl border border-input/50 bg-muted/50 px-3 py-2 text-sm',
				'text-muted-foreground animate-in fade-in slide-in-from-bottom-2 duration-200',
			)}
		>
			{icon}
			<p className='flex-1 min-w-0'>{message}</p>
			{children && <div className='flex items-center gap-1'>{children}</div>}
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
