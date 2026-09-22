import type { StoryQueryResult } from '@nao/shared/story-app';
import type { StoryTheme } from '@nao/shared/story-theme';

import { env } from '../env';
import * as executeSqlQueries from '../queries/execute-sql.queries';
import * as storyQueries from '../queries/story.queries';
import * as storyFileQueries from '../queries/story-file.queries';
import * as storyThemeQueries from '../queries/story-theme.queries';
import { executeLiveQuery } from './live-story';

export interface CustomStoryVersionView {
	storyId: string;
	title: string;
	archivedAt: Date | null;
	version: { id: string; number: number; createdAt: Date };
	bundle: string | null;
	bundleError: string | null;
	styles: { path: string; content: string }[];
	files: string[];
	theme: StoryTheme | null;
}

export class CustomStoryNotFoundError extends Error {
	constructor() {
		super('Custom story not found.');
	}
}

export async function getCustomStoryVersion(
	chatId: string,
	storySlug: string,
	versionNumber?: number,
): Promise<CustomStoryVersionView> {
	const story = await storyQueries.getStoryByChatAndSlug(chatId, storySlug);
	if (!story || story.format !== 'custom') {
		throw new CustomStoryNotFoundError();
	}
	const version =
		versionNumber === undefined
			? await storyQueries.getLatestVersionByChatAndSlug(chatId, storySlug)
			: await storyQueries.getVersionByNumber(chatId, storySlug, versionNumber);
	if (!version) {
		throw new CustomStoryNotFoundError();
	}

	const [bundle, files, theme] = await Promise.all([
		storyFileQueries.getVersionBundle(version.id),
		storyFileQueries.listVersionFiles(version.id),
		getActiveThemeForStory(story.id),
	]);
	return {
		storyId: story.id,
		title: story.title,
		archivedAt: story.archivedAt,
		version: { id: version.id, number: version.version, createdAt: version.createdAt },
		bundle: bundle?.bundle ?? null,
		bundleError: bundle?.bundleError ?? (bundle ? null : 'This version was never built. Publish the story again.'),
		styles: files
			.filter((file) => file.path.toLowerCase().endsWith('.css'))
			.map((file) => ({ path: file.path, content: file.content })),
		files: files.map((file) => file.path),
		theme,
	};
}

export async function getCustomStoryQueryData(chatId: string, queryId: string): Promise<StoryQueryResult> {
	const cached = await executeSqlQueries.getLatestSqlQueryDataByIds(chatId, new Set([queryId]));
	return cached[queryId] ?? executeLiveQuery(chatId, queryId);
}

async function getActiveThemeForStory(storyId: string): Promise<StoryTheme | null> {
	if (!env.BETA_CUSTOM_STORIES_ENABLED) {
		return null;
	}
	const projectId = await storyQueries.getStoryProjectId(storyId);
	return projectId ? storyThemeQueries.getActiveStoryTheme(projectId) : null;
}
