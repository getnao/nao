import type { StoryQueryResult } from '@nao/shared/story-app';
import type { CustomStoryDataSource } from './story-data-options';

const MAX_ANSWERS_PER_STORY = 50;
const MAX_REMEMBERED_STORIES = 10;

/** Story SQL runs as the viewer, so its rows are only ever handed back to the same signed-in user. */
const answersByViewerAndSource = new Map<string, Map<string, StoryQueryResult>>();

/** Filtered rows and story SQL the frame was answered with, so a download of the story shows what the viewer saw. */
export function rememberRequestAnswer(
	viewerId: string,
	dataSource: CustomStoryDataSource,
	requestKey: string,
	result: StoryQueryResult,
): void {
	const storyKey = toStoryKey(viewerId, dataSource);
	const answers = answersByViewerAndSource.get(storyKey) ?? new Map<string, StoryQueryResult>();
	answers.delete(requestKey);
	answers.set(requestKey, result);
	keepNewest(answers, MAX_ANSWERS_PER_STORY);
	answersByViewerAndSource.delete(storyKey);
	answersByViewerAndSource.set(storyKey, answers);
	keepNewest(answersByViewerAndSource, MAX_REMEMBERED_STORIES);
}

export function readRequestAnswers(
	viewerId: string,
	dataSource: CustomStoryDataSource,
): Record<string, StoryQueryResult> {
	return Object.fromEntries(answersByViewerAndSource.get(toStoryKey(viewerId, dataSource)) ?? []);
}

/** Called when the session ends, with the rest of the client's cached data. */
export function clearRequestAnswers(): void {
	answersByViewerAndSource.clear();
}

function toStoryKey(viewerId: string, dataSource: CustomStoryDataSource): string {
	return JSON.stringify([viewerId, dataSource]);
}

/** A Map iterates in insertion order, so the first keys are the oldest. */
function keepNewest<T>(entries: Map<string, T>, limit: number): void {
	while (entries.size > limit) {
		const oldestKey = entries.keys().next().value;
		if (oldestKey === undefined) {
			return;
		}
		entries.delete(oldestKey);
	}
}
