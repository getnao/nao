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
}

export function useStoryVersionQueryData({
	chatId,
	storySlug,
	versionNumber,
	isViewingLatest,
	latestQueryData,
	sharedStoryId,
}: UseStoryVersionQueryDataParams): { queryData: QueryDataMap | null; isPending: boolean } {
	const hasVersionNumber = Number.isInteger(versionNumber) && versionNumber > 0;
	const shouldFetchHistoricalData = !isViewingLatest && hasVersionNumber;
	const ownedVersionQuery = useQuery({
		...trpc.story.getVersionQueryData.queryOptions({ chatId, storySlug, versionNumber }),
		enabled: shouldFetchHistoricalData && !sharedStoryId,
	});
	const sharedVersionQuery = useQuery({
		...trpc.storyShare.getVersionQueryData.queryOptions({ storyId: sharedStoryId ?? '', versionNumber }),
		enabled: shouldFetchHistoricalData && Boolean(sharedStoryId),
	});

	if (isViewingLatest) {
		return { queryData: latestQueryData, isPending: false };
	}

	const historicalVersionQuery = sharedStoryId ? sharedVersionQuery : ownedVersionQuery;
	return {
		queryData: (historicalVersionQuery.data?.queryData as QueryDataMap | null | undefined) ?? null,
		isPending: !hasVersionNumber || historicalVersionQuery.isPending,
	};
}
