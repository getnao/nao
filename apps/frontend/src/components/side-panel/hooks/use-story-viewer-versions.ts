import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { trpc } from '@/main';

interface UseStoryViewerVersionsParams {
	chatId: string;
	storyId: string;
	isAgentRunning: boolean;
}

export const useStoryViewerVersions = ({ chatId, storyId, isAgentRunning }: UseStoryViewerVersionsParams) => {
	const queryClient = useQueryClient();
	const { data, refetch } = useQuery(trpc.story.listVersions.queryOptions({ chatId, storyId }));
	const versions = useMemo(() => data ?? [], [data]);
	const [selectedVersionIndex, setSelectedVersionIndex] = useState(-1);
	const previousRunningRef = useRef(isAgentRunning);

	useEffect(() => {
		if (previousRunningRef.current && !isAgentRunning) {
			void refetch();
			void queryClient.invalidateQueries({ queryKey: trpc.story.listAll.queryKey() });
		}

		previousRunningRef.current = isAgentRunning;
	}, [isAgentRunning, queryClient, refetch]);

	useEffect(() => {
		setSelectedVersionIndex(versions.length - 1);
	}, [versions.length]);

	const currentVersion = useMemo(
		() => versions[selectedVersionIndex] ?? versions.at(-1),
		[versions, selectedVersionIndex],
	);

	const currentVersionNumber = selectedVersionIndex >= 0 ? selectedVersionIndex + 1 : versions.length;
	const isViewingLatest = selectedVersionIndex === versions.length - 1;

	const goToPreviousVersion = useCallback(() => {
		setSelectedVersionIndex((index) => Math.max(0, index - 1));
	}, []);

	const goToNextVersion = useCallback(() => {
		setSelectedVersionIndex((index) => Math.min(versions.length - 1, index + 1));
	}, [versions.length]);

	return {
		versions,
		currentVersion,
		currentVersionNumber,
		isViewingLatest,
		goToPreviousVersion,
		goToNextVersion,
	};
};
