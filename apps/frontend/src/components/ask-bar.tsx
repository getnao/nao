import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { ArrowUp, ChevronDown, ChevronUp, Loader2, Maximize2, MessageCircle, X } from 'lucide-react';
import { MAX_CITATIONS_PER_MESSAGE } from '@nao/shared/types';
import type { FormEvent, ReactNode, RefObject } from 'react';
import type { PromptHandle } from 'prompt-mentions';
import type { UIMessage } from '@nao/backend/chat';

import type { CitationData } from '@nao/shared/types';
import type { SelectionData } from '@/components/highlight-bubble';
import type { AskQuestion, AskSelection } from '@/stores/ask-bar';
import type { PendingCitation } from '@/stores/chat-pending-citation';
import { ChatInputAnimatedBorder } from '@/components/chat-input-animated-border';
import { ChatPrompt } from '@/components/chat-input-prompt';
import { ChatMessagesContent } from '@/components/chat-messages/chat-messages';
import { CitationPillPreview } from '@/components/citation-pill-preview';
import { HighlightBubble } from '@/components/highlight-bubble';
import { Button } from '@/components/ui/button';
import { Conversation, ConversationContent, ConversationScrollButton } from '@/components/ui/conversation';
import { TextShimmer } from '@/components/ui/text-shimmer';
import { AgentProvider, useAgentContext, useAgentMessages } from '@/contexts/agent.provider';
import { SetChatInputCallbackProvider, useRegisterSetChatInputCallback } from '@/contexts/set-chat-input-callback';
import { SelectionProvider } from '@/contexts/text-selection';
import { ChatIdContext, useChatId } from '@/hooks/use-chat-id';
import { useCitationPills } from '@/hooks/use-citation-pills';
import { useIsPromptMultiline } from '@/hooks/use-is-prompt-multiline';
import { useOpenCitation } from '@/hooks/use-open-citation';
import { capCitationText, isSameCitation } from '@/lib/citation-mention';
import { cn } from '@/lib/utils';
import { toAskCitation, useAskRequest } from '@/stores/ask-bar';
import { toMessageCitations } from '@/stores/chat-pending-citation';

type AskSession = {
	chatId: string | null;
	/** What the next message quotes: each Ask on the page or in the answers adds one, as a pill in the input. */
	citations: PendingCitation[];
	pendingText?: string;
	pendingCitations?: CitationData[];
	isPanelOpen: boolean;
};

interface AskMessage {
	text: string;
	citations: CitationData[];
}

const NO_SESSION: AskSession = { chatId: null, citations: [], isPanelOpen: false };
const ASK_ERROR_MESSAGE = "Couldn't ask this question. Try again.";

/**
 * A floating input at the bottom of the page: asking opens the conversation in a panel beside the content;
 * folded, the panel becomes a pill above the input. The page decides how the chat of a question is created.
 */
