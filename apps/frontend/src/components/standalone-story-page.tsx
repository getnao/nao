import { useQuery } from '@tanstack/react-query';
import { useCallback, useState } from 'react';
import type { ParsedChartBlock, ParsedMapBlock, ParsedTableBlock } from '@nao/shared/story-segments';

import type { QueryDataMap } from '@/components/story-embeds';
import { AssetAnalyticsDialog } from '@/components/asset-analytics-dialog';
import { HighlightBubble } from '@/components/highlight-bubble';
import { ShareDialog } from '@/components/share-dialog';
import { useStoryViewerSharing } from '@/components/side-panel/hooks/use-story-viewer-sharing';
import { StoryAccessError } from '@/components/story-access-error';
import { StoryChartEmbed, StoryMapEmbed, StoryTableEmbed } from '@/components/story-embeds';
import { StoryElementPicker } from '@/components/story-element-picker';
import { StoryTabbedContent } from '@/components/story-tabbed-content';
import { useStoryThemeForCurrentMode } from '@/components/story-theme-provider';
import { STORY_ASK_BAR_INSET_STYLE, StoryAskBar } from '@/components/story-ask-bar';
import { StoryPageHeader } from '@/components/story-page-header';
import { Spinner } from '@/components/ui/spinner';
import { SelectionProvider } from '@/contexts/text-selection';
import { requestAskAboutElement, requestAskAboutSelection } from '@/stores/ask-bar';
import { useOpenStandaloneStoryInChat } from '@/hooks/use-open-standalone-story-in-chat';
import { useTrackViewDuration } from '@/hooks/use-track-view-duration';
import { useElementSelectionMode } from '@/hooks/use-element-selection-mode';
import { trpc } from '@/main';

export function StandaloneStoryPage({ storyId }: { storyId: string }) {
	const [isAnalyticsOpen, setIsAnalyticsOpen] = useState(false);
	const [isSelectingElements, setIsSelectingElements] = useElementSelectionMode();
	const sharing = useStoryViewerSharing({ storyId });

	const storyQuery = useQuery(trpc.story.getStandalone.queryOptions({ storyId }));
	const story = storyQuery.data;
	const storyTheme = useStoryThemeForCurrentMode(story?.theme);
	const openInChat = useOpenStandaloneStoryInChat(storyId, story?.slug);

	useTrackViewDuration({ assetType: 'story', storyId, versionNumber: story?.version });

	if (storyQuery.isLoading) {
		return (
			<div className='flex flex-1 items-center justify-center'>
				<Spinner />
			</div>
		);
	}

	if (storyQuery.isError || !story) {
		return <StoryAccessError error={storyQuery.error} onRetry={() => storyQuery.refetch()} />;
	}

	const isArchived = Boolean(story.archivedAt);

	return (
		<div
			className='relative flex flex-col flex-1 h-full overflow-hidden bg-background min-w-0'
			style={isArchived ? undefined : STORY_ASK_BAR_INSET_STYLE}
		>
			<StoryPageHeader
				title={story.title}
				storyChat={{
					storyId,
					isOwner: true,
					canChat: !isArchived,
					onOpenInChat: story.chatId ? undefined : openInChat.open,
					isOpeningInChat: openInChat.isOpening,
				}}
				canDuplicate={!isArchived}
				download={{ storyId, isOwner: true }}
				storyId={storyId}
				canRename
				live={
					story.isLive
						? {
								isLive: true,
								cachedAt: story.cachedAt,
								lastRefreshFailure: story.lastRefreshFailure,
							}
						: undefined
				}
				isShared={sharing.isShared}
				onShare={() => sharing.setIsShareDialogOpen(true)}
				onOpenAnalytics={() => setIsAnalyticsOpen(true)}
				elementSelection={
					isArchived
						? undefined
						: { isSelecting: isSelectingElements, onSelectingChange: setIsSelectingElements }
				}
			/>
			<div className='relative flex min-h-0 flex-1 flex-col'>
				<SelectionProvider key={storyId}>
					<HighlightBubble
						onAsk={(selection) => requestAskAboutSelection(selection, story.slug)}
						disabled={isArchived}
					/>
					<StoryElementPicker
						isPicking={!isArchived && isSelectingElements}
						storySlug={story.slug}
						onPick={(ask) => requestAskAboutElement(ask, story.slug)}
					>
						<StandaloneStoryContent
							code={story.code}
							queryData={story.queryData as QueryDataMap | null}
							theme={storyTheme}
							chatId={story.chatId}
							storySlug={story.slug}
						/>
					</StoryElementPicker>

					{!isArchived && <StoryAskBar storyId={storyId} canEdit />}
				</SelectionProvider>
			</div>

			<ShareDialog
				open={sharing.isShareDialogOpen}
				onOpenChange={sharing.setIsShareDialogOpen}
				target={{ kind: 'standalone-story', storyId }}
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

function StandaloneStoryContent({
	code,
	queryData,
	theme,
	chatId,
	storySlug,
	filtersEnabled = true,
	isDataPending = false,
}: {
	code: string;
	queryData: QueryDataMap | null;
	theme: ReturnType<typeof useStoryThemeForCurrentMode>;
	chatId?: string | null;
	storySlug?: string;
	filtersEnabled?: boolean;
	isDataPending?: boolean;
}) {
	const filterApi = filtersEnabled && chatId && storySlug ? { kind: 'owned' as const, chatId, storySlug } : null;

	const renderChart = useCallback(
		(
			chart: ParsedChartBlock,
			{
				queryData: data,
				hasActiveFilters,
				isRefreshing,
			}: {
				queryData: QueryDataMap | null;
				hasActiveFilters: boolean;
				isRefreshing: boolean;
			},
		) => (
			<StoryChartEmbed
				chart={chart}
				queryData={data}
				hasActiveFilters={hasActiveFilters}
				isRefreshing={isRefreshing}
				isDataPending={isDataPending}
			/>
		),
		[isDataPending],
	);

	const renderTable = useCallback(
		(
			table: ParsedTableBlock,
			{
				queryData: data,
				hasActiveFilters,
				isRefreshing,
			}: { queryData: QueryDataMap | null; hasActiveFilters: boolean; isRefreshing: boolean },
		) => (
			<StoryTableEmbed
				table={table}
				queryData={data}
				hasActiveFilters={hasActiveFilters}
				isRefreshing={isRefreshing}
				isDataPending={isDataPending}
			/>
		),
		[isDataPending],
	);

	const renderMap = useCallback(
		(
			map: ParsedMapBlock,
			{
				queryData: data,
				hasActiveFilters,
				isRefreshing,
			}: { queryData: QueryDataMap | null; hasActiveFilters: boolean; isRefreshing: boolean },
		) => (
			<StoryMapEmbed
				map={map}
				queryData={data}
				hasActiveFilters={hasActiveFilters}
				isRefreshing={isRefreshing}
				isDataPending={isDataPending}
				allowExpand
			/>
		),
		[isDataPending],
	);

	return (
		<StoryTabbedContent
			code={code}
			storySlug={storySlug}
			baselineQueryData={queryData}
			theme={theme}
			filterApi={filterApi}
			renderChart={renderChart}
			renderTable={renderTable}
			renderMap={renderMap}
		/>
	);
}
