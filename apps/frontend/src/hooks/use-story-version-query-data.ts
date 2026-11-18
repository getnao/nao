import { useQuery } from '@tanstack/react-query';

import type { QueryDataMap } from '@/components/story-embeds';
import { trpc } from '@/main';

interface UseStoryVersionQueryDataParams {
	chatId: string;
	storySlug: string;
	versionNumber: number;
	isViewingLatest: boolean;
	latestQueryData: QueryDataMap | null;
	sharedStoryId?: string;
	standaloneStoryId?: string;
}

export function useStoryVersionQueryData({
	chatId,
	storySlug,
	versionNumber,
	isViewingLatest,
	latestQueryData,
	sharedStoryId,
	standaloneStoryId,
}: UseStoryVersionQueryDataParams): { queryData: QueryDataMap | null; isPending: boolean } {
	const hasVersionNumber = Number.isInteger(versionNumber) && versionNumber > 0;
	const shouldFetchHistoricalData = !isViewingLatest && hasVersionNumber;
	const ownedVersionQuery = useQuery({
		...trpc.story.getVersionQueryData.queryOptions({ chatId, storySlug, versionNumber }),
		enabled: shouldFetchHistoricalData && !sharedStoryId && !standaloneStoryId,
	});
	const sharedVersionQuery = useQuery({
		...trpc.storyShare.getVersionQueryData.queryOptions({ storyId: sharedStoryId ?? '', versionNumber }),
		enabled: shouldFetchHistoricalData && Boolean(sharedStoryId),
	});
	const standaloneVersionQuery = useQuery({
		...trpc.story.getStandaloneVersionQueryData.queryOptions({ storyId: standaloneStoryId ?? '', versionNumber }),
		enabled: shouldFetchHistoricalData && Boolean(standaloneStoryId),
	});

	if (isViewingLatest) {
		return { queryData: latestQueryData, isPending: false };
	}

	const historicalVersionQuery = sharedStoryId
		? sharedVersionQuery
		: standaloneStoryId
			? standaloneVersionQuery
			: ownedVersionQuery;
	return {
		queryData: (historicalVersionQuery.data?.queryData as QueryDataMap | null | undefined) ?? null,
		isPending: !hasVersionNumber || historicalVersionQuery.isPending,
	};
}
