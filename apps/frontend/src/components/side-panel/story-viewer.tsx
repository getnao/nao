import { memo, useCallback, useMemo, useRef } from 'react';
import { Editor } from '@monaco-editor/react';
import {
	ChevronDown,
	ChevronLeft,
	ChevronRight,
	Code,
	Eye,
	Globe,
	Maximize2,
	Pencil,
	Save,
	RotateCcw,
	Share,
} from 'lucide-react';
import { StoryChartEmbed } from './story-chart-embed';
import { StoryTableEmbed } from './story-table-embed';
import { StoryEditor } from './story-editor';
import { ShareStoryDialog } from './share-story-dialog';
import { useStoryViewerAgentState } from './hooks/use-story-viewer-agent-state';
import { useStoryViewerEnlarge } from './hooks/use-story-viewer-enlarge';
import { useStoryViewerSharing } from './hooks/use-story-viewer-sharing';
import { useStoryViewerStreamScroll } from './hooks/use-story-viewer-stream-scroll';
import { useStoryViewerSwitchStory } from './hooks/use-story-viewer-switch-story';
import { useStoryViewerVersionActions } from './hooks/use-story-viewer-version-actions';
import { useStoryViewerVersions } from './hooks/use-story-viewer-versions';
import { useStoryViewerViewMode } from './hooks/use-story-viewer-view-mode';
import type { StoryViewMode } from './story-viewer.types';
import type { StorySummary } from '@/lib/story.utils';
import type { ParsedChartBlock, ParsedTableBlock } from '@/lib/story-segments';
import type { Editor as TiptapEditor } from '@tiptap/react';
import { SegmentList } from '@/components/story-rendering';
import { Button } from '@/components/ui/button';
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { splitCodeIntoSegments } from '@/lib/story-segments';

interface StoryViewerProps {
	chatId: string;
	storyId: string;
}

export function StoryViewer({ chatId, storyId }: StoryViewerProps) {
	const tiptapEditorRef = useRef<TiptapEditor | null>(null);
	const scrollContainerRef = useRef<HTMLDivElement | null>(null);
	const { viewMode, setViewMode } = useStoryViewerViewMode();
	const { allStories, draftStory, isAgentRunning } = useStoryViewerAgentState(storyId);
	const resolvedStoryId = draftStory?.id ?? storyId;
	const { versions, currentVersion, currentVersionNumber, isViewingLatest, goToPreviousVersion, goToNextVersion } =
		useStoryViewerVersions({
			chatId,
			storyId: resolvedStoryId,
			isAgentRunning,
		});
	const { handleSave, handleRestore } = useStoryViewerVersionActions({
		chatId,
		storyId: resolvedStoryId,
		currentVersionTitle: currentVersion?.title,
		currentVersionCode: currentVersion?.code,
		isViewingLatest,
		tiptapEditorRef,
		setViewMode,
	});
	const { isShareDialogOpen, setIsShareDialogOpen, isShared } = useStoryViewerSharing({
		chatId,
		storyId: resolvedStoryId,
	});
	const { handleEnlarge } = useStoryViewerEnlarge({ chatId, storyId: resolvedStoryId });
	const handleOpenShare = useCallback(() => setIsShareDialogOpen(true), [setIsShareDialogOpen]);

	const renderStoryViewer = useCallback(
		(nextStoryId: string) => <StoryViewer chatId={chatId} storyId={nextStoryId} />,
		[chatId],
	);
	const { switchStory } = useStoryViewerSwitchStory({ renderStoryViewer });

	const shouldUseDraftStory = Boolean(draftStory && (draftStory.isStreaming || !currentVersion));
	const storyTitle = useMemo(
		() =>
			shouldUseDraftStory
				? (draftStory?.title ?? currentVersion?.title ?? storyId)
				: (currentVersion?.title ?? draftStory?.title ?? storyId),
		[shouldUseDraftStory, draftStory?.title, currentVersion?.title, storyId],
	);
	const storyCode = useMemo(
		() =>
			shouldUseDraftStory
				? (draftStory?.code ?? currentVersion?.code)
				: (currentVersion?.code ?? draftStory?.code),
		[shouldUseDraftStory, draftStory?.code, currentVersion?.code],
	);
	useStoryViewerStreamScroll({
		scrollContainerRef,
		isStreaming: Boolean(draftStory?.isStreaming),
		code: storyCode,
		viewMode,
	});

	if (!storyCode) {
		return (
			<div className='flex h-full items-center justify-center text-muted-foreground text-sm'>
				{isAgentRunning ? 'Waiting for story stream...' : 'No Story content available.'}
			</div>
		);
	}

	return (
		<div className='flex h-full flex-col'>
			<StoryHeader
				title={storyTitle}
				storyId={resolvedStoryId}
				allStories={allStories}
				onSwitchStory={switchStory}
				viewMode={viewMode}
				onViewModeChange={setViewMode}
				currentVersion={currentVersionNumber}
				totalVersions={versions.length}
				onPreviousVersion={goToPreviousVersion}
				onNextVersion={goToNextVersion}
				isViewingLatest={isViewingLatest}
				onRestore={handleRestore}
				onSave={handleSave}
				onShare={handleOpenShare}
				onEnlarge={handleEnlarge}
				isShared={isShared}
				isAgentRunning={isAgentRunning}
			/>

			<div ref={scrollContainerRef} className='flex-1 min-h-0 overflow-auto'>
				{viewMode === 'preview' ? (
					<StoryPreview code={storyCode} />
				) : viewMode === 'edit' ? (
					<StoryEditor code={storyCode} editorRef={tiptapEditorRef} />
				) : (
					<StoryCodeView code={storyCode} />
				)}
			</div>

			<ShareStoryDialog
				open={isShareDialogOpen}
				onOpenChange={setIsShareDialogOpen}
				chatId={chatId}
				storyId={resolvedStoryId}
			/>
		</div>
	);
}

