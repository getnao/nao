import { describe, expect, it } from 'vitest';

import { renderContextRecommendationsSystemPrompt } from '../src/components/ai/context-recommendations-system-prompt';

describe('context recommendations system prompt', () => {
	it('includes custom instructions when configured', () => {
		const markdown = renderContextRecommendationsSystemPrompt({
			customInstructions: 'Prioritize recommendations about revenue definitions.',
		});

		expect(markdown).toContain('## Custom instructions');
		expect(markdown).toContain('Prioritize recommendations about revenue definitions.');
	});

	it('omits custom instructions when blank', () => {
		const markdown = renderContextRecommendationsSystemPrompt({ customInstructions: '   ' });

		expect(markdown).not.toContain('## Custom instructions');
	});
});
