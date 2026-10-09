import { ChevronDown, Layers, Table2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { ReactNode, RefObject } from 'react';
import type { ChatArtifacts, FileArtifact, QueryArtifact } from '@/lib/chat-artifacts';
import type { StorySummary } from '@/lib/story.utils';

import { AttachmentFileIcon } from '@/components/attachment-file-icon';
import { AttachmentViewer } from '@/components/side-panel/attachment-viewer';
import { StoryViewer } from '@/components/side-panel/story-viewer';
import { Button } from '@/components/ui/button';
import StoryIcon from '@/components/ui/story-icon';
import { useAgentMessagesSelector } from '@/contexts/agent.provider';
import { useSidePanel } from '@/contexts/side-panel';
import { useToolCallDensity } from '@/hooks/use-tool-call-density';
import { areChatArtifactsEqual, collectChatArtifacts, countChatArtifacts } from '@/lib/chat-artifacts';
import { cn } from '@/lib/utils';

/** Mirrors `max-w-3xl` on the conversation column. */
const CHAT_COLUMN_MAX_WIDTH = 768;
/** Mirrors `w-72` on the panel. */
const PANEL_WIDTH = 288;
/** Right offset of the panel plus the breathing room kept from the chat column. */
const PANEL_HORIZONTAL_MARGIN = 32;

interface ChatArtifactsMenuProps {
	chatId: string;
	className?: string;
}

/**
 * Floating entry point to what the conversation produced: its stories, the files the user
 * shared, and — for users who see detailed tool calls — the query results the agent ran.
 * The panel docks beside the chat when a story exists and the column leaves room for it;
 * otherwise it collapses to a pill the user can expand on demand.
 */
export function ChatArtifactsMenu({ chatId, className }: ChatArtifactsMenuProps) {
	const rootRef = useRef<HTMLDivElement>(null);
	const [density] = useToolCallDensity();
	const { open: openSidePanel } = useSidePanel();
	const artifacts = useAgentMessagesSelector(collectChatArtifacts, areChatArtifactsEqual);
	const showQueries = density !== 'compact';
	const count = countChatArtifacts(artifacts, showQueries);
	const hasRoom = useHasRoomBesideChat(rootRef, count > 0);
	const [isExpanded, setIsExpanded] = useState(false);

	if (count === 0) {
		return null;
	}

	const isDocked = hasRoom && artifacts.stories.length > 0;
	const isOpen = isDocked || isExpanded;

	const toggle = () => {
		setIsExpanded((value) => !value);
	};
	const openStory = (story: StorySummary) => {
		openSidePanel(<StoryViewer chatId={chatId} storySlug={story.id} />, story.id);
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
		<div ref={rootRef} className={cn('flex flex-col items-end gap-2', className)}>
			{!isDocked && (
				<Button
					variant='outline'
					size='icon-sm'
					className='w-auto gap-1.5 rounded-full px-2.5 shadow-sm hover:rounded-full'
					onClick={toggle}
					aria-expanded={isOpen}
					aria-label={`Artifacts (${count})`}
				>
					<Layers className='size-3.5' strokeWidth={2.25} />
					<span className='text-xs'>Artifacts</span>
					<span className='rounded-full bg-muted px-1.5 text-[10px] font-medium tabular-nums'>{count}</span>
					<ChevronDown className={cn('size-3 transition-transform', isOpen && 'rotate-180')} />
				</Button>
			)}
			{isOpen && (
				<div className='w-72 rounded-lg border bg-popover p-2 text-popover-foreground shadow-md animate-fade-in'>
					{isDocked && <ArtifactsPanelHeading count={count} />}
					<ChatArtifactsList
						artifacts={artifacts}
						showQueries={showQueries}
						onOpenStory={openStory}
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
			<span>Artifacts</span>
			<span className='rounded-full bg-muted px-1.5 text-[10px] font-medium tabular-nums'>{count}</span>
		</div>
	);
}

interface ChatArtifactsListProps {
	artifacts: ChatArtifacts;
	showQueries: boolean;
	onOpenStory: (story: StorySummary) => void;
	onOpenFile: (file: FileArtifact) => void;
	onRevealQuery: (query: QueryArtifact) => void;
}

export function ChatArtifactsList({
	artifacts,
	showQueries,
	onOpenStory,
	onOpenFile,
	onRevealQuery,
}: ChatArtifactsListProps) {
	return (
		<div className='flex max-h-96 flex-col gap-3 overflow-y-auto'>
			{artifacts.stories.length > 0 && (
				<ArtifactSection title='Stories' count={artifacts.stories.length}>
					{artifacts.stories.map((story) => (
						<ArtifactItem
							key={story.id}
							icon={<StoryIcon className='size-3.5 text-foreground' strokeWidth={2.25} />}
							label={story.title || story.id}
							onClick={() => onOpenStory(story)}
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
			className='flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent'
		>
			<span className='shrink-0'>{icon}</span>
			<span className='min-w-0 flex-1 truncate'>{label}</span>
			{detail && <span className='shrink-0 text-xs text-muted-foreground'>{detail}</span>}
		</button>
	);
}

/** Whether the chat column is wide enough for the panel to sit beside the messages without covering them. */
function useHasRoomBesideChat(rootRef: RefObject<HTMLDivElement | null>, isMounted: boolean) {
	const [hasRoom, setHasRoom] = useState(false);

	useEffect(() => {
		const column = rootRef.current?.parentElement;
		if (!column) {
			return;
		}

		const observer = new ResizeObserver(() => {
			setHasRoom(hasRoomBesideChat(column.clientWidth));
		});
		observer.observe(column);
		return () => observer.disconnect();
	}, [rootRef, isMounted]);

	return hasRoom;
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
	target?.scrollIntoView({ behavior: 'smooth', block: 'center' });
}