export function AskBar({
	placeholder,
	isInputHidden = false,
	isAsking,
	hasAskFailed,
	resumedQuestion,
	onAsk,
	onEnd,
	children,
}: {
	placeholder: string;
	isInputHidden?: boolean;
	isAsking: boolean;
	hasAskFailed: boolean;
	/** A question to reopen with its panel open as the bar mounts. */
	resumedQuestion?: AskQuestion;
	/** Creates the chat of a new question and returns its id. */
	onAsk: (citations: CitationData[]) => Promise<string>;
	onEnd?: () => void;
	/** Rendered within the agent of the question, to react to its answers. */
	children?: ReactNode;
}) {
	const [session, setSession] = useState<AskSession>(() =>
		resumedQuestion ? { ...resumedQuestion, citations: [], isPanelOpen: true } : NO_SESSION,
	);
	const inputRef = useRef<PromptHandle>(null);
	const request = useAskRequest();
	const requestIdAtMount = useRef(request?.id);

	const cite = (selection: AskSelection) => setSession((current) => withCitation(current, toAskCitation(selection)));

	useEffect(() => {
		if (!request || request.id === requestIdAtMount.current) {
			return;
		}
		const { chatId, selection } = request;
		if (chatId) {
			setSession({ chatId, citations: [], isPanelOpen: true });
		} else if (selection) {
			setSession((current) => withCitation(current, toAskCitation(selection)));
		}
		inputRef.current?.focus();
	}, [request]);

	const startSession = async (message: AskMessage) => {
		const chatId = await onAsk(message.citations);
		setSession((current) => ({
			...current,
			chatId,
			pendingText: message.text,
			pendingCitations: message.citations,
			citations: [],
			isPanelOpen: true,
		}));
	};
	const setPanelOpen = (isPanelOpen: boolean) => setSession((current) => ({ ...current, isPanelOpen }));
	const removeCitation = (id: string) =>
		setSession((current) => ({
			...current,
			citations: current.citations.filter((citation) => citation.id !== id),
		}));
	const clearCitations = () => setSession((current) => ({ ...current, citations: [] }));
	const endSession = () => {
		onEnd?.();
		setSession(NO_SESSION);
	};
	const citationControls = {
		citations: session.citations,
		onRemoveCitation: removeCitation,
		onCitationsSent: clearCitations,
	};

	if (!session.chatId) {
		return (
			<FloatingBar isHidden={isInputHidden}>
				<AskInput
					promptRef={inputRef}
					placeholder={placeholder}
					citations={session.citations}
					isSending={isAsking}
					error={hasAskFailed ? ASK_ERROR_MESSAGE : undefined}
					onRemoveCitation={removeCitation}
					onSubmit={startSession}
				/>
			</FloatingBar>
		);
	}

	return (
		<ChatIdContext.Provider value={session.chatId}>
			<SetChatInputCallbackProvider>
				<AgentProvider disableNavigation>
					<PendingMessageSender
						pendingText={session.pendingText}
						pendingCitations={session.pendingCitations}
						onSent={() =>
							setSession((current) => ({
								...current,
								pendingText: undefined,
								pendingCitations: undefined,
							}))
						}
					/>
					{children}
					{session.isPanelOpen ? (
						<AskPanel
							{...citationControls}
							placeholder={placeholder}
							onCite={cite}
							onCollapse={() => setPanelOpen(false)}
							onClose={endSession}
						/>
					) : (
						<FloatingBar isHidden={isInputHidden}>
							<AskStatus onOpen={() => setPanelOpen(true)} onClose={endSession} />
							<SessionInput {...citationControls} promptRef={inputRef} placeholder={placeholder} />
						</FloatingBar>
					)}
				</AgentProvider>
			</SetChatInputCallbackProvider>
		</ChatIdContext.Provider>
	);
}

function FloatingBar({ isHidden, children }: { isHidden: boolean; children: ReactNode }) {
	return (
		<div
			data-selection-ignore
			className={cn(
				'pointer-events-none absolute inset-x-0 bottom-0 z-20 flex justify-center px-4 pb-4',
				isHidden && 'hidden',
			)}
		>
			<div className='pointer-events-auto flex w-full max-w-2xl flex-col items-center gap-2'>{children}</div>
		</div>
	);
}

/** Sends the first message once the new quick question is mounted. */
function PendingMessageSender({
	pendingText,
	pendingCitations,
	onSent,
}: {
	pendingText?: string;
	pendingCitations?: CitationData[];
	onSent: () => void;
}) {
	const { queueOrSendMessage } = useAgentContext();
	const sentText = useRef<string | null>(null);

	useEffect(() => {
		if (!pendingText || sentText.current === pendingText) {
			return;
		}
		sentText.current = pendingText;
		onSent();
		void queueOrSendMessage({ text: pendingText, citations: nonEmpty(pendingCitations) });
	}, [pendingText, pendingCitations, onSent, queueOrSendMessage]);

	return null;
}

/** The folded panel: the agent at work, then the answers ready to read, as a pill above the input. */
function AskStatus({ onOpen, onClose }: { onOpen: () => void; onClose: () => void }) {
	const messages = useAgentMessages();
	const { isRunning } = useAgentContext();
	const questionCount = countQuestions(messages);
	if (questionCount === 0) {
		return null;
	}

	return (
		<div className='flex items-center gap-1 rounded-full border bg-background py-0.5 pl-3 pr-1 text-xs text-muted-foreground'>
			<button type='button' onClick={onOpen} className='flex items-center gap-1.5 hover:text-foreground'>
				{isRunning ? (
					<TextShimmer showLogo />
				) : (
					<>
						<MessageCircle className='size-3.5 overflow-visible' strokeWidth={2.25} />
						<span>{questionCount === 1 ? 'Answer ready · Show' : `${questionCount} answers · Show`}</span>
						<ChevronUp className='size-3.5' strokeWidth={2.25} />
					</>
				)}
			</button>
			<Button
				variant='ghost'
				size='icon-xs'
				className='rounded-full'
				onClick={onClose}
				aria-label='End this question'
			>
				<X />
			</Button>
		</div>
	);
}

