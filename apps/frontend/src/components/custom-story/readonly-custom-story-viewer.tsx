import { useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { CustomStoryViewerAccess } from '@nao/shared/story-app';
import type { DownloadFormat } from '@nao/shared/types';

import type { CustomStoryViewMode } from '@/components/custom-story/custom-story-view-mode';
import type { CustomStoryFileSource } from '@/components/custom-story/story-data-options';
import { AssetAnalyticsDialog } from '@/components/asset-analytics-dialog';
import { CustomStoryBody } from '@/components/custom-story/custom-story-body';
import { CustomStoryFiles } from '@/components/custom-story/custom-story-files';
import { CustomStoryViewLayers } from '@/components/custom-story/custom-story-view-mode';
import { useCustomStoryDownload } from '@/components/custom-story/use-custom-story-download';
import { useStoryViewerAgentState } from '@/components/side-panel/hooks/use-story-viewer-agent-state';
import { useStoryViewerSwitchStory } from '@/components/side-panel/hooks/use-story-viewer-switch-story';
import { StoryHeader } from '@/components/side-panel/story-header';
import { StoryViewer } from '@/components/side-panel/story-viewer';
import { useSidePanel } from '@/contexts/side-panel';
import { useTrackViewDuration } from '@/hooks/use-track-view-duration';
import { trpc, trpcClient } from '@/main';

interface ReadonlyCustomStoryViewerProps {
	chatId: string;
	storySlug: string;
	access: CustomStoryViewerAccess;
}

export function ReadonlyCustomStoryViewer({ chatId, storySlug, access }: ReadonlyCustomStoryViewerProps) {
	const { close, setCurrentStorySlug, isReplay, shareId, shareType } = useSidePanel();
	const [viewMode, setViewMode] = useState<CustomStoryViewMode>('app');
	const [isAnalyticsOpen, setIsAnalyticsOpen] = useState(false);
	const contentQuery = useQuery(trpc.customStoryViewer.getVersion.queryOptions({ access, storySlug }));
	const content = contentQuery.data;
	const dataSource = useMemo<CustomStoryFileSource>(
		() => ({ kind: 'viewer', access, storySlug }),
		[access, storySlug],
	);
	const { allStories } = useStoryViewerAgentState(storySlug);
	const renderStoryViewer = useCallback(
		(nextStorySlug: string) => <StoryViewer chatId={chatId} storySlug={nextStorySlug} />,
		[chatId],
	);
	const { switchStory } = useStoryViewerSwitchStory({ renderStoryViewer });
	const renderExport = useCallback(
		(format: DownloadFormat, html: string) =>
			trpcClient.customStoryViewer.download.mutate({ access, storySlug, format, html }),
		[access, storySlug],
	);
	const download = useCustomStoryDownload(content, dataSource, renderExport);

	useTrackViewDuration({
		assetType: 'story',
		chatId,
		storySlug,
		storyId: content?.storyId,
		versionNumber: content?.version.number,
		enabled: !isReplay,
	});
	useEffect(() => {
		setCurrentStorySlug(storySlug);
	}, [setCurrentStorySlug, storySlug]);

	return (
		<div className='flex h-full w-full min-w-0 flex-1 flex-col'>
			<StoryHeader
				title={content?.title ?? storySlug}
				chatId={chatId}
				storySlug={storySlug}
				storyId={content?.storyId}
				shareId={shareId}
				shareType={shareType}
				allStories={allStories}
				onSwitchStory={switchStory}
				viewMode={viewMode}
				onViewModeChange={setViewMode}
				currentVersion={content ? 1 : 0}
				versionDates={content ? [content.version.createdAt] : []}
				versionNumber={content?.version.number}
				versionDate={content?.version.createdAt}
				onSelectVersion={ignore}
				isViewingLatest
				onRestore={ignore}
				onShare={ignore}
				onOpenAnalytics={() => setIsAnalyticsOpen(true)}
				onEnlarge={ignore}
				isShared={false}
				isAgentRunning={false}
				isStoryUpdating={false}
				isReadonlyMode
				isReplay={isReplay}
				isLive={content?.isLive ?? false}
				isLiveUpdating={false}
				isRefreshing={false}
				onRefreshData={ignore}
				onOpenLiveSettings={ignore}
				onClose={close}
				cachedAt={content?.cachedAt}
				lastRefreshFailure={content?.lastRefreshFailure}
				onDownload={download}
			/>

			<CustomStoryViewLayers
				viewMode={viewMode}
				app={
					<CustomStoryBody
						dataSource={dataSource}
						content={content}
						isLoading={contentQuery.isLoading}
						error={contentQuery.error}
						hasPublishedVersion
					/>
				}
				files={
					content && (
						<CustomStoryFiles
							key={content.version.id}
							source={dataSource}
							versionNumber={content.version.number}
							files={content.files}
						/>
					)
				}
			/>

			<AssetAnalyticsDialog
				open={isAnalyticsOpen}
				onOpenChange={setIsAnalyticsOpen}
				assetType='story'
				chatId={chatId}
				storyId={content?.storyId}
				storySlug={storySlug}
			/>
		</div>
	);
}

function ignore() {}
