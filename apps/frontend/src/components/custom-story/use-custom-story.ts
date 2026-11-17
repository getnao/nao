import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { DownloadFormat } from '@nao/shared/types';

import type { CustomStoryFileSource } from '@/components/custom-story/story-data-options';
import { useCustomStoryDownload } from '@/components/custom-story/use-custom-story-download';
import { useChatActivity } from '@/hooks/use-chat-activity';
import { trpc, trpcClient } from '@/main';

export function useCustomStory(chatId: string, storySlug: string) {
	const queryClient = useQueryClient();
	const { selectedVersion, setSelectedVersion } = useSelectedVersion(`${chatId}:${storySlug}`);
	const isAgentRunning = useChatActivity(chatId).running;

	const versionsQuery = useQuery(trpc.story.listVersions.queryOptions({ chatId, storySlug }));
	const versionNumbers = useMemo(
		() => (versionsQuery.data?.versions ?? []).map((version) => version.version).sort((a, b) => a - b),
		[versionsQuery.data?.versions],
	);
	const latestVersion = versionNumbers.at(-1) ?? null;
	const viewedVersion = selectedVersion ?? latestVersion;
	const versions = useMemo(() => {
		return [...(versionsQuery.data?.versions ?? [])].sort((a, b) => a.version - b.version);
	}, [versionsQuery.data?.versions]);
	const viewedVersionDate = versionsQuery.data?.versions.find(
		(version) => version.version === viewedVersion,
	)?.createdAt;
	const isViewingLatest = viewedVersion === latestVersion;

	const contentQuery = useQuery({
		...trpc.story.getCustomVersion.queryOptions({ chatId, storySlug, versionNumber: viewedVersion ?? undefined }),
		enabled: viewedVersion !== null,
	});
	const olderVersionNumber = isViewingLatest ? undefined : (viewedVersion ?? undefined);
	const dataSource = useMemo<CustomStoryFileSource>(
		() => ({ kind: 'owner', chatId, storySlug, versionNumber: olderVersionNumber }),
		[chatId, storySlug, olderVersionNumber],
	);

	const goToVersion = useCallback(
		(position: number) => setSelectedVersion(versionNumbers[position - 1] ?? null),
		[setSelectedVersion, versionNumbers],
	);
	const goToLatest = useCallback(() => setSelectedVersion(null), [setSelectedVersion]);

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
		isArchived: Boolean(versionsQuery.data?.archivedAt),
		versionNumbers,
		latestVersion,
		viewedVersion,
		viewedVersionDate,
		isViewingLatest,
		currentVersionIndex: viewedVersion === null ? 0 : versionNumbers.indexOf(viewedVersion) + 1,
		versions,
		goToVersion,
		goToLatest,
		restore,
		isRestoring: restoreMutation.isPending,
		restoreError: restoreMutation.error,
		download,
		isLoading: versionsQuery.isLoading || (latestVersion !== null && contentQuery.isLoading),
		error: versionsQuery.error ?? contentQuery.error,
		hasPublishedVersion: versionsQuery.isError || latestVersion !== null,
	};
}

/** The versions of a custom story outside any chat, and the one its owner views. */
export function useStandaloneCustomStoryVersions(storyId: string) {
	const { selectedVersion, setSelectedVersion } = useSelectedVersion(storyId);
	const storyQuery = useQuery(trpc.standaloneCustomStory.listVersions.queryOptions({ storyId }));
	const versions = useMemo(() => storyQuery.data?.versions ?? [], [storyQuery.data?.versions]);
	const selectedIndex = versions.findIndex((version) => version.version === selectedVersion);
	const viewedIndex = selectedIndex === -1 ? versions.length - 1 : selectedIndex;

	const goToVersion = useCallback(
		(position: number) => {
			setSelectedVersion(position >= versions.length ? null : (versions[position - 1]?.version ?? null));
		},
		[setSelectedVersion, versions],
	);

	return {
		storyQuery,
		selectedVersion: selectedIndex === -1 ? null : selectedVersion,
		currentVersion: viewedIndex + 1,
		versions,
		versionDate: versions[viewedIndex]?.createdAt,
		isViewingLatest: selectedIndex === -1,
		goToVersion,
	};
}

function useSelectedVersion(storyKey: string) {
	const [selection, setSelection] = useState<{ storyKey: string; version: number } | null>(null);
	const selectedVersion = selection?.storyKey === storyKey ? selection.version : null;
	const setSelectedVersion = useCallback(
		(version: number | null) => setSelection(version === null ? null : { storyKey, version }),
		[storyKey],
	);
	return { selectedVersion, setSelectedVersion };
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
