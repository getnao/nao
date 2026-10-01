import type { StoryExportData, StoryQueryResult } from '@nao/shared/story-app';
import { buildStoryExportDocument } from '@nao/shared/story-document';
import { DEFAULT_STORY_THEME } from '@nao/shared/story-theme';

import { formatDownloadFilename } from '../utils/story-download';
import { renderStoryPdf } from '../utils/story-snapshot';
import { loadStandaloneStoryRuntime } from '../utils/story-standalone-runtime';
import { getCustomStoryNarratives, getCustomStoryVersion } from './custom-story';

export async function renderCustomStoryPdf(
	chatId: string,
	storySlug: string,
	queryData: Record<string, StoryQueryResult>,
): Promise<{ filename: string; buffer: Buffer }> {
	const [version, narratives, runtime] = await Promise.all([
		getCustomStoryVersion(chatId, storySlug),
		getCustomStoryNarratives(chatId, storySlug),
		loadStandaloneStoryRuntime(),
	]);
	if (!version.bundle) {
		throw new Error(version.bundleError ?? 'The latest version of this story did not build.');
	}

	const data: StoryExportData = { queries: pickQueries(queryData, version.queryIds), narratives };
	const html = buildStoryExportDocument({
		title: version.title,
		bundle: version.bundle,
		styles: version.styles.map((style) => style.content),
		theme: version.theme?.light ?? DEFAULT_STORY_THEME,
		runtime,
		data,
	});
	return { filename: formatDownloadFilename(version.title, 'pdf'), buffer: await renderStoryPdf(html) };
}

function pickQueries(
	queryData: Record<string, StoryQueryResult>,
	queryIds: string[],
): Record<string, StoryQueryResult> {
	return Object.fromEntries(
		queryIds.flatMap((queryId) => (queryData[queryId] ? [[queryId, queryData[queryId]]] : [])),
	);
}
