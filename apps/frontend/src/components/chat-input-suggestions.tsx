import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { MessageSquare, X, ThumbsDown, ThumbsUp, Check, Plug } from 'lucide-react';
import { NegativeFeedbackDialog } from './chat-messages/assistant-message-actions';
import { Button } from './ui/button';
import StoryIcon from './ui/story-icon';
import type { UIMessage, UIToolPart } from '@nao/backend/chat';
import { useAgentContext } from '@/contexts/agent.provider';
import { useChatId } from '@/hooks/use-chat-id';
import { useInactivityTrigger } from '@/hooks/use-inactivity-trigger';
import { checkAssistantMessageHasContent, getToolName, NEW_CHAT_ID } from '@/lib/ai';
import { countDisplayCharts } from '@/lib/charts.utils';
import { createLocalStorage } from '@/lib/local-storage';
import { lastUserMessagePayload } from '@/lib/mcp-auth-retry';
import { openMcpConnectPopup } from '@/lib/mcp-oauth';
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
 *
 * When `isHidden` is set (e.g. the user starts typing) the panel smoothly
 * collapses and fades out instead of abruptly unmounting.
 */
export function ChatInputSuggestions({ isHidden = false }: { isHidden?: boolean }) {
	const { isReadonly } = useAgentContext();
	const mcpAuth = useMcpAuthSuggestion();
	const story = useStorySuggestion();
	const feedback = useConversationFeedback();

	const content = renderSuggestion({ isReadonly, mcpAuth, story, feedback });
	const isCollapsed = isHidden || !content;
	const { ref, height } = useMeasuredHeight();

	return (
		<div
			className='overflow-hidden'
			style={{
				height: isCollapsed ? 0 : height,
				opacity: isCollapsed ? 0 : 1,
				transition: 'height 300ms ease-out, opacity 300ms ease-out',
			}}
			aria-hidden={isCollapsed}
		>
			<div ref={ref} className={cn('pb-2', isCollapsed && 'pointer-events-none')}>
				{content}
			</div>
		</div>
	);
}

/** Measures the suggestion content height so the panel can collapse to a real, transitionable pixel value. */
function useMeasuredHeight() {
	const ref = useRef<HTMLDivElement>(null);
	const [height, setHeight] = useState(0);

	useLayoutEffect(() => {
		const element = ref.current;
		if (!element) {
			return;
		}
		const observer = new ResizeObserver(() => setHeight(element.offsetHeight));
		observer.observe(element);
		return () => observer.disconnect();
	}, []);

	return { ref, height };
}

function renderSuggestion({
	isReadonly,
	mcpAuth,
	story,
	feedback,
}: {
	isReadonly: boolean | undefined;
	mcpAuth: McpAuthSuggestion;
	story: StorySuggestion;
	feedback: ConversationFeedback;
}) {
	if (isReadonly) {
		return null;
	}

	if (mcpAuth.isVisible && mcpAuth.server) {
		return (
			<SuggestionCard
				icon={<Plug className='size-4 text-primary' />}
				message={`Connect your account to "${mcpAuth.server}" to continue`}
			>
				<Button
					variant='ghost'
					size='sm'
					className='rounded-full text-muted-foreground'
					onClick={mcpAuth.dismiss}
				>
					Not now
				</Button>
				<Button
					variant='primary-gradient'
					size='sm'
					className='rounded-full'
					onClick={mcpAuth.connect}
					disabled={mcpAuth.connecting}
				>
					{mcpAuth.connecting ? 'Connecting…' : 'Connect'}
				</Button>
			</SuggestionCard>
		);
	}

	if (story.isVisible) {
		return (
			<SuggestionCard
				icon={<StoryIcon className='size-5 text-primary' />}
				message='Would you want to create a story?'
			>
				<Button
					variant='ghost'
					size='sm'
					className='rounded-full text-muted-foreground'
					onClick={story.neverPropose}
				>
					Do not propose again
				</Button>
				<Button variant='ghost' size='sm' className='rounded-full' onClick={story.dismiss}>
					No
				</Button>
				<Button variant='primary-gradient' size='sm' className='rounded-full' onClick={story.accept}>
					Yes
				</Button>
			</SuggestionCard>
		);
	}

	if (feedback.showThanks) {
		return <SuggestionCard icon={<Check className='size-4 text-primary' />} message='Thanks for your feedback!' />;
	}

	if (feedback.isVisible) {
		return (
			<>
				<SuggestionCard
					icon={<MessageSquare className='size-4 text-muted-foreground' />}
					message='How did this conversation go?'
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
						onClick={() => feedback.setFeedbackDialogOpen(true)}
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
				<NegativeFeedbackDialog
					open={feedback.feedbackDialogOpen}
					onOpenChange={feedback.setFeedbackDialogOpen}
					onSubmit={(explanation) => feedback.vote('down', explanation)}
					isPending={feedback.isPending}
				/>
			</>
		);
	}

	return null;
}

