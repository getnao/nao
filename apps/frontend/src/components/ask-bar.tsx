import { useEffect, useRef, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { ArrowUp, ChevronDown, ChevronUp, Loader2, Maximize2, MessageCircle, X } from 'lucide-react';
import type { FormEvent, ReactNode, RefObject } from 'react';
import type { UIMessage } from '@nao/backend/chat';

import type { AskQuestion, AskSelection } from '@/stores/ask-bar';
import { ChatInputAnimatedBorder } from '@/components/chat-input-animated-border';
import { ChatMessagesContent } from '@/components/chat-messages/chat-messages';
import { SelectionCitationExcerpt } from '@/components/selection-citation-excerpt';
import { Button } from '@/components/ui/button';
import { Conversation, ConversationContent, ConversationScrollButton } from '@/components/ui/conversation';
import { TextShimmer } from '@/components/ui/text-shimmer';
import { AgentProvider, useAgentContext, useAgentMessages } from '@/contexts/agent.provider';
import { SetChatInputCallbackProvider, useRegisterSetChatInputCallback } from '@/contexts/set-chat-input-callback';
import { ChatIdContext, useChatId } from '@/hooks/use-chat-id';
import { cn } from '@/lib/utils';
import { useAskRequest } from '@/stores/ask-bar';

type AskSession = {
	chatId: string | null;
	selection?: AskSelection;
	pendingText?: string;
	isPanelOpen: boolean;
};

const NO_SESSION: AskSession = { chatId: null, isPanelOpen: false };
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
	onAsk: (selection?: AskSelection) => Promise<string>;
	onEnd?: () => void;
	/** Rendered within the agent of the question, to react to its answers. */
	children?: ReactNode;
}) {
	const [session, setSession] = useState<AskSession>(() =>
		resumedQuestion ? { ...resumedQuestion, isPanelOpen: true } : NO_SESSION,
	);
	const inputRef = useRef<HTMLTextAreaElement>(null);
	const request = useAskRequest();
	const requestIdAtMount = useRef(request?.id);

	useEffect(() => {
		if (!request || request.id === requestIdAtMount.current) {
			return;
		}
		if (request.chatId || request.selection) {
			setSession({ chatId: request.chatId, selection: request.selection, isPanelOpen: !!request.chatId });
		}
		inputRef.current?.focus();
	}, [request]);

	const startSession = async (text: string) => {
		const chatId = await onAsk(session.selection);
		setSession((current) => ({ ...current, chatId, pendingText: text, isPanelOpen: true }));
	};
	const setPanelOpen = (isPanelOpen: boolean) => setSession((current) => ({ ...current, isPanelOpen }));
	const endSession = () => {
		onEnd?.();
		setSession(NO_SESSION);
	};

	if (!session.chatId) {
		return (
			<FloatingBar isHidden={isInputHidden}>
				<AskInput
					inputRef={inputRef}
					placeholder={placeholder}
					selection={session.selection}
					isSending={isAsking}
					error={hasAskFailed ? ASK_ERROR_MESSAGE : undefined}
					onClearSelection={endSession}
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
						onSent={() => setSession((current) => ({ ...current, pendingText: undefined }))}
					/>
					{children}
					{session.isPanelOpen ? (
						<AskPanel
							placeholder={placeholder}
							selection={session.selection}
							onCollapse={() => setPanelOpen(false)}
							onClose={endSession}
						/>
					) : (
						<FloatingBar isHidden={isInputHidden}>
							<AskStatus onOpen={() => setPanelOpen(true)} onClose={endSession} />
							<SessionInput inputRef={inputRef} placeholder={placeholder} />
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
function PendingMessageSender({ pendingText, onSent }: { pendingText?: string; onSent: () => void }) {
	const { queueOrSendMessage } = useAgentContext();
	const sentText = useRef<string | null>(null);

	useEffect(() => {
		if (!pendingText || sentText.current === pendingText) {
			return;
		}
		sentText.current = pendingText;
		onSent();
		void queueOrSendMessage({ text: pendingText });
	}, [pendingText, onSent, queueOrSendMessage]);

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

function SessionInput({
	inputRef,
	placeholder,
}: {
	inputRef: RefObject<HTMLTextAreaElement | null>;
	placeholder: string;
}) {
	const { queueOrSendMessage, isRunning } = useAgentContext();
	return (
		<AskInput
			inputRef={inputRef}
			placeholder={placeholder}
			isSending={isRunning}
			onSubmit={(text) => void queueOrSendMessage({ text })}
		/>
	);
}

/** The whole quick question beside the content, rendered like any chat, with its own input. */
function AskPanel({
	placeholder,
	selection,
	onCollapse,
	onClose,
}: {
	placeholder: string;
	selection?: AskSelection;
	onCollapse: () => void;
	onClose: () => void;
}) {
	const panelInputRef = useRef<HTMLTextAreaElement>(null);
	const { queueOrSendMessage, isRunning } = useAgentContext();

	useEffect(() => {
		panelInputRef.current?.focus();
	}, []);

	return (
		<AskPanelFrame selection={selection} onCollapse={onCollapse} onClose={onClose}>
			<Conversation className='min-h-0'>
				<ConversationContent className='gap-0 px-4 py-3 md:px-4 md:py-3'>
					<ChatMessagesContent />
				</ConversationContent>
				<ConversationScrollButton />
			</Conversation>
			<div className='border-t p-3'>
				<AskInput
					inputRef={panelInputRef}
					placeholder={placeholder}
					isSending={isRunning}
					fillsFromFollowUps
					onSubmit={(text) => void queueOrSendMessage({ text })}
				/>
			</div>
		</AskPanelFrame>
	);
}

/** The panel beside the content, headed by its controls and the part of the page the question is about. */
function AskPanelFrame({
	selection,
	onCollapse,
	onClose,
	children,
}: {
	selection?: AskSelection;
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
			{selection && (
				<div className='mt-3 px-4'>
					<SelectionCard selection={selection} />
				</div>
			)}
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
	inputRef,
	placeholder,
	selection,
	isSending,
	fillsFromFollowUps = false,
	error,
	onClearSelection,
	onSubmit,
}: {
	inputRef: RefObject<HTMLTextAreaElement | null>;
	placeholder: string;
	selection?: AskSelection;
	isSending: boolean;
	/** Follow-up suggestions of the conversation fill the input, as they do in a chat. */
	fillsFromFollowUps?: boolean;
	error?: string;
	onClearSelection?: () => void;
	/** The input keeps the text when the submit fails, so the question can be sent again. */
	onSubmit: (text: string) => void | Promise<void>;
}) {
	const [text, setText] = useState('');

	const submit = (event?: FormEvent) => {
		event?.preventDefault();
		const trimmed = text.trim();
		if (!trimmed || isSending) {
			return;
		}
		Promise.resolve(onSubmit(trimmed))
			.then(() => setText(''))
			.catch(() => undefined);
	};

	return (
		<form
			onSubmit={submit}
			className={cn(
				'relative flex w-full flex-col gap-1.5 bg-background p-3 shadow-lg',
				selection ? 'rounded-2xl' : 'rounded-full',
			)}
		>
			<ChatInputAnimatedBorder isStatic />
			{fillsFromFollowUps && <FollowUpFiller onFill={setText} />}
			{selection && <SelectionCard selection={selection} onClear={onClearSelection} />}
			<div className='flex items-center gap-2'>
				<textarea
					ref={inputRef}
					value={text}
					rows={1}
					placeholder={placeholder}
					onChange={(event) => setText(event.target.value)}
					onKeyDown={(event) => {
						if (event.key === 'Enter' && !event.shiftKey) {
							submit(event);
						}
					}}
					className='max-h-32 min-h-8 flex-1 resize-none bg-transparent px-2 py-1.5 text-sm outline-none placeholder:text-muted-foreground'
				/>
				<Button
					type='submit'
					size='icon-sm'
					className={cn('shrink-0 rounded-full', !text.trim() && 'opacity-50')}
					disabled={!text.trim() || isSending}
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

/** The part of the page the question is about, quoted like a selection asked about in a chat. */
function SelectionCard({ selection, onClear }: { selection: AskSelection; onClear?: () => void }) {
	return (
		<div className='relative rounded-xl border bg-sidebar px-4 py-3'>
			<SelectionCitationExcerpt
				text={selection.text}
				start={selection.start}
				end={selection.end}
				block={selection.block}
			/>
			{onClear && (
				<Button
					type='button'
					variant='ghost'
					size='icon-xs'
					className='absolute right-2 top-2 rounded-full'
					onClick={onClear}
					aria-label='Remove the selection'
				>
					<X />
				</Button>
			)}
		</div>
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
