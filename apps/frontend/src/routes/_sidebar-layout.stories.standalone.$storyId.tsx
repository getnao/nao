import { splitCodeIntoSegments } from '@nao/shared/story-segments';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useCallback, useMemo, useState } from 'react';
import type { ParsedChartBlock, ParsedTableBlock } from '@nao/shared/story-segments';

import type { SelectionData } from '@/components/highlight-bubble';
import type { QueryDataMap } from '@/components/story-embeds';
import { AssetAnalyticsDialog } from '@/components/asset-analytics-dialog';
import { HighlightBubble } from '@/components/highlight-bubble';
import { StoryChartEmbed, StoryTableEmbed } from '@/components/story-embeds';
import { SegmentList } from '@/components/story-rendering';
import { StoryPageHeader } from '@/components/story-page-header';
import { LiveStorySettingsDialog } from '@/components/side-panel/live-story-settings-dialog';
import { useStoryViewerLiveSettings } from '@/components/side-panel/hooks/use-story-viewer-live-settings';
import { ShareStoryDialog } from '@/components/share-dialog.story';
import { StoryPageBody } from '@/components/story-page-body';
import { Spinner } from '@/components/ui/spinner';
import { SelectionProvider } from '@/contexts/text-selection';
import { chatPendingCitationStore } from '@/stores/chat-pending-citation';
import { useStoryPageEditor } from '@/hooks/use-story-page-editor';
import { useTrackViewDuration } from '@/hooks/use-track-view-duration';
import { trpc } from '@/main';

export const Route = createFileRoute('/_sidebar-layout/stories/standalone/$storyId')({
	component: StandaloneStoryPage,
});

function StandaloneStoryPage() {
	const { storyId } = Route.useParams();
	const navigate = useNavigate();
	const [isAnalyticsOpen, setIsAnalyticsOpen] = useState(false);
	const queryClient = useQueryClient();

	const storyQuery = useQuery(trpc.story.getStandalone.queryOptions({ storyId }));
	const story = storyQuery.data;

	useTrackViewDuration({ assetType: 'story', storyId, versionNumber: story?.version });

	const openStandaloneMutation = useMutation(
		trpc.chatFork.openStandalone.mutationOptions({
			onSuccess: ({ chatId }) => {
				queryClient.invalidateQueries({ queryKey: trpc.story.listAll.queryKey() });
				queryClient.invalidateQueries({ queryKey: trpc.story.listStandalone.queryKey() });
				navigate({ to: '/$chatId', params: { chatId }, state: { openStorySlug: story?.slug } });
			},
		}),
	);

	const handleSelectionAsk = useCallback(
		(data: SelectionData) => {
			if (!story?.chatId) {
				return;
			}
			chatPendingCitationStore.set({ chatId: story.chatId, storySlug: story.slug, ...data });
			navigate({ to: '/$chatId', params: { chatId: story.chatId } });
		},
		[navigate, story?.chatId, story?.slug],
	);

	const handleOpenChat = useCallback(() => {
		if (!story) {
			return;
		}
		if (story.chatId) {
			navigate({ to: '/$chatId', params: { chatId: story.chatId }, state: { openStorySlug: story.slug } });
		} else {
			openStandaloneMutation.mutate({ storyId });
		}
	}, [story, storyId, navigate, openStandaloneMutation]);

	if (storyQuery.isLoading) {
		return (
			<div className='flex flex-1 items-center justify-center'>
				<Spinner />
			</div>
		);
	}

	if (!story) {
		return <div>Not Found</div>;
	}

	if (story.chatId) {
		return (
			<StandaloneEditableStory
				title={story.title}
				code={story.code}
				storyId={storyId}
				chatId={story.chatId}
				storySlug={story.slug}
				queryData={story.queryData as QueryDataMap | null}
				onOpenChat={handleOpenChat}
				isOpeningChat={openStandaloneMutation.isPending}
			/>
		);
	}

	return (
		<div className='flex flex-col flex-1 h-full overflow-hidden bg-background min-w-0'>
			<StoryPageHeader
				title={story.title}
				onOpenChat={handleOpenChat}
				isOpeningChat={openStandaloneMutation.isPending}
				download={{ storyId, isOwner: true }}
				storyId={storyId}
				live={story.isLive ? { isLive: true } : undefined}
				onOpenAnalytics={() => setIsAnalyticsOpen(true)}
			/>
			<SelectionProvider key={storyId}>
				<HighlightBubble onAsk={handleSelectionAsk} disabled />
				<StandaloneStoryContent code={story.code} queryData={story.queryData as QueryDataMap | null} />
			</SelectionProvider>

			<AssetAnalyticsDialog
				open={isAnalyticsOpen}
				onOpenChange={setIsAnalyticsOpen}
				assetType='story'
				storyId={storyId}
			/>
		</div>
	);
}