interface McpAuthSuggestion {
	isVisible: boolean;
	server: string | null;
	connecting: boolean;
	connect: () => void;
	dismiss: () => void;
}

/**
 * Detects when the agent attempted an MCP tool that needs the current user to connect their
 * account, and offers an inline Connect action. On success it re-sends the user's last request.
 */
function useMcpAuthSuggestion(): McpAuthSuggestion {
	const { messages, isRunning, queueOrSendMessage } = useAgentContext();
	const chatId = useChatId();

	const [connecting, setConnecting] = useState(false);
	const [resolved, setResolved] = useState<ReadonlySet<string>>(() => new Set());

	useEffect(() => {
		setResolved(new Set());
	}, [chatId]);

	const server = useMemo(() => findPendingAuthServer(messages), [messages]);
	const pendingServer = server && !resolved.has(server) ? server : null;

	const connect = useCallback(async () => {
		if (!pendingServer) {
			return;
		}
		setConnecting(true);
		const connected = await openMcpConnectPopup(pendingServer);
		setConnecting(false);
		if (connected) {
			setResolved((prev) => new Set(prev).add(pendingServer));
			const payload = lastUserMessagePayload(messages);
			if (payload) {
				void queueOrSendMessage(payload);
			}
		}
	}, [pendingServer, messages, queueOrSendMessage]);

	const dismiss = useCallback(() => {
		if (pendingServer) {
			setResolved((prev) => new Set(prev).add(pendingServer));
		}
	}, [pendingServer]);

	return { isVisible: !!pendingServer && !isRunning, server: pendingServer, connecting, connect, dismiss };
}

/** Returns the server from the most recent `mcp_call` that reported it needs the user to connect. */
function findPendingAuthServer(messages: UIMessage[]): string | null {
	for (let i = messages.length - 1; i >= 0; i--) {
		const message = messages[i];
		if (message.role !== 'assistant') {
			continue;
		}
		for (let j = message.parts.length - 1; j >= 0; j--) {
			const part = message.parts[j];
			const type = (part as { type: string }).type;
			if (type !== 'dynamic-tool' && !type.startsWith('tool-')) {
				continue;
			}
			if (getToolName(part as UIToolPart) !== 'mcp_call') {
				continue;
			}
			const output = (part as UIToolPart).output as { mcpAuthRequired?: boolean; server?: string } | undefined;
			if (output?.mcpAuthRequired && output.server) {
				return output.server;
			}
		}
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
	vote: (vote: 'up' | 'down', explanation?: string) => void;
	dismiss: () => void;
	feedbackDialogOpen: boolean;
	setFeedbackDialogOpen: (open: boolean) => void;
}

function useConversationFeedback(): ConversationFeedback {
	const { messages, isRunning } = useAgentContext();
	const chatId = useChatId();

	const [dismissedChats, setDismissedChats] = useState<ReadonlySet<string>>(() => new Set());
	const [thanksForChat, setThanksForChat] = useState<string | null>(null);
	const [feedbackDialogOpen, setFeedbackDialogOpen] = useState(false);

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
		(value: 'up' | 'down', explanation?: string) => {
			if (!chatId || !lastAssistantMessage) {
				return;
			}
			submitFeedback.mutate({ chatId, messageId: lastAssistantMessage.id, vote: value, explanation });
			setThanksForChat(chatId);
			setFeedbackDialogOpen(false);
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
		feedbackDialogOpen,
		setFeedbackDialogOpen,
	};
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
			data-selection-ignore
			className='group flex items-center gap-1 rounded-2xl border border-muted-foreground/25 bg-background p-2'
		>
			{icon && <div className='flex size-9 shrink-0 items-center justify-center'>{icon}</div>}
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
