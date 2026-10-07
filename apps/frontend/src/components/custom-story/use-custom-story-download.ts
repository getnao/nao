import { useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { buildStoryExportDocument } from '@nao/shared/story-document';
import { STORY_RUNTIME_PATH, STORY_STANDALONE_RUNTIME_FILE } from '@nao/shared/story-app';
import type { QueryClient } from '@tanstack/react-query';
import type { DownloadFormat } from '@nao/shared/types';
import type { StoryExportData, StoryQueryResult } from '@nao/shared/story-app';

import type { CustomStoryContent } from '@/components/custom-story/custom-story-body';
import type { CustomStoryDataSource } from '@/components/custom-story/story-data-options';
import type { StoryDownloadFile } from '@/components/story-download';
import { useActiveStoryTheme } from '@/components/custom-story/custom-story-body';
import { narrativesOptions, queryDataOptions, stateOptions } from '@/components/custom-story/story-data-options';
import { savedViewOf } from '@/components/custom-story/use-story-state-session';
import { isForbiddenError, isNotFoundError } from '@/lib/trpc-error';

type RenderExport = (format: DownloadFormat, html: string) => Promise<StoryDownloadFile>;

let standaloneRuntime: Promise<string> | null = null;

/** A custom story downloads as a self-contained page running its own code; the server turns it into the file. */
export function useCustomStoryDownload(
	content: CustomStoryContent | undefined,
	dataSource: CustomStoryDataSource,
	render: RenderExport,
) {
	const queryClient = useQueryClient();
	const theme = useActiveStoryTheme(content?.theme);
	return useCallback(
		async (format: DownloadFormat) => {
			if (!content?.app) {
				throw new Error('The story has not finished loading.');
			}
			const [runtime, data] = await Promise.all([
				loadStandaloneRuntime(),
				fetchExportData(queryClient, dataSource, content.queryIds),
			]);
			const html = buildStoryExportDocument({
				title: content.title,
				app: content.app,
				styles: content.styles.map((style) => style.content),
				theme,
				runtime,
				data,
			});
			return render(format, html);
		},
		[content, dataSource, queryClient, render, theme],
	);
}

function loadStandaloneRuntime(): Promise<string> {
	standaloneRuntime ??= fetch(`${STORY_RUNTIME_PATH}/${STORY_STANDALONE_RUNTIME_FILE}`).then((response) => {
		if (!response.ok) {
			throw new Error('The story runtime could not be loaded for the download.');
		}
		return response.text();
	});
	standaloneRuntime.catch(() => {
		standaloneRuntime = null;
	});
	return standaloneRuntime;
}

/** Ids come from a scan of the sources, so some match no query: those are left out and fail in the export as they would live. */
async function fetchExportData(
	queryClient: QueryClient,
	dataSource: CustomStoryDataSource,
	queryIds: string[],
): Promise<StoryExportData> {
	const [results, narratives, state] = await Promise.all([
		Promise.all(
			queryIds.map((queryId) =>
				queryClient.fetchQuery(queryDataOptions(dataSource, queryId)).then(
					(result): [string, StoryQueryResult] => [queryId, result],
					(error: unknown) => {
						if (isUnknownQueryError(error)) {
							return null;
						}
						throw error;
					},
				),
			),
		),
		queryClient.fetchQuery(narrativesOptions(dataSource)).catch(() => ({})),
		queryClient
			.fetchQuery(stateOptions(dataSource))
			.then((snapshot) => savedViewOf(snapshot, 'mine'))
			.catch(() => undefined),
	]);
	return {
		queries: Object.fromEntries(results.filter((entry) => entry !== null)),
		narratives,
		state,
	};
}

function isUnknownQueryError(error: unknown): boolean {
	return isNotFoundError(error) || isForbiddenError(error);
}
