import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useCallback, useState } from 'react';
import type { ParsedChartBlock, ParsedMapBlock, ParsedTableBlock } from '@nao/shared/story-segments';

import type { SelectionData } from '@/components/highlight-bubble';
import type { QueryDataMap } from '@/components/story-embeds';
import { AssetAnalyticsDialog } from '@/components/asset-analytics-dialog';
import { HighlightBubble } from '@/components/highlight-bubble';
import { StoryAccessError } from '@/components/story-access-error';
import { StoryChartEmbed, StoryMapEmbed, StoryTableEmbed } from '@/components/story-embeds';
import { StoryTabbedContent } from '@/components/story-tabbed-content';
import { StoryPageHeader } from '@/components/story-page-header';
import { Spinner } from '@/components/ui/spinner';
import { SelectionProvider } from '@/contexts/text-selection';
import { chatPendingCitationStore } from '@/stores/chat-pending-citation';
import { useTrackViewDuration } from '@/hooks/use-track-view-duration';
import { trpc } from '@/main';

export function StandaloneStoryPage({ storyId }: { storyId: string }) {
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
				queryClient.invalidateQueries({ queryKey: trpc.story.resolve.queryKey({ storyId }) });
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

	if (storyQuery.isError || !story) {
		return <StoryAccessError error={storyQuery.error} onRetry={() => storyQuery.refetch()} />;
	}

	return (
		<div className='flex flex-col flex-1 h-full overflow-hidden bg-background min-w-0'>
			<StoryPageHeader
				title={story.title}
				onOpenChat={handleOpenChat}
				isOpeningChat={openStandaloneMutation.isPending}
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
			/>
			<SelectionProvider key={storyId}>
				<HighlightBubble onAsk={handleSelectionAsk} disabled />
				<StandaloneStoryContent
					code={story.code}
					queryData={story.queryData as QueryDataMap | null}
					chatId={story.chatId}
					storySlug={story.slug}
				/>
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

function StandaloneStoryContent({
	code,
	queryData,
	chatId,
	storySlug,
	filtersEnabled = true,
	isDataPending = false,
}: {
	code: string;
	queryData: QueryDataMap | null;
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
			filterApi={filterApi}
			renderChart={renderChart}
			renderTable={renderTable}
			renderMap={renderMap}
		/>
	);
}
