import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { DownloadFormat } from '@nao/shared/types';

import type { CustomStoryFileSource } from '@/components/custom-story/story-data-options';
import { useCustomStoryDownload } from '@/components/custom-story/use-custom-story-download';
import { useChatActivity } from '@/hooks/use-chat-activity';
import { trpc, trpcClient } from '@/main';

export function useCustomStory(chatId: string, storySlug: string) {
	const queryClient = useQueryClient();
	const [selectedVersion, setSelectedVersion] = useState<number | null>(null);
	const isAgentRunning = useChatActivity(chatId).running;

	const versionsQuery = useQuery(trpc.story.listVersions.queryOptions({ chatId, storySlug }));
	const versionNumbers = useMemo(
		() => (versionsQuery.data?.versions ?? []).map((version) => version.version).sort((a, b) => a - b),
		[versionsQuery.data?.versions],
	);
	const latestVersion = versionNumbers.at(-1) ?? null;
	const viewedVersion = selectedVersion ?? latestVersion;
	const versionDates = useMemo(
		() =>
			[...(versionsQuery.data?.versions ?? [])]
				.sort((a, b) => a.version - b.version)
				.map((version) => version.createdAt),
		[versionsQuery.data?.versions],
	);
	const viewedVersionDate = versionsQuery.data?.versions.find(
		(version) => version.version === viewedVersion,
	)?.createdAt;
	const isViewingLatest = viewedVersion === latestVersion;

	const contentQuery = useQuery({
		...trpc.story.getCustomVersion.queryOptions({ chatId, storySlug, versionNumber: viewedVersion ?? undefined }),
		enabled: viewedVersion !== null,
	});
	const dataSource = useMemo<CustomStoryFileSource>(
		() => ({ kind: 'owner', chatId, storySlug }),
		[chatId, storySlug],
	);

	const goToVersion = useCallback(
		(position: number) => setSelectedVersion(versionNumbers[position - 1] ?? null),
		[versionNumbers],
	);
	const goToLatest = useCallback(() => setSelectedVersion(null), []);

	const restoreMutation = useMutation(
		trpc.story.restoreCustomVersion.mutationOptions({
			onSuccess: async () => {
				await queryClient.invalidateQueries({
					queryKey: trpc.story.listVersions.queryKey({ chatId, storySlug }),
				});
				setSelectedVersion(null);
			},
		}),
	);
	const restore = useCallback(() => {
		if (latestVersion === null || viewedVersion === null || isViewingLatest) {
			return;
		}
		restoreMutation.mutate({
			chatId,
			storySlug,
			versionNumber: latestVersion,
			restoreVersionNumber: viewedVersion,
		});
	}, [chatId, isViewingLatest, latestVersion, restoreMutation, storySlug, viewedVersion]);

	const renderExport = useCallback(
		(format: DownloadFormat, html: string) =>
			trpcClient.story.downloadCustom.mutate({
				chatId,
				storySlug,
				format,
				html,
				versionNumber: viewedVersion ?? undefined,
			}),
		[chatId, storySlug, viewedVersion],
	);
	const download = useCustomStoryDownload(contentQuery.data, dataSource, renderExport);

	useRefreshWhenAgentStops(chatId, storySlug, isAgentRunning);

	return {
		versionsQuery,
		contentQuery,
		content: contentQuery.data,
		dataSource,
		isAgentRunning,
		versionNumbers,
		latestVersion,
		viewedVersion,
		viewedVersionDate,
		isViewingLatest,
		currentVersionIndex: viewedVersion === null ? 0 : versionNumbers.indexOf(viewedVersion) + 1,
		versionDates,
		goToVersion,
		goToLatest,
		restore,
		isRestoring: restoreMutation.isPending,
		restoreError: restoreMutation.error,
		download,
		isLoading: versionsQuery.isLoading || (latestVersion !== null && contentQuery.isLoading),
	};
}

function useRefreshWhenAgentStops(chatId: string, storySlug: string, isRunning: boolean) {
	const queryClient = useQueryClient();
	const wasRunning = useRef(isRunning);
	useEffect(() => {
		if (wasRunning.current && !isRunning) {
			void queryClient.invalidateQueries({ queryKey: trpc.story.listVersions.queryKey({ chatId, storySlug }) });
		}
		wasRunning.current = isRunning;
	}, [chatId, isRunning, queryClient, storySlug]);
}