interface CitationControls {
	citations: PendingCitation[];
	onRemoveCitation: (id: string) => void;
	onCitationsSent: () => void;
}

function SessionInput({
	promptRef,
	placeholder,
	citations,
	onRemoveCitation,
	onCitationsSent,
}: CitationControls & {
	promptRef: RefObject<PromptHandle | null>;
	placeholder: string;
}) {
	const { isRunning } = useAgentContext();
	const send = useSendWithCitations(onCitationsSent);
	return (
		<AskInput
			promptRef={promptRef}
			placeholder={placeholder}
			citations={citations}
			isSending={isRunning}
			onRemoveCitation={onRemoveCitation}
			onSubmit={send}
		/>
	);
}

/** A follow-up quotes the citations added since the last message, then the input starts without any. */
function useSendWithCitations(onCitationsSent: () => void) {
	const { queueOrSendMessage } = useAgentContext();
	return ({ text, citations }: AskMessage) => {
		void queueOrSendMessage({ text, citations: nonEmpty(citations) });
		onCitationsSent();
	};
}

/**
 * The whole quick question beside the content, rendered like any chat, with its own input.
 * Text selected in its answers can be asked about too, like text on the page.
 */
function AskPanel({
	placeholder,
	citations,
	onRemoveCitation,
	onCitationsSent,
	onCite,
	onCollapse,
	onClose,
}: CitationControls & {
	placeholder: string;
	onCite: (selection: AskSelection) => void;
	onCollapse: () => void;
	onClose: () => void;
}) {
	const panelInputRef = useRef<PromptHandle>(null);
	const { isRunning } = useAgentContext();
	const send = useSendWithCitations(onCitationsSent);

	useEffect(() => {
		panelInputRef.current?.focus();
	}, []);

	return (
		<AskPanelFrame onCollapse={onCollapse} onClose={onClose}>
			<SelectionProvider>
				<HighlightBubble onAsk={({ text }: SelectionData) => onCite({ text })} />
				<Conversation className='min-h-0'>
					<ConversationContent className='gap-0 px-4 py-3 md:px-4 md:py-3'>
						<ChatMessagesContent />
					</ConversationContent>
					<ConversationScrollButton />
				</Conversation>
			</SelectionProvider>
			<div className='border-t p-3' data-selection-ignore>
				<AskInput
					promptRef={panelInputRef}
					placeholder={placeholder}
					citations={citations}
					isSending={isRunning}
					fillsFromFollowUps
					onRemoveCitation={onRemoveCitation}
					onSubmit={send}
				/>
			</div>
		</AskPanelFrame>
	);
}

/** The panel beside the content, headed by its controls. The page's own selection leaves it out. */
function AskPanelFrame({
	onCollapse,
	onClose,
	children,
}: {
	onCollapse?: () => void;
	onClose: () => void;
	children: ReactNode;
}) {
	return (
		<aside
			data-selection-ignore
			className='absolute inset-y-3 right-3 z-30 flex w-[min(420px,calc(100%-1.5rem))] flex-col overflow-hidden rounded-2xl border bg-background shadow-xl'
		>
			<AskPanelHeader onCollapse={onCollapse} onClose={onClose} />
			{children}
		</aside>
	);
}

/** Lets the user read the quick question as a full chat, fold it back into the pill, or end it. */
function AskPanelHeader({ onCollapse, onClose }: { onCollapse?: () => void; onClose: () => void }) {
	const chatId = useChatId();
	const navigate = useNavigate();

	return (
		<div className='flex items-center gap-2 border-b px-4 py-2.5'>
			<MessageCircle className='size-4 text-muted-foreground' strokeWidth={2.25} />
			<span className='text-sm font-medium'>Quick question</span>
			<div className='ml-auto flex items-center gap-0.5'>
				{chatId && (
					<Button
						variant='ghost'
						size='icon-xs'
						className='rounded-full'
						onClick={() => navigate({ to: '/$chatId', params: { chatId } })}
						aria-label='Open as a chat'
					>
						<Maximize2 />
					</Button>
				)}
				{onCollapse && (
					<Button
						variant='ghost'
						size='icon-xs'
						className='rounded-full'
						onClick={onCollapse}
						aria-label='Fold the answers'
					>
						<ChevronDown />
					</Button>
				)}
				<Button
					variant='ghost'
					size='icon-xs'
					className='rounded-full'
					onClick={onClose}
					aria-label='End this question'
				>
					<X />
				</Button>
			</div>
		</div>
	);
}

