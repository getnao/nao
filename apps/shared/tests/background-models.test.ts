import { describe, expect, it } from 'vitest';

import { BACKGROUND_MODEL_CATEGORIES, setBackgroundModelMode } from '../src/background-models';

describe('setBackgroundModelMode', () => {
	it('preserves a single model across every category when switching to per-category defaults', () => {
		const single = { provider: 'anthropic' as const, modelId: 'claude-sonnet' };

		const settings = setBackgroundModelMode({ mode: 'single', single }, 'perCategory');

		expect(settings.mode).toBe('perCategory');
		expect(settings.single).toEqual(single);
		expect(settings.categories).toEqual(
			Object.fromEntries(BACKGROUND_MODEL_CATEGORIES.map((category) => [category, single])),
		);
	});
});
