import { memo, useCallback, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Editor } from '@monaco-editor/react';
import {
	Activity,
	ArchiveRestoreIcon,
	ChevronDown,
	ChevronLeft,
	ChevronRight,
	Code,
	Eye,
	Globe,
	Loader2,
	Maximize2,
	Pencil,
	RefreshCw,
	Save,
	RotateCcw,
	Share,
	X,
} from 'lucide-react';
import { StoryChartEmbed } from './story-chart-embed';
import { StoryTableEmbed } from './story-table-embed';
import { StoryEditor } from './story-editor';
import { ShareStoryDialog } from './share-story-dialog';
import { LiveStorySettingsDialog } from './live-story-settings-dialog';
import { useStoryViewerAgentState } from './hooks/use-story-viewer-agent-state';
import { useStoryViewerEnlarge } from './hooks/use-story-viewer-enlarge';
import { useStoryViewerLiveSettings } from './hooks/use-story-viewer-live-settings';
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
import type { displayChart } from '@nao/shared/tools';
import { SegmentList } from '@/components/story-rendering';
import { ChartDisplay } from '@/components/tool-calls/display-chart';
import { TableDisplay } from '@/components/tool-calls/display-table';
import { useIsMobile } from '@/hooks/use-is-mobile';
import { useSidePanel } from '@/contexts/side-panel';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { splitCodeIntoSegments } from '@/lib/story-segments';
import { trpc } from '@/main';

interface StoryViewerProps {
	chatId: string;
	storyId: string;
}

