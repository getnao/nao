import { ChevronDown, Maximize2, MessageCircle, MoreHorizontal, Trash, X } from 'lucide-react';
import { useNavigate } from '@tanstack/react-router';
import { createPortal } from 'react-dom';
import { useCallback, useEffect, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import type React from 'react';

import type { SelectionAnchor } from '@/contexts/text-selection';
import { AgentProvider } from '@/contexts/agent.provider';
import { useChatQuery } from '@/queries/use-chat-query';
import { Button } from '@/components/ui/button';
import { ChatInput } from '@/components/chat-input';
import { ChatMessagesContent } from '@/components/chat-messages/chat-messages';
import { Conversation, ConversationContent, ConversationScrollButton } from '@/components/ui/conversation';
import { SetChatInputCallbackProvider } from '@/contexts/set-chat-input-callback';
import { useSelection } from '@/contexts/text-selection';
import { trpc } from '@/main';
import { ChatIdContext } from '@/hooks/use-chat-id';
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

export const SelectionChatPanel = ({ contentAreaRef }: { contentAreaRef?: React.RefObject<HTMLElement | null> }) => {
	const { anchors, openAnchorChatId, openAnchor, closePanel } = useSelection();
	const openAnchor_ = openAnchorChatId ? (anchors.find((a) => a.chatId === openAnchorChatId) ?? null) : null;

	return (
		<>
			{openAnchor_ &&
				createPortal(
					<PanelContainer anchor={openAnchor_} onClose={closePanel} contentAreaRef={contentAreaRef} />,
					document.body,
				)}
			{createPortal(
				<AnchorDots
					anchors={anchors}
					openAnchorChatId={openAnchorChatId}
					onOpen={openAnchor}
					contentAreaRef={contentAreaRef}
				/>,
				document.body,
			)}
		</>
	);
};

function AnchorDots({
	anchors,
	openAnchorChatId,
	onOpen,
	contentAreaRef,
}: {
	anchors: SelectionAnchor[];
	openAnchorChatId: string | null;
	onOpen: (chatId: string) => void;
	contentAreaRef?: React.RefObject<HTMLElement | null>;
}) {
	return (
		<>
			{anchors
				.filter((a) => a.chatId !== openAnchorChatId)
				.map((anchor) => (
					<AnchorDot
						key={anchor.chatId}
						anchor={anchor}
						onOpen={() => onOpen(anchor.chatId)}
						contentAreaRef={contentAreaRef}
					/>
				))}
		</>
	);
}

function AnchorDot({
	anchor,
	onOpen,
	contentAreaRef,
}: {
	anchor: SelectionAnchor;
	onOpen: () => void;
	contentAreaRef?: React.RefObject<HTMLElement | null>;
}) {
	const { measureAnchorPosition, containerRef } = useSelection();

	const [pos, setPos] = useState(() => ({
		left: anchor.containerLeft,
		top: anchor.rect.top + anchor.rect.height / 2,
	}));

	useEffect(() => {
		const update = () => {
			const measured = measureAnchorPosition(anchor.start, anchor.end);
			if (measured) {
				setPos({ left: measured.containerLeft, top: measured.top + measured.height / 2 });
			}
		};

		update();
		window.addEventListener('scroll', update, { capture: true, passive: true });
		window.addEventListener('resize', update, { passive: true });

		const resizeObserver = new ResizeObserver(update);
		const layoutEl = containerRef.current?.parentElement;
		if (layoutEl) {
			resizeObserver.observe(layoutEl);
		}
		if (contentAreaRef?.current) {
			resizeObserver.observe(contentAreaRef.current);
		}

		return () => {
			window.removeEventListener('scroll', update, true);
			window.removeEventListener('resize', update);
			resizeObserver.disconnect();
		};
	}, [anchor.start, anchor.end, measureAnchorPosition, containerRef, contentAreaRef]);

	const ICON_HALF_SIZE = 7;
	const contentAreaRect = contentAreaRef?.current?.getBoundingClientRect();
	const contentAreaTop = contentAreaRect?.top ?? 52;
	const contentAreaLeft = contentAreaRect?.left ?? 0;
	const isHidden = pos.top - ICON_HALF_SIZE < contentAreaTop;
	const dotLeft = contentAreaRef ? Math.max(pos.left, contentAreaLeft + ICON_HALF_SIZE) : pos.left;

	return (
		<button
			type='button'
			title='View conversation'
			style={{
				position: 'fixed',
				left: dotLeft,
				top: pos.top,
				transform: 'translateX(-50%) translateY(-50%)',
				zIndex: 40,
			}}
			onClick={onOpen}
			onMouseDown={(e) => e.stopPropagation()}
			className={`hover:scale-125 transition-transform cursor-pointer ${isHidden ? 'invisible' : ''}`}
		>
			<MessageCircle className='size-3.5 text-foreground' />
		</button>
	);
}

const PANEL_MARGIN = 16;

function usePanelRightOffset(contentAreaRef?: React.RefObject<HTMLElement | null>): number {
	const [rightOffset, setRightOffset] = useState(PANEL_MARGIN);

	useEffect(() => {
		const el = contentAreaRef?.current;
		if (!el) {
			return;
		}

		const update = () => {
			const rect = el.getBoundingClientRect();
			setRightOffset(window.innerWidth - rect.right + PANEL_MARGIN);
		};

		update();
		const observer = new ResizeObserver(update);
		observer.observe(el);
		window.addEventListener('resize', update, { passive: true });

		return () => {
			observer.disconnect();
			window.removeEventListener('resize', update);
		};
	}, [contentAreaRef]);

	return rightOffset;
}

const PANEL_WIDTH = 400;

function PanelContainer({
	anchor,
	onClose,
	contentAreaRef,
}: {
	anchor: SelectionAnchor;
	onClose: () => void;
	contentAreaRef?: React.RefObject<HTMLElement | null>;
}) {
	const rightOffset = usePanelRightOffset(contentAreaRef);
	const { removeAnchor } = useSelection();

	useEffect(() => {
		const el = contentAreaRef?.current;
		if (!el) {
			return;
		}
		const observer = new ResizeObserver(() => {
			if (el.getBoundingClientRect().width < PANEL_WIDTH + PANEL_MARGIN) {
				onClose();
			}
		});
		observer.observe(el);
		return () => observer.disconnect();
	}, [contentAreaRef, onClose]);

	const deleteChatMutation = useMutation(
		trpc.chat.delete.mutationOptions({
			onSuccess: () => removeAnchor(anchor.chatId),
		}),
	);

	const handleDelete = useCallback(() => {
		deleteChatMutation.mutate({ chatId: anchor.chatId });
	}, [deleteChatMutation, anchor.chatId]);

	return (
		<div
			style={{ right: rightOffset }}
			className='fixed top-20 bottom-10 w-[400px] z-50 flex flex-col items-center'
		>
			<ChatPanelContent
				key={anchor.chatId}
				anchor={anchor}
				rightOffset={rightOffset}
				handleDelete={handleDelete}
				onClose={onClose}
			/>
			<Button
				onClick={onClose}
				variant='ghost-no-hover'
				className='
					absolute right-10 translate-x-1/2 bottom-[-32px] w-10 h-10
					flex items-center justify-center rounded-full
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
	rightOffset,
	handleDelete,
	onClose,
}: {
	anchor: SelectionAnchor;
	rightOffset: number;
	handleDelete: () => void;
	onClose: () => void;
}) {
	return (
		<div
			style={{ right: rightOffset }}
			className='flex flex-col bg-panel border border-border shadow-xl rounded-2xl
					fixed top-20 bottom-15 w-[400px] z-50 overflow-hidden'
			onMouseDown={(e) => e.stopPropagation()}
		>
			<PanelHeader anchor={anchor} handleDelete={handleDelete} onClose={onClose} />
			<SetChatInputCallbackProvider>
				<ChatIdContext.Provider value={anchor.chatId}>
					<AgentProvider disableNavigation>
						<Conversation>
							<ConversationContent className='gap-0 p-4'>
								<ChatMessagesContent />
							</ConversationContent>
							<ConversationScrollButton />
						</Conversation>
						<ChatInput />
					</AgentProvider>
				</ChatIdContext.Provider>
			</SetChatInputCallbackProvider>
		</div>
	);
}

export function PanelHeader({
	anchor,
	handleDelete,
	onClose,
}: {
	anchor: SelectionAnchor;
	handleDelete: () => void;
	onClose: () => void;
}) {
	const navigate = useNavigate();
	const chat = useChatQuery({ chatId: anchor.chatId });
	const forkMetadata = chat.data?.forkMetadata;
	const selectionText = forkMetadata?.selectionText ?? '';
	const displayed = selectionText.length > 220 ? `${selectionText.slice(0, 220)}\u2026` : selectionText;

	return (
		<div className='flex flex-col w-full'>
			<div className='flex items-center justify-between w-full mt-2 px-4'>
				<p className='text-sm font-medium'>Ask a question</p>
				<div className='flex items-center -mr-1'>
					<DropdownMenu>
						<DropdownMenuTrigger asChild>
							<Button variant='ghost' size='icon-xs'>
								<MoreHorizontal />
							</Button>
						</DropdownMenuTrigger>
						<DropdownMenuContent align='end'>
							<DropdownMenuItem
								onSelect={() => navigate({ to: '/$chatId', params: { chatId: anchor.chatId } })}
							>
								<Maximize2 size={16} /> Expand
							</DropdownMenuItem>
							<DropdownMenuSeparator />
							<DropdownMenuItem variant='destructive' onSelect={handleDelete}>
								<Trash /> Delete
							</DropdownMenuItem>
						</DropdownMenuContent>
					</DropdownMenu>
					<Button variant='ghost' size='icon-xs' onClick={onClose}>
						<X />
					</Button>
				</div>
			</div>
			<div className='px-4 mt-1'>
				<div className='px-4 py-3 border border-border bg-background rounded-xl'>
					<p className='text-[11px] text-muted-foreground font-mono tracking-tight mb-1.5'>
						@chars {anchor.start}–{anchor.end}
					</p>
					{displayed && (
						<blockquote className='text-xs text-foreground/80 italic leading-relaxed line-clamp-3 border-l-2 border-primary/50 pl-3'>
							“{displayed}”
						</blockquote>
					)}
				</div>
			</div>
		</div>
	);
}
