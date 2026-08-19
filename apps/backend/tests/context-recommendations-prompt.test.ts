import { describe, expect, it } from 'vitest';

import { renderContextRecommendationsPrompt } from '../src/components/ai/context-recommendations-prompt';

const BASE_PROPS = {
	windowStart: new Date('2026-01-01T00:00:00.000Z'),
	windowEnd: new Date('2026-02-01T00:00:00.000Z'),
	existing: [],
};

describe('context recommendations prompt', () => {
	it('names columns and profiling context when templates are unknown', () => {
		const markdown = renderContextRecommendationsPrompt(BASE_PROPS);

		expect(markdown).toContain('`databases/**/columns.md` for wrong-column failures');
		expect(markdown).toContain('`databases/**/profiling.md` (`top_values`) for wrong-value failures');
	});

	it('names only columns context when only columns is configured', () => {
		const markdown = renderContextRecommendationsPrompt({ ...BASE_PROPS, templates: ['columns'] });

		expect(markdown).toContain('`databases/**/columns.md` for wrong-column failures');
		expect(markdown).not.toContain('`databases/**/profiling.md`');
	});

	it('omits the cross-reference clause when neither diagnostic template is configured', () => {
		const markdown = renderContextRecommendationsPrompt({ ...BASE_PROPS, templates: ['preview', 'query_history'] });

		expect(markdown).not.toContain('`databases/**/columns.md`');
		expect(markdown).not.toContain('`databases/**/profiling.md`');
		expect(markdown).toContain('Count how many tool calls failed per root cause.');
	});
});
