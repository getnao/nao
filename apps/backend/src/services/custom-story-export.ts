import type { StoryExportData, StoryNarratives, StoryQueryResult } from '@nao/shared/story-app';
import { buildStoryExportDocument } from '@nao/shared/story-document';
import { DEFAULT_STORY_THEME_PAIR, type StoryThemeMode } from '@nao/shared/story-theme';

import { formatDownloadFilename } from '../utils/story-download';
import { themeFontStylesheets } from '../utils/story-headless-page';
import { renderStoryPdf } from '../utils/story-snapshot';
import { loadStandaloneStoryRuntime } from '../utils/story-standalone-runtime';
import { readStoryChartPluginSources } from './chart-plugin';
import {
	type CustomStoryVersionView,
	getCustomStoryNarratives,
	getCustomStoryVersion,
	getStoredCustomStoryNarrativesByStoryId,
} from './custom-story';
import { getUnattendedCustomStoryState, getUnattendedCustomStoryStateByStoryId } from './custom-story-state';

interface StoryExportContext {
	queryData: Record<string, StoryQueryResult>;
	narratives: Record<string, string>;
	runtime: string;
	state?: StoryExportData['state'];
	chartPlugins: Record<string, string>;
}

export async function renderCustomStoryPdf(
	chatId: string,
	storySlug: string,
	queryData: Record<string, StoryQueryResult>,
	narratives?: StoryNarratives,
): Promise<{ filename: string; buffer: Buffer }> {
	const version = await getCustomStoryVersion(chatId, storySlug);
	const [resolvedNarratives, state, runtime, chartPlugins] = await Promise.all([
		narratives ?? getCustomStoryNarratives(chatId, storySlug),
		getUnattendedCustomStoryState(chatId, storySlug),
		loadStandaloneStoryRuntime(),
		readStoryChartPluginSources(version.storyId),
	]);
	const html = buildCustomStoryDocumentHtml(
		version,
		{ queryData, narratives: resolvedNarratives, runtime, state, chartPlugins },
		'light',
	);
	const buffer = await renderStoryPdf(html, themeFontStylesheets(version.theme));
	return { filename: formatDownloadFilename(version.title, 'pdf'), buffer };
}

/** A version as a self-contained page in the given theme mode, from the story's saved narratives and shared state. */
export async function buildCustomStoryDocumentByStoryId(
	storyId: string,
	version: CustomStoryVersionView,
	queryData: Record<string, StoryQueryResult>,
	mode: StoryThemeMode,
): Promise<string> {
	const [narratives, runtime, state, chartPlugins] = await Promise.all([
		getStoredCustomStoryNarrativesByStoryId(storyId),
		loadStandaloneStoryRuntime(),
		getUnattendedCustomStoryStateByStoryId(storyId),
		readStoryChartPluginSources(storyId),
	]);
	return buildCustomStoryDocumentHtml(version, { queryData, narratives, runtime, state, chartPlugins }, mode);
}

function buildCustomStoryDocumentHtml(
	version: CustomStoryVersionView,
	{ queryData, narratives, runtime, state, chartPlugins }: StoryExportContext,
	mode: StoryThemeMode,
): string {
	if (!version.app) {
		throw new Error(version.bundleError ?? 'The latest version of this story did not build.');
	}

	const data: StoryExportData = {
		queries: pickQueries(queryData, version.queryIds),
		narratives,
		state,
		chartPlugins,
	};
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
