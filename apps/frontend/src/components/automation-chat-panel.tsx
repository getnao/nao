import { useCallback, useEffect, useRef, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { MessageCircle, PanelRightClose, PanelRightOpen, SquarePen } from 'lucide-react';
import type { ReactNode, RefObject } from 'react';
import type { AutomationFormHandle } from '@/components/automations-form';
import type { PromptSuggestion } from '@/components/prompt-suggestions';

import type { SubmittedMessage } from '@/hooks/use-agent';
import type { HandledDraftUpdates } from '@/hooks/use-automation-draft-updates';
import type { ChatInputRestore } from '@/stores/chat-input-restore';
import { PendingMessageSender } from '@/components/ask-bar';
import {
	AutomationChatPanelResizeHandle,
	useAutomationChatPanelWidth,
} from '@/components/automation-chat-panel-resize-handle';
import { ChatInput } from '@/components/chat-input';
import { PromptSuggestions } from '@/components/prompt-suggestions';
import { Button } from '@/components/ui/button';
import { Conversation, ConversationContent, ConversationScrollButton } from '@/components/ui/conversation';
import { Spinner } from '@/components/ui/spinner';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { AgentProvider } from '@/contexts/agent.provider';
import { SetChatInputCallbackProvider } from '@/contexts/set-chat-input-callback';
import { ChatMessagesContent } from '@/components/chat-messages/chat-messages';
import { useAutomationDraftUpdates } from '@/hooks/use-automation-draft-updates';
import { ChatIdContext } from '@/hooks/use-chat-id';
import { useLocalStorage } from '@/hooks/use-local-storage';
import { createLocalStorage } from '@/lib/local-storage';
import { cn } from '@/lib/utils';
import { trpc } from '@/main';
import { chatInputRestoreStore } from '@/stores/chat-input-restore';

interface ChatSession {
	chatId: string;
	pendingMessage?: SubmittedMessage;
	/** A conversation from an earlier visit, whose changes the form already received. */
	isResumed: boolean;
}

const PLACEHOLDER = 'Ask to change the automation...';
const START_ERROR_MESSAGE = "Couldn't start the conversation. Try again.";

const SUGGESTIONS_TITLE = 'Suggested ideas';

const NEW_AUTOMATION_SUGGESTIONS = toSuggestions([
	'Every Monday at 9am, email me a summary of last week’s key metrics',
	'Help me write the instructions for a daily report',
	'Post a Slack alert when yesterday’s revenue drops more than 10%',
]);

const EXISTING_AUTOMATION_SUGGESTIONS = toSuggestions([
	'Why did the last runs fail?',
	'Make the report shorter and easier to scan',
	'Run it on weekdays at 8am instead',
]);

const panelOpenStorage = createLocalStorage('nao-automation-chat-panel-open', true);

/** The panel's open state is remembered across automations. */
export function useAutomationChatPanelOpen() {
	return useLocalStorage(panelOpenStorage);
}

/**
 * A chat beside an automation's form, whose agent reads the form and changes it.
 * Changes stay unsaved in the form until the user saves it.
 */
export function AutomationChatPanel({
	automationId,
	formHandleRef,
	isOpen,
	onOpenChange,
	onChatStarted,
}: {
	/** Absent while the automation is being created. */
	automationId?: string;
	formHandleRef: RefObject<AutomationFormHandle | null>;
	isOpen: boolean;
	onOpenChange: (isOpen: boolean) => void;
	onChatStarted?: (chatId: string) => void;
}) {
	const session = useAutomationChatSession(automationId);
	const handledUpdatesRef = useRef<HandledDraftUpdates>(new Map());
	const panelWidth = useAutomationChatPanelWidth();

	const startConversation = async (message: SubmittedMessage) => {
		const chatId = await session.start(message);
		onChatStarted?.(chatId);
	};

	const resizeHandle = (
		<AutomationChatPanelResizeHandle {...panelWidth} isOpen={isOpen} onOpenChange={onOpenChange} />
	);

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
					formHandleRef={formHandleRef}
					handledUpdates={handledUpdatesRef.current}
					onPendingMessageSent={session.clearPendingMessage}
				/>
			) : (
				<EmptyConversation
					suggestions={automationId ? EXISTING_AUTOMATION_SUGGESTIONS : NEW_AUTOMATION_SUGGESTIONS}
					isStarting={session.isStarting}
					hasStartFailed={session.hasStartFailed}
					onStart={startConversation}
				/>
			)}
		</aside>
	);
}

