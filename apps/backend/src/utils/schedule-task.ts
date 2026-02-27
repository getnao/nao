import { NewLlmInference } from '../db/abstractSchema';
import * as llmInferenceQueries from '../queries/llm-inference';

export const scheduleTask = (fn: () => Promise<unknown>): void => {
	queueMicrotask(async () => {
		try {
			await fn();
		} catch (err) {
			console.error('[scheduleTask] failed:', err);
		}
	});
};

export const scheduleSaveLlmInferenceRecord = (opts: NewLlmInference): void => {
	scheduleTask(() => {
		return llmInferenceQueries.insertLlmInference(opts);
	});
};
