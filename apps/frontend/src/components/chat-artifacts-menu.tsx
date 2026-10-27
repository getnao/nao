import { AtSign, ChevronDown, Layers, Table2 } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode, RefObject } from 'react';
import type { ChatArtifacts, FileArtifact, QueryArtifact } from '@/lib/chat-artifacts';
import type { StorySummary } from '@/lib/story.utils';
import type { ResolvedStory } from '@/hooks/use-mentioned-stories';

import { AttachmentFileIcon } from '@/components/attachment-file-icon';
import { AttachmentViewer } from '@/components/side-panel/attachment-viewer';
import { useOpenStoryInSidePanel } from '@/components/side-panel/open-story-in-side-panel';
import { StoryViewer } from '@/components/side-panel/story-viewer';
import { Button } from '@/components/ui/button';
import StoryIcon from '@/components/ui/story-icon';
import { useAgentMessagesSelector } from '@/contexts/agent.provider';
import { useSidePanel } from '@/contexts/side-panel';
import { useOpenMentionedStory, useMentionedStories } from '@/hooks/use-mentioned-stories';
import { useToolCallDensity } from '@/hooks/use-tool-call-density';
import { areChatArtifactsEqual, collectChatArtifacts, countChatArtifacts } from '@/lib/chat-artifacts';
import { cn } from '@/lib/utils';

/** Mirrors `max-w-3xl` on the conversation column. */
const CHAT_COLUMN_MAX_WIDTH = 768;
/** Mirrors `w-72` on the panel. */
const PANEL_WIDTH = 288;
/** Right offset of the panel plus the breathing room kept from the chat column. */
const PANEL_HORIZONTAL_MARGIN = 32;
const REVEAL_HIGHLIGHT_CLASS = 'chat-artifact-reveal-highlight';

interface ChatArtifactsMenuProps {
	chatId: string;
	chatColumnRef?: RefObject<HTMLElement | null>;
	panelClassName?: string;
}

/**
 * Header entry point to what the conversation produced: its stories, the files the user
 * shared, and — for users who see detailed tool calls — the query results the agent ran.
 * The panel docks beside the chat when a story exists and the column leaves room for it;
 * otherwise it collapses to a header pill the user can expand on demand.
 * The panel is absolutely positioned, so the header rendering the menu must be positioned.
 */
export function ChatArtifactsMenu({ chatId, chatColumnRef, panelClassName }: ChatArtifactsMenuProps) {
	const [density] = useToolCallDensity();
	const { open: openSidePanel } = useSidePanel();
	const artifacts = useAgentMessagesSelector(collectChatArtifacts, areChatArtifactsEqual);
	const showQueries = density !== 'compact';
	const mentionedStories = useMentionedStories(chatId, artifacts.mentionedStories);
	const openMentionedStory = useOpenMentionedStory(useOpenStoryInSidePanel());
	const count = countChatArtifacts(artifacts, showQueries) + mentionedStories.length;
	const hasRoom = useHasRoomBesideChat(chatColumnRef);
	const [isExpanded, setIsExpanded] = useState(false);
	const rootRef = useRef<HTMLDivElement>(null);
	const isDocked = hasRoom && artifacts.stories.length + mentionedStories.length > 0;
	const isOpen = isDocked || isExpanded;

	const collapse = useCallback(() => setIsExpanded(false), []);

	useDismissOnOutsideInteraction(rootRef, isExpanded && !isDocked, collapse);

	if (count === 0) {
		if (isExpanded) {
			setIsExpanded(false);
		}
		return null;
	}

	const toggle = () => {
		setIsExpanded((value) => !value);
	};
	const openStory = (story: StorySummary) => {
		openSidePanel(<StoryViewer chatId={chatId} storySlug={story.id} />, story.id);
		setIsExpanded(false);
	};
	const openMentioned = (story: ResolvedStory) => {
		openMentionedStory(story);
		setIsExpanded(false);
	};
	const openFile = (file: FileArtifact) => {
		openSidePanel(<AttachmentViewer path={file.path} fileName={file.filename} />);
		setIsExpanded(false);
	};
	const revealQuery = (query: QueryArtifact) => {
		scrollToToolCall(query.toolCallId);
		setIsExpanded(false);
	};

	return (
		<div ref={rootRef} className='contents'>
			{!isDocked && (
				<Button
					variant='outline'
					size='icon-sm'
					className='w-auto gap-1.5 rounded-full border px-2 hover:rounded-full'
					onClick={toggle}
					aria-expanded={isOpen}
					aria-label={`Library (${count})`}
				>
					<Layers className='size-3' strokeWidth={2.25} />
					<span className='text-xs'>Library</span>
					<span className='rounded-full bg-muted px-1.5 text-[10px] font-medium tabular-nums'>{count}</span>
					<ChevronDown className={cn('size-3 transition-transform', isOpen && 'rotate-180')} />
				</Button>
			)}
			{isOpen && (
				<div
					className={cn(
						'absolute top-full z-20 w-72 rounded-lg border bg-popover p-2 text-popover-foreground animate-fade-in',
						panelClassName,
					)}
				>
					{isDocked && <ArtifactsPanelHeading count={count} />}
					<ChatArtifactsList
						artifacts={artifacts}
						mentionedStories={mentionedStories}
						showQueries={showQueries}
						onOpenStory={openStory}
						onOpenMentionedStory={openMentioned}
						onOpenFile={openFile}
						onRevealQuery={revealQuery}
					/>
				</div>
			)}
		</div>
	);
}

