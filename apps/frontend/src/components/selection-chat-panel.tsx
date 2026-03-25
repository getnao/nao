import { Chat, useChat } from '@ai-sdk/react';
import { DefaultChatTransport } from 'ai';
import { ChevronDown, MessageCircle } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import type { UIMessage } from '@nao/backend/chat';
import type { MentionOption } from 'prompt-mentions';

import type { SelectionAnchor } from '@/contexts/selection';
import { Button } from '@/components/ui/button';
import { ChatInputInline } from '@/components/chat-input';
import { ChatMessagesContent } from '@/components/chat-messages/chat-messages';
import { Conversation, ConversationContent, ConversationScrollButton } from '@/components/ui/conversation';
import { SelectionAgentProvider } from '@/contexts/agent.provider';
import { useSelection } from '@/contexts/selection';
import { selectedModelStorage } from '@/hooks/use-agent';
import { useLocalStorage } from '@/hooks/use-local-storage';

export const SelectionChatPanel = () => {
	const { anchors, openAnchorId, closePanel, reopenAnchor } = useSelection();
	const openAnchor = openAnchorId ? (anchors.find((a) => a.id === openAnchorId) ?? null) : null;

	return (
		<>
			{openAnchor && createPortal(<PanelContainer anchor={openAnchor} onClose={closePanel} />, document.body)}
			{createPortal(
				<AnchorDots anchors={anchors} openAnchorId={openAnchorId} onOpen={reopenAnchor} />,
				document.body,
			)}
		</>
	);
};

function AnchorDots({
	anchors,
	openAnchorId,
	onOpen,
}: {
	anchors: SelectionAnchor[];
	openAnchorId: string | null;
	onOpen: (id: string) => void;
}) {
	return (
		<>
			{anchors
				.filter((a) => a.id !== openAnchorId)
				.map((anchor) => (
					<AnchorDot key={anchor.id} anchor={anchor} onOpen={() => onOpen(anchor.id)} />
				))}
		</>
	);
}

function AnchorDot({ anchor, onOpen }: { anchor: SelectionAnchor; onOpen: () => void }) {
	const left = anchor.rect.left - 14;
	const top = anchor.rect.top + anchor.rect.height / 2;

	return (
		<button
			type='button'
			title='View conversation'
			style={{ position: 'fixed', left, top, transform: 'translateX(-50%) translateY(-50%)', zIndex: 40 }}
			onClick={onOpen}
			onMouseDown={(e) => e.stopPropagation()}
			className='hover:scale-125 transition-transform cursor-pointer'
		>
			<MessageCircle className='size-3.5 text-foreground' />
		</button>
	);
}

function PanelContainer({ anchor, onClose }: { anchor: SelectionAnchor; onClose: () => void }) {
	const { updateAnchorMessages } = useSelection();

	const handleMessagesChange = useCallback(
		(messages: UIMessage[]) => {
			updateAnchorMessages(anchor.id, messages);
		},
		[anchor.id, updateAnchorMessages],
	);

	return (
		<div className='fixed right-4 top-20 bottom-10 w-[400px] z-50 flex flex-col items-center'>
			<ChatPanelContent key={anchor.id} anchor={anchor} onMessagesChange={handleMessagesChange} />
			<Button
				onClick={onClose}
				variant='ghost-no-hover'
				className='
					absolute right-10 translate-x-1/2 bottom-[-32px]
					w-10 h-10
					flex items-center justify-center
					rounded-full
					bg-background border border-border shadow-md
					hover:bg-accent transition-colors
				'
			>
				<ChevronDown className='size-5' />
			</Button>
		</div>
	);
}

function ChatPanelContent({
	anchor,
	onMessagesChange,
}: {
	anchor: SelectionAnchor;
	onMessagesChange: (messages: UIMessage[]) => void;
}) {
	const onMessagesChangeRef = useRef(onMessagesChange);
	onMessagesChangeRef.current = onMessagesChange;

	// Model selection — shared via localStorage with the main chat
	const [selectedModel, setSelectedModel] = useLocalStorage(selectedModelStorage);
	// Ref keeps prepareSendMessagesRequest up-to-date without recreating the Chat instance
	const selectedModelRef = useRef(selectedModel);
	selectedModelRef.current = selectedModel;

	// Mentions captured between setMentions() and prepareSendMessagesRequest()
	const mentionsRef = useRef<MentionOption[]>([]);

	const chatRef = useRef<Chat<UIMessage> | null>(null);
	const chatInstance = useMemo(() => {
		const instance = new Chat<UIMessage>({
			transport: new DefaultChatTransport({
				api: '/api/ask-selection',
				prepareSendMessagesRequest: ({ body, messages }) => {
					const mentions = mentionsRef.current;
					mentionsRef.current = [];
					return {
						body: {
							...body,
							systemContext: anchor.contentText,
							messages,
							model: selectedModelRef.current ?? undefined,
							mentions: mentions.length > 0 ? mentions : undefined,
						},
					};
				},
			}),
		});
		chatRef.current = instance;
		return instance;
		// anchor.contentText is stable per anchor and captured correctly on first mount
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [anchor.id]);

	const { messages, sendMessage, setMessages, status } = useChat({ chat: chatInstance });

	useEffect(() => {
		if (anchor.messages.length > 0) {
			setMessages(anchor.messages);
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	useEffect(() => {
		if (messages.length > 0) {
			onMessagesChangeRef.current(messages);
		}
	}, [messages]);

	const isRunning = status === 'streaming' || status === 'submitted';

	const handleSendMessage = useCallback(
		async ({ text }: { text: string }) => {
			await sendMessage({ text });
		},
		[sendMessage],
	);

	const handleSetMentions = useCallback((mentions: MentionOption[]) => {
		mentionsRef.current = mentions;
	}, []);

	return (
		<div
			className='flex flex-col bg-panel border border-border shadow-xl rounded-2xl
					fixed right-4 top-20 bottom-15 w-[400px] z-50 overflow-hidden'
			onMouseDown={(e) => e.stopPropagation()}
		>
			<PanelHeader anchor={anchor} />
			<SelectionAgentProvider
				messages={messages}
				isRunning={isRunning}
				status={status}
				sendMessage={handleSendMessage}
				stopAgent={() => chatRef.current?.stop()}
				selectedModel={selectedModel}
				setSelectedModel={setSelectedModel}
				setMentions={handleSetMentions}
			>
				<Conversation>
					<ConversationContent className='gap-0 p-4'>
						<ChatMessagesContent />
					</ConversationContent>
					<ConversationScrollButton />
				</Conversation>
				<ChatInputInline initialText='' onSubmitMessage={handleSendMessage} />
			</SelectionAgentProvider>
		</div>
	);
}
function PanelHeader({ anchor }: { anchor: SelectionAnchor }) {
	const displayed = anchor.text.length > 220 ? `${anchor.text.slice(0, 220)}\u2026` : anchor.text;

	return (
		<div className='mx-4 my-3 px-4 py-3 border-b border-border bg-background shrink-0 rounded-lg'>
			<div className='flex items-center justify-between mb-1.5'>
				<p className='text-[11px] text-muted-foreground font-mono tracking-tight'>
					@chars {anchor.start}–{anchor.end}
				</p>
			</div>
			<blockquote className='text-xs text-foreground/80 italic leading-relaxed line-clamp-3 border-l-2 border-primary/50 pl-3'>
				&ldquo;{displayed}&rdquo;
			</blockquote>
		</div>
	);
}
