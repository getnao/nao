import { useCallback, useEffect, useRef, useState } from 'react';
import { MessageCircle, PanelRightClose, PanelRightOpen, SquarePen } from 'lucide-react';
import type { ReactNode } from 'react';
import type { PromptSuggestion } from '@/components/prompt-suggestions';

import type { SubmittedMessage } from '@/hooks/use-agent';
import type { ChatInputRestore } from '@/stores/chat-input-restore';
import { PendingMessageSender } from '@/components/ask-bar';
import { ChatInput } from '@/components/chat-input';
import { ChatMessagesContent } from '@/components/chat-messages/chat-messages';
import { EditorChatPanelResizeHandle, useEditorChatPanelWidth } from '@/components/editor-chat-panel-resize-handle';
import { PromptSuggestions } from '@/components/prompt-suggestions';
import { Button } from '@/components/ui/button';
import { Conversation, ConversationContent, ConversationScrollButton } from '@/components/ui/conversation';
import { Spinner } from '@/components/ui/spinner';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { AgentProvider } from '@/contexts/agent.provider';
import { SetChatInputCallbackProvider } from '@/contexts/set-chat-input-callback';
import { ChatIdContext } from '@/hooks/use-chat-id';
import { cn } from '@/lib/utils';
import { chatInputRestoreStore } from '@/stores/chat-input-restore';

export interface EditorChatSession {
	chatId: string;
	pendingMessage?: SubmittedMessage;
	/** A conversation from an earlier visit, whose changes the page already received. */
	isResumed: boolean;
}

export interface EditorChatCopy {
	placeholder: string;
	introTitle: string;
	introDescription: string;
	suggestions: PromptSuggestion[];
}

export type EditorChatSessionState = ReturnType<typeof useEditorChatSession>;

const PANEL_TITLE = 'Edit with chat';
const SUGGESTIONS_TITLE = 'Suggested ideas';
const START_ERROR_MESSAGE = "Couldn't start the conversation. Try again.";

/**
 * A chat along the right edge of an editing page, whose agent reads what the page edits and changes it.
 * The page decides how the agent's changes reach it, through `sessionEffects`.
 */
export function EditorChatPanel({
	session,
	copy,
	isOpen,
	onOpenChange,
	getRequestBody,
	sessionEffects,
	onChatStarted,
}: {
	session: EditorChatSessionState;
	copy: EditorChatCopy;
	isOpen: boolean;
	onOpenChange: (isOpen: boolean) => void;
	/** Sent with every message, like the page's current state. */
	getRequestBody: () => Record<string, unknown>;
	/** Rendered inside the conversation, to follow the agent's changes. */
	sessionEffects?: (session: EditorChatSession) => ReactNode;
	onChatStarted?: (chatId: string) => void;
}) {
	const panelWidth = useEditorChatPanelWidth();

	const startConversation = async (message: SubmittedMessage) => {
		const chatId = await session.start(message);
		onChatStarted?.(chatId);
	};

	const resizeHandle = <EditorChatPanelResizeHandle {...panelWidth} isOpen={isOpen} onOpenChange={onOpenChange} />;

	if (!isOpen) {
		return <CollapsedPanel resizeHandle={resizeHandle} onOpen={() => onOpenChange(true)} />;
	}

	return (
		<aside
			data-selection-ignore
			style={{ width: panelWidth.width }}
			className='relative flex h-full max-w-full shrink-0 flex-col border-l bg-background max-lg:absolute max-lg:inset-y-0 max-lg:right-0 max-lg:z-30 max-lg:shadow-xl'
		>
			{resizeHandle}
			<PanelHeader
				canStartNewConversation={Boolean(session.current)}
				onNewConversation={session.startOver}
				onCollapse={() => onOpenChange(false)}
			/>
			{session.isLoading ? (
				<div className='flex flex-1 items-center justify-center'>
					<Spinner className='size-4 opacity-50' />
				</div>
			) : session.current ? (
				<SessionChat
					key={session.current.chatId}
					session={session.current}
					placeholder={copy.placeholder}
					getRequestBody={getRequestBody}
					sessionEffects={sessionEffects}
					onPendingMessageSent={session.clearPendingMessage}
				/>
			) : (
				<EmptyConversation
					copy={copy}
					isStarting={session.isStarting}
					hasStartFailed={session.hasStartFailed}
					onStart={startConversation}
				/>
			)}
		</aside>
	);
}

