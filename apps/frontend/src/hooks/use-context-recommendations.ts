import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import type { inferRouterOutputs } from '@trpc/server';
import type { TrpcRouter } from '@nao/backend/trpc';

import { findContextFileEdit, groupRecommendationsByFile } from '@/lib/context-hub-recommendations';
import { trpc } from '@/main';

export type ContextRecommendation = inferRouterOutputs<TrpcRouter>['contextRecommendation']['list'][number];

export function useContextRecommendationsEnabled(): boolean {
	const config = useQuery(trpc.system.getPublicConfig.queryOptions());
	return config.data?.betaContextRecommendationsEnabled === true;
}

/** The open recommendations proposing a change to a context file, by file, when recommendations are enabled. */
export function useOpenRecommendationsByFile() {
	const isEnabled = useContextRecommendationsEnabled();
	const recommendations = useQuery({
		...trpc.contextRecommendation.list.queryOptions({ status: 'open' }),
		enabled: isEnabled,
	});
	const recommendationsByFile = useMemo(
		() => groupRecommendationsByFile(recommendations.data ?? []),
		[recommendations.data],
	);
	return { isEnabled, isLoading: recommendations.isLoading, recommendationsByFile };
}

/** The open recommendations proposing a change to the file, each with the edit it proposes there. */
export function useFileRecommendations(path: string | null) {
	const { recommendationsByFile } = useOpenRecommendationsByFile();
	return useMemo(() => {
		if (!path) {
			return [];
		}
		return (recommendationsByFile.get(path) ?? []).flatMap((recommendation) => {
			const edit = findContextFileEdit(recommendation, path);
			return edit ? [{ recommendation, edit }] : [];
		});
	}, [recommendationsByFile, path]);
}
