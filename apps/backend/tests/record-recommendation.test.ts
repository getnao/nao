import { describe, expect, it } from 'vitest';

import { createRecommendationCollector } from '../src/agents/tools/record-recommendation';

describe('recommendation collector tools', () => {
	it('collects recorded findings and resolved fingerprints', async () => {
		const collector = createRecommendationCollector();

		await collector.recordTool.execute!(
			{
				suggestedFile: 'RULES.md',
				subjectKey: 'k',
				severity: 'high',
				title: 't',
				summary: 's',
				suggestedAction: 'a',
				insights: [{ signalType: 'tool_error', metric: 'errors', count: 3 }],
			},
			{ experimental_context: {} } as never,
		);
		await collector.resolveTool.execute!({ fingerprint: 'fp-123' }, { experimental_context: {} } as never);

		expect(collector.recorded).toHaveLength(1);
		expect(collector.recorded[0].suggestedFile).toBe('RULES.md');
		expect(collector.resolvedFingerprints).toEqual(['fp-123']);
	});
});