export function StoryViewer({ chatId, storyId }: StoryViewerProps) {
	const tiptapEditorRef = useRef<TiptapEditor | null>(null);
	const scrollContainerRef = useRef<HTMLDivElement | null>(null);
	const { close: closeSidePanel } = useSidePanel();
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
	const {
		isLive,
		cacheTtlMinutes,
		isUpdating: isLiveUpdating,
		isRefreshing,
		handleToggleLive,
		handleUpdateCacheTtl,
		handleRefreshData,
	} = useStoryViewerLiveSettings({ chatId, storyId: resolvedStoryId });
	const [isLiveSettingsOpen, setIsLiveSettingsOpen] = useState(false);
	const { handleEnlarge } = useStoryViewerEnlarge({ chatId, storyId: resolvedStoryId });
	const handleOpenShare = useCallback(() => setIsShareDialogOpen(true), [setIsShareDialogOpen]);
	const handleOpenLiveSettings = useCallback(() => setIsLiveSettingsOpen(true), []);

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

	const isArchived = Boolean(currentVersion?.archivedAt);

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
				isLive={isLive}
				isRefreshing={isRefreshing}
				onRefreshData={handleRefreshData}
				onOpenLiveSettings={handleOpenLiveSettings}
				onClose={closeSidePanel}
			/>

			{isArchived && <ArchivedBanner chatId={chatId} storyId={resolvedStoryId} />}

			<div ref={scrollContainerRef} className='flex-1 min-h-0 overflow-auto'>
				{viewMode === 'preview' ? (
					<StoryPreview code={storyCode} isLive={isLive} chatId={chatId} storyId={resolvedStoryId} />
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

			<LiveStorySettingsDialog
				open={isLiveSettingsOpen}
				onOpenChange={setIsLiveSettingsOpen}
				isLive={isLive}
				cacheTtlMinutes={cacheTtlMinutes}
				isUpdating={isLiveUpdating}
				onToggleLive={handleToggleLive}
				onUpdateCacheTtl={handleUpdateCacheTtl}
			/>
		</div>
	);
}

function ArchivedBanner({ chatId, storyId }: { chatId: string; storyId: string }) {
	const queryClient = useQueryClient();

	const unarchiveMutation = useMutation(
		trpc.story.unarchive.mutationOptions({
			onSuccess: () => {
				queryClient.invalidateQueries({ queryKey: trpc.story.listVersions.queryKey({ chatId, storyId }) });
				queryClient.invalidateQueries({ queryKey: trpc.story.listAll.queryKey() });
				queryClient.invalidateQueries({ queryKey: trpc.story.listArchived.queryKey() });
			},
		}),
	);

	return (
		<div className='flex items-center justify-between gap-3 border-b bg-muted/50 px-4 py-2'>
			<span className='text-xs text-muted-foreground'>This story has been archived.</span>
			<Button
				variant='outline'
				size='sm'
				className='gap-1.5 shrink-0'
				onClick={() => unarchiveMutation.mutate({ chatId, storyId })}
				disabled={unarchiveMutation.isPending}
			>
				<ArchiveRestoreIcon className='size-3' />
				<span>Unarchive</span>
			</Button>
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
	isLive,
	isRefreshing,
	onRefreshData,
	onOpenLiveSettings,
	onClose,
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
	isLive: boolean;
	isRefreshing: boolean;
	onRefreshData: () => void;
	onOpenLiveSettings: () => void;
	onClose: () => void;
}) {
	const isMobile = useIsMobile();
	const otherStories = useMemo(() => allStories.filter((s) => s.id !== storyId), [allStories, storyId]);
	const hasMultiple = otherStories.length > 0;

	const showSubHeader = viewMode === 'edit' || !isViewingLatest;

	const titleElement = hasMultiple ? (
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
	);

	const versionNav = totalVersions > 1 && (
		<div className='flex items-center gap-1'>
			<Button variant='ghost-muted' size='icon-xs' onClick={onPreviousVersion} disabled={currentVersion <= 1}>
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
	);

	const viewModeToggle = (
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
	);

	const actionButtons = (
		<>
			{isLive && (
				<TooltipProvider>
					<Tooltip>
						<TooltipTrigger asChild>
							<Button
								variant='ghost-muted'
								size='icon-xs'
								onClick={onRefreshData}
								disabled={isRefreshing}
								aria-label='Refresh data'
							>
								{isRefreshing ? (
									<Loader2 className='size-3 animate-spin' />
								) : (
									<RefreshCw className='size-3' />
								)}
							</Button>
						</TooltipTrigger>
						<TooltipContent>Refresh data</TooltipContent>
					</Tooltip>
				</TooltipProvider>
			)}
			<TooltipProvider>
				<Tooltip>
					<TooltipTrigger asChild>
						<Button
							variant='ghost-muted'
							size='icon-xs'
							onClick={onOpenLiveSettings}
							disabled={isAgentRunning}
							aria-label='Live settings'
						>
							{isLive ? (
								<Activity className='size-3 text-emerald-600' />
							) : (
								<Activity className='size-3' />
							)}
						</Button>
					</TooltipTrigger>
					<TooltipContent>{isLive ? 'Live story settings' : 'Enable live mode'}</TooltipContent>
				</Tooltip>
			</TooltipProvider>
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
		</>
	);

	return (
		<div className='shrink-0'>
			{isMobile ? (
				<>
					<div className='flex items-center gap-2 border-b px-3 py-2'>
						<Button variant='ghost' size='icon-md' onClick={onClose} aria-label='Close'>
							<X className='size-4' strokeWidth={1.5} />
						</Button>
						<div className='flex-1' />
						{viewModeToggle}
						{actionButtons}
					</div>
					<div className='flex items-center gap-2 border-b px-4 py-2'>
						{titleElement}
						{versionNav}
					</div>
				</>
			) : (
				<div className='flex items-center gap-2 border-b px-4 py-3'>
					{titleElement}
					{versionNav}
					{viewModeToggle}
					{actionButtons}
				</div>
			)}

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

type QueryDataMap = Record<string, { data: Record<string, unknown>[]; columns: string[] }>;

const StoryPreview = memo(function StoryPreview({
	code,
	isLive,
	chatId,
	storyId,
}: {
	code: string;
	isLive: boolean;
	chatId: string;
	storyId: string;
}) {
	const segments = useMemo(() => splitCodeIntoSegments(code), [code]);

	if (isLive) {
		return <LiveStoryPreview segments={segments} chatId={chatId} storyId={storyId} />;
	}

	return <StaticStoryPreview segments={segments} />;
});

const StaticStoryPreview = memo(function StaticStoryPreview({
	segments,
}: {
	segments: ReturnType<typeof splitCodeIntoSegments>;
}) {
	const renderChart = useCallback((chart: ParsedChartBlock) => <StoryChartEmbed chart={chart} />, []);
	const renderTable = useCallback((table: ParsedTableBlock) => <StoryTableEmbed table={table} />, []);

	return (
		<div className='p-6 flex flex-col gap-4'>
			<SegmentList segments={segments} renderChart={renderChart} renderTable={renderTable} />
		</div>
	);
});

function LiveStoryPreview({
	segments,
	chatId,
	storyId,
}: {
	segments: ReturnType<typeof splitCodeIntoSegments>;
	chatId: string;
	storyId: string;
}) {
	const { data } = useQuery(trpc.story.getLatest.queryOptions({ chatId, storyId }));
	const queryData = data?.queryData as QueryDataMap | null | undefined;

	const renderChart = useCallback(
		(chart: ParsedChartBlock) => <LiveChartEmbed chart={chart} queryData={queryData ?? null} />,
		[queryData],
	);
	const renderTable = useCallback(
		(table: ParsedTableBlock) => <LiveTableEmbed table={table} queryData={queryData ?? null} />,
		[queryData],
	);

	return (
		<div className='p-6 flex flex-col gap-4'>
			<SegmentList segments={segments} renderChart={renderChart} renderTable={renderTable} />
		</div>
	);
}

function LiveChartEmbed({ chart, queryData }: { chart: ParsedChartBlock; queryData: QueryDataMap | null }) {
	const result = queryData?.[chart.queryId];
	const data = result?.data;

	if (!data || data.length === 0) {
		return (
			<div className='my-2 rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground'>
				Chart data unavailable
			</div>
		);
	}

	if (chart.series.length === 0) {
		return (
			<div className='my-2 rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground'>
				No series configured for chart
			</div>
		);
	}

	return (
		<div className={`my-2 ${chart.chartType !== 'kpi_card' ? 'aspect-3/2' : ''}`}>
			<ChartDisplay
				data={data}
				chartType={chart.chartType as displayChart.ChartType}
				xAxisKey={chart.xAxisKey}
				xAxisType={chart.xAxisType === 'number' ? 'number' : 'category'}
				series={chart.series}
				title={chart.title}
			/>
		</div>
	);
}

function LiveTableEmbed({ table, queryData }: { table: ParsedTableBlock; queryData: QueryDataMap | null }) {
	const result = queryData?.[table.queryId];
	const data = result?.data;

	if (!data) {
		return (
			<div className='my-2 rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground'>
				Table data unavailable
			</div>
		);
	}

	return (
		<TableDisplay
			data={data}
			columns={result.columns}
			title={table.title}
			tableContainerClassName='max-h-[28rem]'
		/>
	);
}

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
