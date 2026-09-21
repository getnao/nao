import { getDefaultModelId } from '@nao/backend/provider-meta';
import { describe, expect, it } from 'vitest';

import { applySavedModelSettings } from './model-settings-overrides';
import type { ModelSettingsMap } from '@nao/backend/llm';

describe('applySavedModelSettings', () => {
	const provider = 'anthropic';
	const defaultModelId = getDefaultModelId(provider);

	it('keeps the implicit default when no overrides are saved', () => {
		const result = applySavedModelSettings({
			provider,
			enabledModels: [],
			modelSettings: {},
			modelId: defaultModelId,
			settings: {},
		});

		expect(result.enabledModels).toEqual([]);
		expect(result.modelSettings).toEqual({});
	});

	it('promotes the implicit default when a real override is saved', () => {
		const result = applySavedModelSettings({
			provider,
			enabledModels: [],
			modelSettings: {},
			modelId: defaultModelId,
			settings: { temperature: 0.7 },
		});

		expect(result.enabledModels).toEqual([defaultModelId]);
		expect(result.modelSettings).toEqual({ [defaultModelId]: { temperature: 0.7 } });
	});

	it('does not promote a non-default model', () => {
		const modelSettings: ModelSettingsMap = {};
		const result = applySavedModelSettings({
			provider,
			enabledModels: [],
			modelSettings,
			modelId: 'claude-sonnet-4-5',
			settings: { temperature: 0.7 },
		});

		expect(result.enabledModels).toEqual([]);
		expect(result.modelSettings).toEqual({ 'claude-sonnet-4-5': { temperature: 0.7 } });
	});

	it('keeps a promoted model enabled when overrides are cleared', () => {
		const result = applySavedModelSettings({
			provider,
			enabledModels: [defaultModelId],
			modelSettings: { [defaultModelId]: { temperature: 0.7 } },
			modelId: defaultModelId,
			settings: {},
		});

		expect(result.enabledModels).toEqual([defaultModelId]);
		expect(result.modelSettings).toEqual({});
	});
});