const StoryHeader = memo(function StoryHeader({
	title,
	storyId,
	allStories,
	onSwitchStory,
	viewMode,
	onViewModeChange,
	currentVersion,
	totalVersions,
	onPreviousVersion,
	onNextVersion,
	isViewingLatest,
	onRestore,
	onSave,
	onShare,
	onEnlarge,
	isShared,
	isAgentRunning,
}: {
	title: string;
	storyId: string;
	allStories: StorySummary[];
	onSwitchStory: (id: string) => void;
	viewMode: StoryViewMode;
	onViewModeChange: (mode: StoryViewMode) => void;
	currentVersion: number;
	totalVersions: number;
	onPreviousVersion: () => void;
	onNextVersion: () => void;
	isViewingLatest: boolean;
	onRestore: () => void;
	onSave: () => void;
	onShare: () => void;
	onEnlarge: () => void;
	isShared: boolean;
	isAgentRunning: boolean;
}) {
	const otherStories = useMemo(() => allStories.filter((s) => s.id !== storyId), [allStories, storyId]);
	const hasMultiple = otherStories.length > 0;

	const showSubHeader = viewMode === 'edit' || !isViewingLatest;

	return (
		<div className='shrink-0'>
			<div className='flex items-center gap-2 border-b px-4 py-3'>
				{hasMultiple ? (
					<DropdownMenu>
						<DropdownMenuTrigger asChild>
							<button
								type='button'
								className='flex items-center gap-1 min-w-0 flex-1 cursor-pointer hover:text-foreground/80 transition-colors focus:outline-none'
							>
								<h3 className='text-sm font-medium truncate'>{title}</h3>
								<ChevronDown className='size-3 shrink-0 text-muted-foreground' />
							</button>
						</DropdownMenuTrigger>
						<DropdownMenuContent align='start'>
							{otherStories.map((story) => (
								<DropdownMenuItem key={story.id} onClick={() => onSwitchStory(story.id)}>
									<span className='truncate'>{story.title}</span>
								</DropdownMenuItem>
							))}
						</DropdownMenuContent>
					</DropdownMenu>
				) : (
					<h3 className='text-sm font-medium truncate flex-1'>{title}</h3>
				)}

				{totalVersions > 1 && (
					<div className='flex items-center gap-1'>
						<Button
							variant='ghost-muted'
							size='icon-xs'
							onClick={onPreviousVersion}
							disabled={currentVersion <= 1}
						>
							<ChevronLeft className='size-3' />
						</Button>
						<span className='text-xs text-muted-foreground tabular-nums min-w-6 text-center'>
							{currentVersion}/{totalVersions}
						</span>
						<Button
							variant='ghost-muted'
							size='icon-xs'
							onClick={onNextVersion}
							disabled={currentVersion >= totalVersions}
						>
							<ChevronRight className='size-3' />
						</Button>
					</div>
				)}

				<div className='flex items-center rounded-lg border p-0.5 gap-0.5'>
					<Button
						variant={viewMode === 'preview' ? 'secondary' : 'ghost'}
						size='icon-xs'
						onClick={() => onViewModeChange('preview')}
					>
						<Eye className='size-3' />
					</Button>
					<Button
						variant={viewMode === 'edit' ? 'secondary' : 'ghost'}
						size='icon-xs'
						onClick={() => onViewModeChange('edit')}
						disabled={isAgentRunning}
					>
						<Pencil className='size-3' />
					</Button>
					<Button
						variant={viewMode === 'code' ? 'secondary' : 'ghost'}
						size='icon-xs'
						onClick={() => onViewModeChange('code')}
					>
						<Code className='size-3' />
					</Button>
				</div>

				<Button variant='ghost-muted' size='icon-xs' onClick={onEnlarge} aria-label='Enlarge Story'>
					<Maximize2 className='size-3' />
				</Button>

				<Button
					variant='ghost-muted'
					size='icon-xs'
					onClick={onShare}
					disabled={isAgentRunning}
					aria-label='Share Story'
				>
					{isShared ? <Globe className='size-3 text-emerald-600' /> : <Share className='size-3' />}
				</Button>
			</div>

			{showSubHeader && (
				<div className='flex items-center justify-between border-b bg-muted/40 px-4 py-2'>
					{viewMode === 'edit' ? (
						<>
							<span className='text-xs text-muted-foreground'>Editing</span>
							<div className='flex items-center gap-2'>
								<Button variant='outline' size='sm' onClick={() => onViewModeChange('preview')}>
									Cancel
								</Button>
								<Button variant='default' size='sm' onClick={onSave} className='gap-1.5'>
									<Save className='size-3' />
									<span>Save</span>
								</Button>
							</div>
						</>
					) : (
						<>
							<span className='text-xs text-muted-foreground'>
								Viewing v{currentVersion} of {totalVersions}
							</span>
							<Button variant='outline' size='sm' onClick={onRestore} className='gap-1.5'>
								<RotateCcw className='size-3' />
								<span>Restore</span>
							</Button>
						</>
					)}
				</div>
			)}
		</div>
	);
});

const StoryPreview = memo(function StoryPreview({ code }: { code: string }) {
	const segments = useMemo(() => splitCodeIntoSegments(code), [code]);
	const renderChart = useCallback((chart: ParsedChartBlock) => <StoryChartEmbed chart={chart} />, []);
	const renderTable = useCallback((table: ParsedTableBlock) => <StoryTableEmbed table={table} />, []);

	return (
		<div className='p-6 flex flex-col gap-4'>
			<SegmentList segments={segments} renderChart={renderChart} renderTable={renderTable} />
		</div>
	);
});

const MONACO_OPTIONS = {
	minimap: { enabled: false },
	folding: true,
	lineNumbers: 'on' as const,
	scrollbar: { horizontal: 'auto' as const, vertical: 'auto' as const },
	scrollBeyondLastLine: false,
	padding: { top: 16, bottom: 16 },
	wordWrap: 'on' as const,
	readOnly: true,
};

const StoryCodeView = memo(function StoryCodeView({ code }: { code: string }) {
	return (
		<div className='h-full'>
			<Editor value={code} language='markdown' theme='light' options={MONACO_OPTIONS} />
		</div>
	);
});
