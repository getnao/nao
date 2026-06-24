import type { DateFormatSettings } from '@nao/shared/date';

import * as projectQueries from '../queries/project.queries';
import * as storyQueries from '../queries/story.queries';
import { assertProjectMcpEnabled, verifyEmbedToken } from './embed-token';
import { HandlerError } from './error';
import { resolveStoryQueryDataForSandbox, type StoryQueryDataMap } from './story-query-data';

export type EmbedStoryContent = {
	storyId: string;
	projectId: string;
	title: string;
	code: string;
	slug: string;
	chatId: string | null;
	queryData: StoryQueryDataMap | null;
	dateFormat: DateFormatSettings | null;
};

export function embedStoryOpenPath(row: { storyId: string; chatId: string | null; slug: string }): string {
	if (row.chatId) {
		return `/stories/preview/${row.chatId}/${row.slug}`;
	}
	return `/stories/standalone/${row.storyId}`;
}

export async function loadEmbedStoryContent(storyId: string, token: string): Promise<EmbedStoryContent> {
	const payload = verifyEmbedToken(token);
	if (!payload || payload.type !== 'story' || payload.resourceId !== storyId) {
		throw new HandlerError('UNAUTHORIZED', 'Invalid or expired embed token.');
	}

	const projectId = await storyQueries.getStoryProjectId(storyId);
	if (!projectId) {
		throw new HandlerError('NOT_FOUND', 'Story not found.');
	}
	if (projectId !== payload.projectId) {
		throw new HandlerError('UNAUTHORIZED', 'Embed token does not match this story.');
	}

	await assertProjectMcpEnabled(projectId);

	const version = await storyQueries.getLatestVersionByStoryId(storyId);
	if (!version) {
		throw new HandlerError('NOT_FOUND', 'Story not found.');
	}

	const [queryData, displaySettings] = await Promise.all([
		resolveStoryQueryDataForSandbox(version.code, {
			storyId,
			chatId: version.chatId,
			projectId,
		}),
		projectQueries.getDisplaySettings(projectId),
	]);

	return {
		storyId: version.storyId,
		projectId,
		title: version.title,
		code: version.code,
		slug: version.slug,
		chatId: version.chatId,
		queryData,
		dateFormat: displaySettings.dateFormat ?? null,
	};
}
