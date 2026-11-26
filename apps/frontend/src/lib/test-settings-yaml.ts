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

/** A model alone, or with its credential and efforts, `all` when every supported effort is picked. */
function formatModelEntry(model: TestModelSelection): string[] {
	const name = formatYamlScalar(`${model.provider}:${model.modelId}`);
	const supported = getModelReasoningEfforts(model.provider, model.modelId);
	const picked = supported.filter((effort) => model.reasoningEfforts?.includes(effort));
	if (picked.length === 0 && !model.llmConfigId) {
		return [`    - ${name}`];
	}
	const lines = [`    - model: ${name}`];
	if (model.llmConfigId) {
		lines.push(`      llm_config_id: ${formatYamlScalar(model.llmConfigId)}`);
	}
	if (picked.length > 0) {
		const efforts = picked.length === supported.length ? 'all' : `[${picked.join(', ')}]`;
		lines.push(`      reasoning_efforts: ${efforts}`);
	}
	return lines;
}

/** Quotes a value that YAML would otherwise misread, such as a custom model id with `#` or `: `. */
function formatYamlScalar(value: string): string {
	return /^[A-Za-z0-9._/:-]+$/.test(value) ? value : JSON.stringify(value);
}