interface StandaloneEditableStoryProps {
	title: string;
	code: string;
	storyId: string;
	chatId: string;
	storySlug: string;
	queryData: QueryDataMap | null;
	onOpenChat: () => void;
	isOpeningChat: boolean;
}

function StandaloneEditableStory({
	title,
	code,
	storyId,
	chatId,
	storySlug,
	queryData,
	onOpenChat,
	isOpeningChat,
}: StandaloneEditableStoryProps) {
	const navigate = useNavigate();
	const [isLiveSettingsOpen, setIsLiveSettingsOpen] = useState(false);
	const [isShareDialogOpen, setIsShareDialogOpen] = useState(false);
	const [isAnalyticsOpen, setIsAnalyticsOpen] = useState(false);

	const {
		isLive,
		isLiveTextDynamic,
		cacheSchedule,
		cacheScheduleDescription,
		isUpdating,
		isRefreshing,
		handleSaveSettings,
		handleRefreshData,
	} = useStoryViewerLiveSettings({ chatId, storySlug });

	const shareQuery = useQuery(trpc.storyShare.getSharedStoryInfo.queryOptions({ chatId, storySlug }));
	const isShared = Boolean(shareQuery.data?.shareId);

	const editor = useStoryPageEditor({ chatId, storySlug, storyTitle: title, latestCode: code });

	const handleSelectionAsk = useCallback(
		(data: SelectionData) => {
			chatPendingCitationStore.set({ chatId, storySlug, ...data });
			navigate({ to: '/$chatId', params: { chatId } });
		},
		[navigate, chatId, storySlug],
	);

	return (
		<div className='flex flex-col flex-1 h-full overflow-hidden bg-background min-w-0'>
			<StoryPageHeader
				title={title}
				onOpenChat={onOpenChat}
				isOpeningChat={isOpeningChat}
				live={{
					isLive,
					isRefreshing,
					onRefresh: () => handleRefreshData(),
					onOpenSettings: () => setIsLiveSettingsOpen(true),
				}}
				download={{ storyId, isOwner: true }}
				storyId={storyId}
				isShared={isShared}
				onShare={() => setIsShareDialogOpen(true)}
				onOpenAnalytics={() => setIsAnalyticsOpen(true)}
				viewModeControls={{
					viewMode: editor.viewMode,
					onViewModeChange: editor.setViewMode,
					canEdit: true,
					isCodeDirty: editor.isCodeDirty,
					isCodeValid: editor.isCodeValid,
					onSave: editor.handleSave,
				}}
				versionControls={{
					currentVersion: editor.versionNav.currentVersion,
					totalVersions: editor.versionNav.totalVersions,
					isViewingLatest: editor.versionNav.isViewingLatest,
					onPrevious: editor.versionNav.goToPrevious,
					onNext: editor.versionNav.goToNext,
					onRestore: editor.handleRestore,
				}}
			/>

			<StoryPageBody
				code={editor.code}
				editor={editor}
				queryData={queryData}
				preview={
					<SelectionProvider key={storySlug}>
						<HighlightBubble onAsk={handleSelectionAsk} disabled={false} />
						<StandaloneStoryContent code={editor.code} queryData={queryData} />
					</SelectionProvider>
				}
			/>

			<LiveStorySettingsDialog
				open={isLiveSettingsOpen}
				onOpenChange={setIsLiveSettingsOpen}
				isLive={isLive}
				isLiveTextDynamic={isLiveTextDynamic}
				cacheSchedule={cacheSchedule}
				cacheScheduleDescription={cacheScheduleDescription}
				isUpdating={isUpdating}
				onSaveSettings={handleSaveSettings}
			/>

			<ShareStoryDialog
				open={isShareDialogOpen}
				onOpenChange={setIsShareDialogOpen}
				chatId={chatId}
				storySlug={storySlug}
			/>

			<AssetAnalyticsDialog
				open={isAnalyticsOpen}
				onOpenChange={setIsAnalyticsOpen}
				assetType='story'
				storyId={storyId}
			/>
		</div>
	);
}

function StandaloneStoryContent({ code, queryData }: { code: string; queryData: QueryDataMap | null }) {
	const segments = useMemo(() => splitCodeIntoSegments(code), [code]);

	const renderChart = useCallback(
		(chart: ParsedChartBlock) => <StoryChartEmbed chart={chart} queryData={queryData} />,
		[queryData],
	);

	const renderTable = useCallback(
		(table: ParsedTableBlock) => <StoryTableEmbed table={table} queryData={queryData} />,
		[queryData],
	);

	return (
		<div className='flex-1 overflow-auto'>
			<div className='max-w-5xl mx-auto p-4 md:p-8 flex flex-col gap-4'>
				<SegmentList segments={segments} renderChart={renderChart} renderTable={renderTable} />
			</div>
		</div>
	);
}
