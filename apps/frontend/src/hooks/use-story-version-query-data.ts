import { useQuery } from '@tanstack/react-query';

import type { QueryDataMap } from '@/components/story-embeds';
import { trpc } from '@/main';

interface UseStoryVersionQueryDataParams {
	chatId: string;
	storySlug: string;
	versionNumber: number;
	isViewingLatest: boolean;
	latestQueryData: QueryDataMap | null;
	shareId?: string;
}

export function useStoryVersionQueryData({
	chatId,
	storySlug,
	versionNumber,
	isViewingLatest,
	latestQueryData,
	shareId,
}: UseStoryVersionQueryDataParams): { queryData: QueryDataMap | null; isPending: boolean } {
	const hasVersionNumber = Number.isInteger(versionNumber) && versionNumber > 0;
	const shouldFetchHistoricalData = !isViewingLatest && hasVersionNumber;
	const ownedVersionQuery = useQuery({
		...trpc.story.getVersionQueryData.queryOptions({ chatId, storySlug, versionNumber }),
		enabled: shouldFetchHistoricalData && !shareId,
	});
	const sharedVersionQuery = useQuery({
		...trpc.storyShare.getVersionQueryData.queryOptions({ shareId: shareId ?? '', versionNumber }),
		enabled: shouldFetchHistoricalData && Boolean(shareId),
	});

	if (isViewingLatest) {
		return { queryData: latestQueryData, isPending: false };
	}

	const historicalVersionQuery = shareId ? sharedVersionQuery : ownedVersionQuery;
	return {
		queryData: (historicalVersionQuery.data?.queryData as QueryDataMap | null | undefined) ?? null,
		isPending: !hasVersionNumber || historicalVersionQuery.isPending,
	};
}
