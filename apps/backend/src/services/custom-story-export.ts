import type { StoryExportData, StoryMapBoundary, StoryNarratives, StoryQueryResult } from '@nao/shared/story-app';
import { buildStoryExportDocument } from '@nao/shared/story-document';
import { DEFAULT_STORY_THEME_PAIR, type StoryThemeMode } from '@nao/shared/story-theme';

import { formatDownloadFilename } from '../utils/story-download';
import { themeFontStylesheets } from '../utils/story-headless-page';
import { renderStoryPdf } from '../utils/story-snapshot';
import { loadStandaloneStoryRuntime } from '../utils/story-standalone-runtime';
import { readStoryChartPluginSources } from './chart-plugin';
import {
	type CustomStoryVersionView,
	getLatestCustomStoryVersionByStoryId,
	getStoredCustomStoryNarrativesByStoryId,
} from './custom-story';
import { getUnattendedCustomStoryStateByStoryId } from './custom-story-state';
import { readStoryImagesForExport } from './story-image';
import { readStoryMapBoundaries } from './story-map-boundary';

interface StoryExportContext {
	queryData: Record<string, StoryQueryResult>;
	narratives: Record<string, string>;
	runtime: string;
	state?: StoryExportData['state'];
	chartPlugins: Record<string, string>;
	mapBoundaries: Record<string, StoryMapBoundary>;
	images: Record<string, string>;
}

interface CustomStoryDocumentOptions {
	narratives?: StoryNarratives;
	state?: StoryExportData['state'];
}

interface CustomStoryDocumentOptions {
	narratives?: StoryNarratives;
	state?: StoryExportData['state'];
}

export async function renderCustomStoryPdf(
	storyId: string,
	queryData: Record<string, StoryQueryResult>,
	narratives?: StoryNarratives,
): Promise<{ filename: string; buffer: Buffer }> {
	const version = await getLatestCustomStoryVersionByStoryId(storyId);
	const html = await buildCustomStoryDocumentByStoryId(storyId, version, queryData, 'light', { narratives });
	const buffer = await renderStoryPdf(html, themeFontStylesheets(version.theme));
	return { filename: formatDownloadFilename(version.title, 'pdf'), buffer };
}

/** A version as a self-contained page in the given theme mode, from the story's saved narratives and shared state. */
export async function buildCustomStoryDocumentByStoryId(
	storyId: string,
	version: CustomStoryVersionView,
	queryData: Record<string, StoryQueryResult>,
	mode: StoryThemeMode,
	options: CustomStoryDocumentOptions = {},
): Promise<string> {
	const [narratives, runtime, state, chartPlugins, mapBoundaries, images] = await Promise.all([
		options.narratives ?? getStoredCustomStoryNarrativesByStoryId(storyId),
		loadStandaloneStoryRuntime(),
		options.state ?? getUnattendedCustomStoryStateByStoryId(storyId),
		readStoryChartPluginSources(storyId),
		readStoryMapBoundaries(storyId, version.mapBoundaryKeys),
		version.app ? readStoryImagesForExport(storyId, version.app, pickQueries(queryData, version.queryIds)) : {},
	]);
	return buildCustomStoryDocumentHtml(
		version,
		{ queryData, narratives, runtime, state, chartPlugins, mapBoundaries, images },
		mode,
	);
}

function buildCustomStoryDocumentHtml(
	version: CustomStoryVersionView,
	{ queryData, narratives, runtime, state, chartPlugins, mapBoundaries, images }: StoryExportContext,
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
		mapBoundaries,
		images,
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
