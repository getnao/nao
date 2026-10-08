import { Layers, Table2 } from 'lucide-react';
import { useState } from 'react';
import type { ReactNode } from 'react';
import type { ChatArtifacts, FileArtifact, QueryArtifact } from '@/lib/chat-artifacts';
import type { StorySummary } from '@/lib/story.utils';

import { AttachmentFileIcon } from '@/components/attachment-file-icon';
import { AttachmentViewer } from '@/components/side-panel/attachment-viewer';
import { StoryViewer } from '@/components/side-panel/story-viewer';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import StoryIcon from '@/components/ui/story-icon';
import { useAgentMessagesSelector } from '@/contexts/agent.provider';
import { useSidePanel } from '@/contexts/side-panel';
import { useToolCallDensity } from '@/hooks/use-tool-call-density';
import { areChatArtifactsEqual, collectChatArtifacts, countChatArtifacts } from '@/lib/chat-artifacts';
import { cn } from '@/lib/utils';

interface ChatArtifactsMenuProps {
	chatId: string;
	className?: string;
}

/**
 * Floating entry point to what the conversation produced: its stories, the files the user
 * shared, and — for users who see detailed tool calls — the query results the agent ran.
 */
export function ChatArtifactsMenu({ chatId, className }: ChatArtifactsMenuProps) {
	const [isOpen, setIsOpen] = useState(false);
	const [density] = useToolCallDensity();
	const { open: openSidePanel } = useSidePanel();
	const artifacts = useAgentMessagesSelector(collectChatArtifacts, areChatArtifactsEqual);
	const showQueries = density !== 'compact';
	const count = countChatArtifacts(artifacts, showQueries);

	if (count === 0) {
		return null;
	}

	const openStory = (story: StorySummary) => {
		openSidePanel(<StoryViewer chatId={chatId} storySlug={story.id} />, story.id);
		setIsOpen(false);
	};
	const openFile = (file: FileArtifact) => {
		openSidePanel(<AttachmentViewer path={file.path} fileName={file.filename} />);
		setIsOpen(false);
	};
	const revealQuery = (query: QueryArtifact) => {
		scrollToToolCall(query.toolCallId);
		setIsOpen(false);
	};

	return (
		<Popover open={isOpen} onOpenChange={setIsOpen}>
			<PopoverTrigger asChild>
				<Button
					variant='outline'
					size='icon-sm'
					className={cn('w-auto gap-1.5 rounded-full px-2.5 shadow-sm hover:rounded-full', className)}
					aria-label={`Artifacts (${count})`}
				>
					<Layers className='size-3.5' strokeWidth={2.25} />
					<span className='text-xs'>Artifacts</span>
					<span className='rounded-full bg-muted px-1.5 text-[10px] font-medium tabular-nums'>{count}</span>
				</Button>
			</PopoverTrigger>
			<PopoverContent side='top' align='end' sideOffset={8} className='w-80 p-2'>
				<ChatArtifactsList
					artifacts={artifacts}
					showQueries={showQueries}
					onOpenStory={openStory}
					onOpenFile={openFile}
					onRevealQuery={revealQuery}
				/>
			</PopoverContent>
		</Popover>
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
				<ArtifactSection title='Stories'>
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
				<ArtifactSection title='Files'>
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
				<ArtifactSection title='Queries'>
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

function ArtifactSection({ title, children }: { title: string; children: ReactNode }) {
	return (
		<section className='flex flex-col gap-0.5'>
			<h4 className='px-2 pb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground'>{title}</h4>
			{children}
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

function describeQuery(query: QueryArtifact): string {
	const rows = `${query.rowCount} ${query.rowCount === 1 ? 'row' : 'rows'}`;
	const columns = `${query.columns.length} ${query.columns.length === 1 ? 'col' : 'cols'}`;
	return `${rows} · ${columns}`;
}

function scrollToToolCall(toolCallId: string) {
	const target = document.querySelector<HTMLElement>(`[data-replay-target-id="${CSS.escape(toolCallId)}"]`);
	target?.scrollIntoView({ behavior: 'smooth', block: 'center' });
}
