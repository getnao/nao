import { describe, expect, it } from 'vitest';

import { stripAssistantTags } from '../src/assistant-tags';

describe('stripAssistantTags', () => {
	it('keeps the text a citation wraps', () => {
		const text = 'Total paid was <citation-number id="query_a1b2" column="total_paid">99</citation-number>.';
		expect(stripAssistantTags(text)).toBe('Total paid was 99.');
	});

	it('keeps the name a saved file wraps', () => {
		const text = 'Here it is: <saved-file path="/home/exports/churn-2025.csv">churn-2025.csv</saved-file>';
		expect(stripAssistantTags(text)).toBe('Here it is: churn-2025.csv');
	});

	it('keeps the text of a citation whose opening tag starts with an OpenAI citation marker', () => {
		const text =
			'GitHub had 1,936 stars. \uE200citation-number id="query_6244" column="stars">1936</citation-number>';
		expect(stripAssistantTags(text)).toBe('GitHub had 1,936 stars. 1936');
	});

	it('leaves an answer without tags alone', () => {
		expect(stripAssistantTags('Revenue grew 4% last quarter.')).toBe('Revenue grew 4% last quarter.');
	});
});