/** Resumes the latest conversation about the automation, until the user starts a new one. */
function useAutomationChatSession(automationId: string | undefined) {
	const latestChat = useQuery({
		...trpc.automation.latestEditChat.queryOptions({ automationId: automationId ?? '' }),
		enabled: Boolean(automationId),
	});
	const startChat = useMutation(trpc.automation.startEditChat.mutationOptions());
	const [chosenSession, setChosenSession] = useState<ChatSession | null | undefined>(undefined);
	const latestChatId = latestChat.data?.chatId;
	const resumedSession = latestChatId ? { chatId: latestChatId, isResumed: true } : null;

	const start = async (message: SubmittedMessage) => {
		const { chatId } = await startChat.mutateAsync({ automationId });
		setChosenSession({ chatId, pendingMessage: message, isResumed: false });
		return chatId;
	};

	const clearPendingMessage = useCallback(() => {
		setChosenSession((current) => (current ? { ...current, pendingMessage: undefined } : current));
	}, []);

	return {
		current: chosenSession === undefined ? resumedSession : chosenSession,
		isLoading: chosenSession === undefined && latestChat.isLoading && Boolean(automationId),
		isStarting: startChat.isPending,
		hasStartFailed: startChat.isError,
		start,
		startOver: () => setChosenSession(null),
		clearPendingMessage,
	};
}

function SessionChat({
	session,
	formHandleRef,
	handledUpdates,
	onPendingMessageSent,
}: {
	session: ChatSession;
	formHandleRef: RefObject<AutomationFormHandle | null>;
	handledUpdates: HandledDraftUpdates;
	onPendingMessageSent: () => void;
}) {
	const getRequestBody = useCallback(() => ({ automationDraft: formHandleRef.current?.getDraft() }), [formHandleRef]);

	return (
		<ChatIdContext.Provider value={session.chatId}>
			<SetChatInputCallbackProvider>
				<AgentProvider disableNavigation getRequestBody={getRequestBody}>
					<PendingMessageSender message={session.pendingMessage} onSent={onPendingMessageSent} />
					<FormUpdater
						isResumed={session.isResumed}
						formHandleRef={formHandleRef}
						handledUpdates={handledUpdates}
					/>
					<Conversation className='min-h-0 flex-1'>
						<ConversationContent className='gap-0 px-4 py-3 md:px-4 md:py-3'>
							<ChatMessagesContent />
						</ConversationContent>
						<ConversationScrollButton />
					</Conversation>
					<ChatInput placeholder={PLACEHOLDER} adminModeAvailable={false} />
				</AgentProvider>
			</SetChatInputCallbackProvider>
		</ChatIdContext.Provider>
	);
}

function FormUpdater({
	isResumed,
	formHandleRef,
	handledUpdates,
}: {
	isResumed: boolean;
	formHandleRef: RefObject<AutomationFormHandle | null>;
	handledUpdates: HandledDraftUpdates;
}) {
	useAutomationDraftUpdates({
		isResumed,
		handledUpdates,
		onUpdate: (update) => formHandleRef.current?.applyDraftUpdate(update),
	});
	return null;
}

/** No conversation exists yet: the first message creates it, then is sent in it. */
function EmptyConversation({
	suggestions,
	isStarting,
	hasStartFailed,
	onStart,
}: {
	suggestions: PromptSuggestion[];
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
							<p className='font-medium'>Work on this automation with nao</p>
							<p className='text-sm text-muted-foreground'>
								Describe what you want to receive. nao explores your data, writes the instructions and
								sets up the schedule and delivery in the form. You review and save the changes.
							</p>
						</div>
						<PromptSuggestions title={SUGGESTIONS_TITLE} suggestions={suggestions} />
					</div>
				</div>
				{hasStartFailed && (
					<p role='alert' className='px-4 pb-2 text-xs text-destructive'>
						{START_ERROR_MESSAGE}
					</p>
				)}
				<div inert={isStarting} className={cn('transition-opacity', isStarting && 'opacity-60')}>
					<ChatInput
						placeholder={PLACEHOLDER}
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
			<span className='text-sm font-medium'>Edit with chat</span>
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

/** Opens the chat beside an automation's form, for the page header while the panel is closed. */
export function OpenAutomationChatButton({ isOpen, onOpen }: { isOpen: boolean; onOpen: () => void }) {
	if (isOpen) {
		return null;
	}
	return (
		<Button variant='outline' onClick={onOpen}>
			<MessageCircle className='size-4' />
			Edit with chat
		</Button>
	);
}

function CollapsedPanel({ resizeHandle, onOpen }: { resizeHandle: ReactNode; onOpen: () => void }) {
	return (
		<div className='relative flex shrink-0 flex-col items-center border-l bg-background px-1.5 py-2.5 max-lg:absolute max-lg:right-0 max-lg:top-0 max-lg:z-30 max-lg:border-none max-lg:bg-transparent'>
			{resizeHandle}
			<PanelIconButton label='Edit with chat' onClick={onOpen}>
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

function toSuggestions(prompts: string[]): PromptSuggestion[] {
	return prompts.map((prompt) => ({ label: prompt, prompt }));
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
