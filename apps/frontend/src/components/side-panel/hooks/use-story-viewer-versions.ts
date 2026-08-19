import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useDebouncedCallback } from '@/hooks/use-debounced-callback';
import { trpc } from '@/main';

const STORY_REFRESH_DEBOUNCE_MS = 400;

interface UseStoryViewerVersionsParams {
	chatId: string;
	storySlug: string;
	isAgentRunning: boolean;
	latestStoryOutputVersion?: number | null;
	isReadonlyMode?: boolean;
}

interface HistoricalVersionSelection {
	chatId: string;
	storySlug: string;
	index: number;
}

export const useStoryViewerVersions = ({
	chatId,
	storySlug,
	isAgentRunning,
	latestStoryOutputVersion = null,
	isReadonlyMode,
}: UseStoryViewerVersionsParams) => {
	const queryClient = useQueryClient();
	const { data, refetch } = useQuery({
		...trpc.story.listVersions.queryOptions({ chatId, storySlug }),
		enabled: !isReadonlyMode,
	});
	const versions = useMemo(() => data?.versions ?? [], [data?.versions]);
	const storyId = data?.id ?? null;
	const storyTitle = data?.title;
	const archivedAt = data?.archivedAt;
	const [historicalVersionSelection, setHistoricalVersionSelection] = useState<HistoricalVersionSelection | null>(
		null,
	);
	const previousRunningRef = useRef(isAgentRunning);
	const latestStoryOutputRef = useRef({ storySlug, version: latestStoryOutputVersion });
	const refreshStoryData = useCallback(() => {
		void refetch();
		void queryClient.invalidateQueries({ queryKey: trpc.story.listAll.queryKey() });
		void queryClient.invalidateQueries({
			queryKey: trpc.story.getLatest.queryKey({ chatId, storySlug }),
		});
	}, [chatId, queryClient, refetch, storySlug]);
	const debouncedRefreshStoryData = useDebouncedCallback(refreshStoryData, STORY_REFRESH_DEBOUNCE_MS);

	useEffect(() => {
		if (previousRunningRef.current && !isAgentRunning) {
			refreshStoryData();
		}

		previousRunningRef.current = isAgentRunning;
	}, [isAgentRunning, refreshStoryData]);

	useEffect(() => {
		if (latestStoryOutputRef.current.storySlug !== storySlug) {
			latestStoryOutputRef.current = { storySlug, version: latestStoryOutputVersion };
			return;
		}

		if (latestStoryOutputVersion === null || latestStoryOutputRef.current.version === latestStoryOutputVersion) {
			return;
		}

		latestStoryOutputRef.current.version = latestStoryOutputVersion;
		debouncedRefreshStoryData();
	}, [debouncedRefreshStoryData, latestStoryOutputVersion, storySlug]);

	useEffect(() => {
		setHistoricalVersionSelection((selection) => {
			if (resolveHistoricalVersionIndex(selection, chatId, storySlug, versions.length) !== null) {
				return selection;
			}

			return null;
		});
	}, [chatId, storySlug, versions.length]);

	const selectedVersionIndex = resolveHistoricalVersionIndex(
		historicalVersionSelection,
		chatId,
		storySlug,
		versions.length,
	);

	const currentVersionIndex = selectedVersionIndex ?? versions.length - 1;
	const currentVersion = versions[currentVersionIndex];
	const currentVersionNumber = currentVersionIndex + 1;
	const storedVersionNumber = currentVersion?.version ?? 0;
	const isViewingLatest = selectedVersionIndex === null;

	const goToPreviousVersion = useCallback(() => {
		if (currentVersionIndex <= 0) {
			return;
		}

		setHistoricalVersionSelection({
			chatId,
			storySlug,
			index: currentVersionIndex - 1,
		});
	}, [chatId, currentVersionIndex, storySlug]);

	const goToNextVersion = useCallback(() => {
		if (selectedVersionIndex === null) {
			return;
		}

		const nextVersionIndex = selectedVersionIndex + 1;
		setHistoricalVersionSelection(
			nextVersionIndex >= versions.length - 1 ? null : { chatId, storySlug, index: nextVersionIndex },
		);
	}, [chatId, selectedVersionIndex, storySlug, versions.length]);

	const goToLatestVersion = useCallback(() => {
		setHistoricalVersionSelection(null);
	}, []);

	return {
		versions,
		storyId,
		storyTitle,
		archivedAt,
		currentVersion,
		currentVersionNumber,
		storedVersionNumber,
		isViewingLatest,
		goToPreviousVersion,
		goToNextVersion,
		goToLatestVersion,
	};
};

function resolveHistoricalVersionIndex(
	selection: HistoricalVersionSelection | null,
	chatId: string,
	storySlug: string,
	versionCount: number,
) {
	if (
		selection?.chatId !== chatId ||
		selection.storySlug !== storySlug ||
		selection.index < 0 ||
		selection.index >= versionCount - 1
	) {
		return null;
	}

	return selection.index;
}
