import type { CustomBoundarySet } from '@nao/shared';
import type { StoryMapBoundary } from '@nao/shared/story-app';

import * as projectQueries from '../queries/project.queries';
import * as storyQueries from '../queries/story.queries';
import { loadBoundarySet } from '../utils/map-boundary-resolve';

/** A story draws with its own project's boundary sets, whichever project its viewer has selected. */
export async function readStoryMapBoundary(storyId: string, key: string): Promise<StoryMapBoundary | null> {
	const customSets = await findStoryBoundarySets(storyId);
	return customSets ? toStoryMapBoundary(key, customSets) : null;
}

export async function readCustomStoryMapBoundary(
	chatId: string,
	storySlug: string,
	key: string,
): Promise<StoryMapBoundary | null> {
	const story = await storyQueries.getStoryByChatAndSlug(chatId, storySlug);
	return story ? readStoryMapBoundary(story.id, key) : null;
}

/** The sets a downloaded story loads, so its maps still draw offline. */
export async function readStoryMapBoundaries(
	storyId: string,
	keys: string[],
): Promise<Record<string, StoryMapBoundary>> {
	const customSets = keys.length > 0 ? await findStoryBoundarySets(storyId) : null;
	if (!customSets) {
		return {};
	}
	const entries = await Promise.all(
		keys.map(async (key) => [key, await toStoryMapBoundary(key, customSets)] as const),
	);
	return Object.fromEntries(entries.filter((entry): entry is [string, StoryMapBoundary] => entry[1] !== null));
}

async function findStoryBoundarySets(storyId: string): Promise<CustomBoundarySet[] | null> {
	const projectId = await storyQueries.getStoryProjectId(storyId);
	return projectId ? projectQueries.getCustomBoundaries(projectId) : null;
}

async function toStoryMapBoundary(key: string, customSets: CustomBoundarySet[]): Promise<StoryMapBoundary | null> {
	const boundary = await loadBoundarySet(key, customSets);
	return boundary && { geojson: boundary.geojson, joinProperties: boundary.joinProps ?? [] };
}
