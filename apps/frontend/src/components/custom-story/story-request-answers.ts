import type { StoryQueryResult } from '@nao/shared/story-app';
import type { CustomStoryDataSource } from './story-data-options';

const MAX_ANSWERS_PER_STORY = 50;

const answersBySource = new Map<string, Map<string, StoryQueryResult>>();

/** Filtered rows and story SQL the frame was answered with, so a download of the story shows what the viewer saw. */
export function rememberRequestAnswer(
	dataSource: CustomStoryDataSource,
	requestKey: string,
	result: StoryQueryResult,
): void {
	const sourceKey = toSourceKey(dataSource);
	const answers = answersBySource.get(sourceKey) ?? new Map<string, StoryQueryResult>();
	answers.delete(requestKey);
	answers.set(requestKey, result);
	while (answers.size > MAX_ANSWERS_PER_STORY) {
		const oldestKey = answers.keys().next().value;
		if (oldestKey === undefined) {
			break;
		}
		answers.delete(oldestKey);
	}
	answersBySource.set(sourceKey, answers);
}

export function readRequestAnswers(dataSource: CustomStoryDataSource): Record<string, StoryQueryResult> {
	return Object.fromEntries(answersBySource.get(toSourceKey(dataSource)) ?? []);
}

function toSourceKey(dataSource: CustomStoryDataSource): string {
	return JSON.stringify(dataSource);
}