function ArtifactsPanelHeading({ count }: { count: number }) {
	return (
		<div className='mb-2 flex items-center gap-1.5 px-2 pt-1 text-xs font-medium'>
			<Layers className='size-3.5' strokeWidth={2.25} />
			<span>Library</span>
			<span className='rounded-full bg-muted px-1.5 text-[10px] font-medium tabular-nums'>{count}</span>
		</div>
	);
}

interface ChatArtifactsListProps {
	artifacts: ChatArtifacts;
	mentionedStories: ResolvedStory[];
	showQueries: boolean;
	onOpenStory: (story: StorySummary) => void;
	onOpenMentionedStory: (story: ResolvedStory) => void;
	onOpenFile: (file: FileArtifact) => void;
	onRevealQuery: (query: QueryArtifact) => void;
}

export function ChatArtifactsList({
	artifacts,
	mentionedStories,
	showQueries,
	onOpenStory,
	onOpenMentionedStory,
	onOpenFile,
	onRevealQuery,
}: ChatArtifactsListProps) {
	const storyCount = artifacts.stories.length + mentionedStories.length;

	return (
		<div className='flex max-h-96 flex-col gap-3 overflow-y-auto'>
			{storyCount > 0 && (
				<ArtifactSection title='Stories' count={storyCount}>
					{artifacts.stories.map((story) => (
						<ArtifactItem
							key={story.id}
							icon={<StoryIcon className='size-3.5 text-foreground' strokeWidth={2.25} />}
							label={story.title || story.id}
							onClick={() => onOpenStory(story)}
						/>
					))}
					{mentionedStories.map((story) => (
						<ArtifactItem
							key={story.storyId}
							icon={<MentionedStoryIcon />}
							label={story.title}
							title='Mentioned in this chat'
							onClick={() => onOpenMentionedStory(story)}
						/>
					))}
				</ArtifactSection>
			)}
			{artifacts.files.length > 0 && (
				<ArtifactSection title='Files' count={artifacts.files.length}>
					{artifacts.files.map((file) => (
						<ArtifactItem
							key={file.path}
							icon={<AttachmentFileIcon fileName={file.path} className='size-3.5' />}
							label={file.filename}
							title={file.path}
							onClick={() => onOpenFile(file)}
						/>
					))}
				</ArtifactSection>
			)}
			{showQueries && artifacts.queries.length > 0 && (
				<ArtifactSection title='Queries' count={artifacts.queries.length} defaultCollapsed>
					{artifacts.queries.map((query) => (
						<ArtifactItem
							key={query.id}
							icon={<Table2 className='size-3.5 text-muted-foreground' strokeWidth={2.25} />}
							label={query.title || query.id}
							detail={describeQuery(query)}
							title={query.id}
							onClick={() => onRevealQuery(query)}
						/>
					))}
				</ArtifactSection>
			)}
		</div>
	);
}

interface ArtifactSectionProps {
	title: string;
	count: number;
	defaultCollapsed?: boolean;
	children: ReactNode;
}

function ArtifactSection({ title, count, defaultCollapsed = false, children }: ArtifactSectionProps) {
	const [isCollapsed, setIsCollapsed] = useState(defaultCollapsed);

	return (
		<section className='flex flex-col gap-0.5'>
			<button
				type='button'
				onClick={() => setIsCollapsed((value) => !value)}
				aria-expanded={!isCollapsed}
				className='flex w-full cursor-pointer items-center gap-1 rounded-md px-2 pb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground hover:text-foreground'
			>
				<span className='flex-1 text-left'>{title}</span>
				<span className='tabular-nums'>{count}</span>
				<ChevronDown className={cn('size-3 transition-transform', isCollapsed && '-rotate-90')} />
			</button>
			{!isCollapsed && children}
		</section>
	);
}

