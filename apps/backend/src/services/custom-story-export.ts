import type { StoryExportData, StoryQueryResult } from '@nao/shared/story-app';
import { buildStoryExportDocument } from '@nao/shared/story-document';
import { DEFAULT_STORY_THEME_PAIR, type StoryThemeMode } from '@nao/shared/story-theme';

import { formatDownloadFilename } from '../utils/story-download';
import { renderStoryPdf } from '../utils/story-snapshot';
import { loadStandaloneStoryRuntime } from '../utils/story-standalone-runtime';
import {
	type CustomStoryVersionView,
	getCustomStoryNarratives,
	getCustomStoryVersion,
	getStoredCustomStoryNarrativesByStoryId,
} from './custom-story';
import { getUnattendedCustomStoryState } from './custom-story-state';

export async function renderCustomStoryPdf(
	chatId: string,
	storySlug: string,
	queryData: Record<string, StoryQueryResult>,
): Promise<{ filename: string; buffer: Buffer }> {
	const [version, narratives, state, runtime] = await Promise.all([
		getCustomStoryVersion(chatId, storySlug),
		getCustomStoryNarratives(chatId, storySlug),
		getUnattendedCustomStoryState(chatId, storySlug),
		loadStandaloneStoryRuntime(),
	]);
	const html = buildCustomStoryDocumentHtml(version, queryData, narratives, runtime, 'light', state);
	return { filename: formatDownloadFilename(version.title, 'pdf'), buffer: await renderStoryPdf(html) };
}

/** A version as a self-contained page in the given theme mode, from the story's saved narratives. */
export async function buildCustomStoryDocumentByStoryId(
	storyId: string,
	version: CustomStoryVersionView,
	queryData: Record<string, StoryQueryResult>,
	mode: StoryThemeMode,
): Promise<string> {
	const [narratives, runtime] = await Promise.all([
		getStoredCustomStoryNarrativesByStoryId(storyId),
		loadStandaloneStoryRuntime(),
	]);
	return buildCustomStoryDocumentHtml(version, queryData, narratives, runtime, mode);
}

function buildCustomStoryDocumentHtml(
	version: CustomStoryVersionView,
	queryData: Record<string, StoryQueryResult>,
	narratives: Record<string, string>,
	runtime: string,
	mode: StoryThemeMode = 'light',
	state?: StoryExportData['state'],
): string {
	if (!version.app) {
		throw new Error(version.bundleError ?? 'The latest version of this story did not build.');
	}

	const data: StoryExportData = { queries: pickQueries(queryData, version.queryIds), narratives, state };
	return buildStoryExportDocument({
		title: version.title,
		app: version.app,
		styles: version.styles.map((style) => style.content),
		theme: version.theme?.[mode] ?? DEFAULT_STORY_THEME_PAIR[mode],
		runtime,
		data,
	});
}

function pickQueries(
	queryData: Record<string, StoryQueryResult>,
	queryIds: string[],
): Record<string, StoryQueryResult> {
	return Object.fromEntries(
		queryIds.flatMap((queryId) => (queryData[queryId] ? [[queryId, queryData[queryId]]] : [])),
	);
}
