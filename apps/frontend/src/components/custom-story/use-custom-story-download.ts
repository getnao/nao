import { useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { DEFAULT_STORY_THEME } from '@nao/shared/story-theme';
import { STORY_RUNTIME_PATH, STORY_STANDALONE_RUNTIME_FILE } from '@nao/shared/story-app';
import type { QueryClient } from '@tanstack/react-query';
import type { DownloadFormat } from '@nao/shared/types';
import type { StoryExportData, StoryQueryResult } from '@nao/shared/story-app';

import type { CustomStoryContent } from '@/components/custom-story/custom-story-body';
import type { CustomStoryDataSource } from '@/components/custom-story/story-data-options';
import type { StoryDownloadFile } from '@/components/story-download';
import { narrativesOptions, queryDataOptions } from '@/components/custom-story/story-data-options';
import { buildStoryExportDocument } from '@/components/custom-story/story-export-document';

type RenderExport = (format: DownloadFormat, html: string) => Promise<StoryDownloadFile>;

let standaloneRuntime: Promise<string> | null = null;

/** A custom story downloads as a self-contained page running its own code; the server turns it into the file. */
export function useCustomStoryDownload(
	content: CustomStoryContent | undefined,
	dataSource: CustomStoryDataSource,
	render: RenderExport,
) {
	const queryClient = useQueryClient();
	return useCallback(
		async (format: DownloadFormat) => {
			if (!content?.bundle) {
				throw new Error('The story has not finished loading.');
			}
			const [runtime, data] = await Promise.all([
				loadStandaloneRuntime(),
				fetchExportData(queryClient, dataSource, content.queryIds),
			]);
			const html = buildStoryExportDocument({
				title: content.title,
				bundle: content.bundle,
				styles: content.styles.map((style) => style.content),
				theme: content.theme ?? DEFAULT_STORY_THEME,
				runtime,
				data,
			});
			return render(format, html);
		},
		[content, dataSource, queryClient, render],
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
	const [results, narratives] = await Promise.all([
		Promise.all(
			queryIds.map((queryId) =>
				queryClient.fetchQuery(queryDataOptions(dataSource, queryId)).then(
					(result): [string, StoryQueryResult] => [queryId, result],
					() => null,
				),
			),
		),
		queryClient.fetchQuery(narrativesOptions(dataSource)).catch(() => ({})),
	]);
	return {
		queries: Object.fromEntries(results.filter((entry) => entry !== null)),
		narratives,
	};
}