/** Resumes the latest conversation of the page, until the user starts a new one. */
export function useEditorChatSession({
	latestChatId,
	isLoadingLatestChat,
	startChat,
	isStarting,
	hasStartFailed,
}: {
	latestChatId: string | null | undefined;
	isLoadingLatestChat: boolean;
	startChat: () => Promise<{ chatId: string }>;
	isStarting: boolean;
	hasStartFailed: boolean;
}) {
	const [chosenSession, setChosenSession] = useState<EditorChatSession | null | undefined>(undefined);
	const resumedSession = latestChatId ? { chatId: latestChatId, isResumed: true } : null;

	const start = async (message: SubmittedMessage) => {
		const { chatId } = await startChat();
		setChosenSession({ chatId, pendingMessage: message, isResumed: false });
		return chatId;
	};

	const clearPendingMessage = useCallback(() => {
		setChosenSession((current) => (current ? { ...current, pendingMessage: undefined } : current));
	}, []);

	return {
		current: chosenSession === undefined ? resumedSession : chosenSession,
		isLoading: chosenSession === undefined && isLoadingLatestChat,
		isStarting,
		hasStartFailed,
		start,
		startOver: () => setChosenSession(null),
		clearPendingMessage,
	};
}

/** Opens the editing chat while the panel is closed: a labelled button in a page header, or an icon in a tab bar. */
export function OpenEditorChatButton({
	isOpen,
	isCompact = false,
	onOpen,
}: {
	isOpen: boolean;
	isCompact?: boolean;
	onOpen: () => void;
}) {
	if (isOpen) {
		return null;
	}
	if (isCompact) {
		return (
			<Tooltip>
				<TooltipTrigger asChild>
					<Button variant='ghost' size='icon-xs' aria-label={PANEL_TITLE} onClick={onOpen}>
						<MessageCircle />
					</Button>
				</TooltipTrigger>
				<TooltipContent>{PANEL_TITLE}</TooltipContent>
			</Tooltip>
		);
	}
	return (
		<Button variant='outline' onClick={onOpen}>
			<MessageCircle className='size-4' />
			{PANEL_TITLE}
		</Button>
	);
}

export function toPromptSuggestions(prompts: string[]): PromptSuggestion[] {
	return prompts.map((prompt) => ({ label: prompt, prompt }));
}

function SessionChat({
	session,
	placeholder,
	getRequestBody,
	sessionEffects,
	onPendingMessageSent,
}: {
	session: EditorChatSession;
	placeholder: string;
	getRequestBody: () => Record<string, unknown>;
	sessionEffects?: (session: EditorChatSession) => ReactNode;
	onPendingMessageSent: () => void;
}) {
	return (
		<ChatIdContext.Provider value={session.chatId}>
			<SetChatInputCallbackProvider>
				<AgentProvider disableNavigation getRequestBody={getRequestBody}>
					<PendingMessageSender message={session.pendingMessage} onSent={onPendingMessageSent} />
					{sessionEffects?.(session)}
					<Conversation className='min-h-0 flex-1'>
						<ConversationContent className='gap-0 px-4 py-3 md:px-4 md:py-3'>
							<ChatMessagesContent />
						</ConversationContent>
						<ConversationScrollButton />
					</Conversation>
					<ChatInput placeholder={placeholder} adminModeAvailable={false} />
				</AgentProvider>
			</SetChatInputCallbackProvider>
		</ChatIdContext.Provider>
	);
}

