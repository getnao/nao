import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useCallback, useState } from 'react';
import type { ParsedChartBlock, ParsedMapBlock, ParsedTableBlock } from '@nao/shared/story-segments';

import type { QueryDataMap } from '@/components/story-embeds';
import { AssetAnalyticsDialog } from '@/components/asset-analytics-dialog';
import { HighlightBubble } from '@/components/highlight-bubble';
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
import { useTrackViewDuration } from '@/hooks/use-track-view-duration';
import { useElementSelectionMode } from '@/hooks/use-element-selection-mode';
import { trpc } from '@/main';

export function StandaloneStoryPage({ storyId }: { storyId: string }) {
	const navigate = useNavigate();
	const [isAnalyticsOpen, setIsAnalyticsOpen] = useState(false);
	const [isSelectingElements, setIsSelectingElements] = useElementSelectionMode();
	const queryClient = useQueryClient();

	const storyQuery = useQuery(trpc.story.getStandalone.queryOptions({ storyId }));
	const story = storyQuery.data;
	const storyTheme = useStoryThemeForCurrentMode(story?.theme);

	useTrackViewDuration({ assetType: 'story', storyId, versionNumber: story?.version });

	const openStandaloneMutation = useMutation(
		trpc.chatFork.openStandalone.mutationOptions({
			onSuccess: ({ chatId }) => {
				queryClient.invalidateQueries({ queryKey: trpc.story.listAll.queryKey() });
				queryClient.invalidateQueries({ queryKey: trpc.story.listStandalone.queryKey() });
				queryClient.invalidateQueries({ queryKey: trpc.story.resolve.queryKey({ storyId }) });
				navigate({ to: '/$chatId', params: { chatId }, state: { openStorySlug: story?.slug } });
			},
		}),
	);
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
					onOpenInChat: story.chatId ? undefined : () => openStandaloneMutation.mutate({ storyId }),
					isOpeningInChat: openStandaloneMutation.isPending,
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
				onOpenAnalytics={() => setIsAnalyticsOpen(true)}
				elementSelection={
					isArchived
						? undefined
						: { isSelecting: isSelectingElements, onSelectingChange: setIsSelectingElements }
				}
			/>
			<div className='relative flex min-h-0 flex-1 flex-col'>
				<SelectionProvider key={storyId}>
					<HighlightBubble onAsk={requestAskAboutSelection} disabled={isArchived} />
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

					{!isArchived && <StoryAskBar storyId={storyId} isOwner />}
				</SelectionProvider>
			</div>

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
			baselineQueryData={queryData}
			theme={theme}
			filterApi={filterApi}
			renderChart={renderChart}
			renderTable={renderTable}
			renderMap={renderMap}
		/>
	);
}