function AskInput({
	promptRef,
	placeholder,
	citations,
	isSending,
	fillsFromFollowUps = false,
	error,
	onRemoveCitation,
	onSubmit,
}: {
	promptRef: RefObject<PromptHandle | null>;
	placeholder: string;
	citations: PendingCitation[];
	isSending: boolean;
	/** Follow-up suggestions of the conversation fill the input, as they do in a chat. */
	fillsFromFollowUps?: boolean;
	error?: string;
	onRemoveCitation: (id: string) => void;
	/** The input keeps the text when the submit fails, so the question can be sent again. */
	onSubmit: (message: AskMessage) => void | Promise<void>;
}) {
	const formRef = useRef<HTMLFormElement>(null);
	const [value, setValue] = useState('');
	const citationPills = useCitationPills({
		promptRef,
		containerRef: formRef,
		citations,
		onRemove: onRemoveCitation,
	});
	const hasText = value.trim().length > 0;
	const isMultiline = useIsPromptMultiline(formRef);
	const openCitation = useOpenCitation();
	const findCitation = useCallback((id: string) => citations.find((citation) => citation.id === id), [citations]);

	const submit = (event?: FormEvent) => {
		event?.preventDefault();
		const text = value.trim();
		if (!text || isSending) {
			return;
		}
		Promise.resolve(onSubmit(toMessageCitations(citations, text)))
			.then(() => {
				promptRef.current?.clear();
				setValue('');
			})
			.catch(() => undefined);
	};

	const fill = (text: string) => {
		promptRef.current?.clear();
		promptRef.current?.insertText(text);
		setValue(text);
	};

	return (
		<form
			ref={formRef}
			onSubmit={submit}
			className={cn(
				'relative flex w-full items-end gap-2 bg-background p-2 pl-3 shadow-lg',
				citations.length > 0 || isMultiline ? 'rounded-2xl' : 'rounded-full',
			)}
		>
			<ChatInputAnimatedBorder isStatic />
			{fillsFromFollowUps && <FollowUpFiller onFill={fill} />}
			<CitationPillPreview containerRef={formRef} findCitation={findCitation} onOpen={openCitation} />
			<div className='flex min-w-0 flex-1 items-end gap-2'>
				<ChatPrompt
					promptRef={promptRef}
					placeholder={placeholder}
					compact
					storyCreationEnabled={false}
					citationOptions={citationPills.options}
					onChange={(nextValue) => setValue(nextValue)}
					onEnter={() => submit()}
					onMentionDeleted={citationPills.handleMentionDeleted}
				/>
				<Button
					type='submit'
					size='icon-sm'
					className={cn('mb-0.75 shrink-0 rounded-full', !hasText && 'opacity-50')}
					disabled={!hasText || isSending}
					aria-label='Send'
				>
					{isSending ? <Loader2 className='animate-spin' /> : <ArrowUp />}
				</Button>
			</div>
			{error && (
				<p role='alert' className='px-2 text-xs text-destructive'>
					{error}
				</p>
			)}
		</form>
	);
}

function FollowUpFiller({ onFill }: { onFill: (text: string) => void }) {
	useRegisterSetChatInputCallback(onFill);
	return null;
}

/** Messages carried over from another chat are left out: the user never wrote them here. */
function countQuestions(messages: UIMessage[]): number {
	return messages.filter((message) => message.role === 'user' && !message.isForked).length;
}

function withCitation(session: AskSession, incoming: CitationData): AskSession {
	const citation = capCitationText(incoming);
	const isDuplicate = session.citations.some((cited) => isSameCitation(cited, citation));
	if (isDuplicate || session.citations.length >= MAX_CITATIONS_PER_MESSAGE) {
		return session;
	}
	return { ...session, citations: [...session.citations, { ...citation, id: crypto.randomUUID() }] };
}

function nonEmpty(citations: CitationData[] | undefined): CitationData[] | undefined {
	return citations && citations.length > 0 ? citations : undefined;
}