/** No conversation exists yet: the first message creates it, then is sent in it. */
function EmptyConversation({
	copy,
	isStarting,
	hasStartFailed,
	onStart,
}: {
	copy: EditorChatCopy;
	isStarting: boolean;
	hasStartFailed: boolean;
	onStart: (message: SubmittedMessage) => Promise<void>;
}) {
	const isMountedRef = useIsMountedRef();

	const startOrRestoreMessage = async (message: SubmittedMessage) => {
		try {
			await onStart(message);
		} catch {
			if (isMountedRef.current) {
				chatInputRestoreStore.set(toChatInputRestore(message));
			}
		}
	};

	return (
		<SetChatInputCallbackProvider>
			<AgentProvider disableNavigation>
				<div className='flex min-h-0 flex-1 flex-col overflow-auto'>
					<div className='mt-auto grid gap-4 py-4'>
						<div className='grid gap-1 px-4'>
							<p className='font-medium'>{copy.introTitle}</p>
							<p className='text-sm text-muted-foreground'>{copy.introDescription}</p>
						</div>
						<PromptSuggestions title={SUGGESTIONS_TITLE} suggestions={copy.suggestions} />
					</div>
				</div>
				{hasStartFailed && (
					<p role='alert' className='px-4 pb-2 text-xs text-destructive'>
						{START_ERROR_MESSAGE}
					</p>
				)}
				<div inert={isStarting} className={cn('transition-opacity', isStarting && 'opacity-60')}>
					<ChatInput
						placeholder={copy.placeholder}
						adminModeAvailable={false}
						onSubmitMessage={startOrRestoreMessage}
					/>
				</div>
			</AgentProvider>
		</SetChatInputCallbackProvider>
	);
}

function PanelHeader({
	canStartNewConversation,
	onNewConversation,
	onCollapse,
}: {
	canStartNewConversation: boolean;
	onNewConversation: () => void;
	onCollapse: () => void;
}) {
	return (
		<div className='flex items-center gap-2 border-b px-4 py-2.5'>
			<MessageCircle className='size-4 text-muted-foreground' strokeWidth={2.25} />
			<span className='text-sm font-medium'>{PANEL_TITLE}</span>
			<div className='ml-auto flex items-center gap-0.5'>
				{canStartNewConversation && (
					<PanelIconButton label='New conversation' onClick={onNewConversation}>
						<SquarePen />
					</PanelIconButton>
				)}
				<PanelIconButton label='Hide the chat' onClick={onCollapse}>
					<PanelRightClose />
				</PanelIconButton>
			</div>
		</div>
	);
}

function CollapsedPanel({ resizeHandle, onOpen }: { resizeHandle: ReactNode; onOpen: () => void }) {
	return (
		<div className='relative flex shrink-0 flex-col items-center border-l bg-background px-1.5 py-2.5 max-lg:absolute max-lg:right-0 max-lg:top-0 max-lg:z-30 max-lg:border-none max-lg:bg-transparent'>
			{resizeHandle}
			<PanelIconButton label={PANEL_TITLE} onClick={onOpen}>
				<PanelRightOpen />
			</PanelIconButton>
		</div>
	);
}

function PanelIconButton({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
	return (
		<Tooltip delayDuration={150}>
			<TooltipTrigger asChild>
				<Button variant='ghost' size='icon-xs' className='rounded-full' onClick={onClick} aria-label={label}>
					{children}
				</Button>
			</TooltipTrigger>
			<TooltipContent>{label}</TooltipContent>
		</Tooltip>
	);
}

/** The restore store is read by any chat input, so a start failing after the panel is gone must not write to it. */
function useIsMountedRef() {
	const isMountedRef = useRef(false);

	useEffect(() => {
		isMountedRef.current = true;
		return () => {
			isMountedRef.current = false;
		};
	}, []);

	return isMountedRef;
}

/** The input clears itself as it hands a message over, so a message that could not be sent is written back. */
function toChatInputRestore({
	text,
	images = [],
	documents = [],
	citations,
	mentions,
}: SubmittedMessage): ChatInputRestore {
	return {
		text,
		images: images.map(({ mediaType, data }) => ({ mediaType, url: `data:${mediaType};base64,${data}` })),
		documents,
		citations,
		mentions,
	};
}
