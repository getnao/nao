import { getModelReasoningEfforts } from '@nao/backend/provider-meta';

import type { TestModelSelection } from '@nao/backend/test-run';

interface TestSettingsSelection {
	models: TestModelSelection[];
	attempts: number;
	threads: number;
}

/** The models, times to ask each test and threads picked for a run, as the `test` block of nao_config.yaml. */
export function formatTestSettingsYaml({ models, attempts, threads }: TestSettingsSelection): string {
	const lines = [
		'test:',
		'  models:',
		...models.flatMap(formatModelEntry),
		`  k: ${attempts}`,
		`  threads: ${threads}`,
	];
	return `${lines.join('\n')}\n`;
}

/** A model alone, or with the efforts picked for it, `all` when every effort it supports is. */
function formatModelEntry(model: TestModelSelection): string[] {
	const name = `${model.provider}:${model.modelId}`;
	const supported = getModelReasoningEfforts(model.provider, model.modelId);
	const picked = supported.filter((effort) => model.reasoningEfforts?.includes(effort));
	if (picked.length === 0) {
		return [`    - ${name}`];
	}
	const efforts = picked.length === supported.length ? 'all' : `[${picked.join(', ')}]`;
	return [`    - model: ${name}`, `      reasoning_efforts: ${efforts}`];
}
