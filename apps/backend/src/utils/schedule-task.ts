import { Effect } from 'effect';

import { NewLlmInference } from '../db/abstractSchema';
import * as llmInferenceQueries from '../queries/llm-inference';
import { fromPromise, runInBackground } from './effect-runtime';

/** Failures go to the console, not the logger, because the logger itself writes through this function. */
export const scheduleTask = (fn: () => Promise<unknown>): void => {
	runInBackground(
		fromPromise(() => fn()).pipe(
			Effect.catch((err) => Effect.sync(() => console.error('[scheduleTask] failed:', err))),
		),
	);
};

export const scheduleSaveLlmInferenceRecord = (opts: NewLlmInference): void => {
	scheduleTask(() => {
		return llmInferenceQueries.insertLlmInference(opts);
	});
};