interface ArtifactItemProps {
	icon: ReactNode;
	label: string;
	detail?: string;
	title?: string;
	onClick: () => void;
}

function ArtifactItem({ icon, label, detail, title, onClick }: ArtifactItemProps) {
	return (
		<button
			type='button'
			onClick={onClick}
			title={title}
			className='group flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent'
		>
			<span className='shrink-0'>{icon}</span>
			<span className='min-w-0 flex-1 truncate'>{label}</span>
			{detail && <span className='shrink-0 text-xs text-muted-foreground'>{detail}</span>}
		</button>
	);
}

function MentionedStoryIcon() {
	return (
		<span className='relative flex'>
			<StoryIcon className='size-3.5 text-foreground' strokeWidth={2.25} />
			<span className='absolute -top-1 -right-1 flex size-2.5 items-center justify-center rounded-full text-foreground bg-background group-hover:bg-accent'>
				<AtSign className='size-2' strokeWidth={3} />
			</span>
		</span>
	);
}

/** Whether the chat column is wide enough for the panel to sit beside the messages without covering them. */
function useHasRoomBesideChat(chatColumnRef: RefObject<HTMLElement | null> | undefined) {
	const [hasRoom, setHasRoom] = useState(false);

	useEffect(() => {
		const column = chatColumnRef?.current;
		if (!column) {
			return;
		}

		const observer = new ResizeObserver(() => {
			setHasRoom(hasRoomBesideChat(column.clientWidth));
		});
		observer.observe(column);
		return () => observer.disconnect();
	}, [chatColumnRef]);

	return hasRoom;
}

function useDismissOnOutsideInteraction(
	rootRef: RefObject<HTMLElement | null>,
	isActive: boolean,
	onDismiss: () => void,
) {
	useEffect(() => {
		if (!isActive) {
			return;
		}

		const handlePointerDown = (event: PointerEvent) => {
			if (!rootRef.current?.contains(event.target as Node)) {
				onDismiss();
			}
		};
		const handleKeyDown = (event: KeyboardEvent) => {
			if (event.key === 'Escape') {
				onDismiss();
			}
		};
		document.addEventListener('pointerdown', handlePointerDown);
		document.addEventListener('keydown', handleKeyDown);
		return () => {
			document.removeEventListener('pointerdown', handlePointerDown);
			document.removeEventListener('keydown', handleKeyDown);
		};
	}, [rootRef, isActive, onDismiss]);
}

function hasRoomBesideChat(columnWidth: number): boolean {
	const gutter = (columnWidth - CHAT_COLUMN_MAX_WIDTH) / 2;
	return gutter >= PANEL_WIDTH + PANEL_HORIZONTAL_MARGIN;
}

function describeQuery(query: QueryArtifact): string {
	const rows = `${query.rowCount} ${query.rowCount === 1 ? 'row' : 'rows'}`;
	const columns = `${query.columns.length} ${query.columns.length === 1 ? 'col' : 'cols'}`;
	return `${rows} · ${columns}`;
}

function scrollToToolCall(toolCallId: string) {
	const target = document.querySelector<HTMLElement>(`[data-replay-target-id="${CSS.escape(toolCallId)}"]`);
	if (!target) {
		return;
	}

	expandToolCall(target);
	target.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'center' });
	highlightRevealedElement(target);
}

function expandToolCall(toolCall: HTMLElement) {
	const trigger = toolCall.querySelector<HTMLButtonElement>('button[aria-expanded]');
	if (trigger?.getAttribute('aria-expanded') === 'false') {
		trigger.click();
	}
}

function prefersReducedMotion(): boolean {
	return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** Re-adding the class after a reflow restarts the fade when the same element is revealed twice in a row. */
function highlightRevealedElement(element: HTMLElement) {
	element.classList.remove(REVEAL_HIGHLIGHT_CLASS);
	void element.offsetWidth;
	element.classList.add(REVEAL_HIGHLIGHT_CLASS);

	const removeHighlight = (event: AnimationEvent) => {
		if (event.target !== element) {
			return;
		}
		element.classList.remove(REVEAL_HIGHLIGHT_CLASS);
		element.removeEventListener('animationend', removeHighlight);
	};
	element.addEventListener('animationend', removeHighlight);
}
