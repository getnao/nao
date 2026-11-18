import { describe, expect, it } from 'vitest';

import { extractStoryReferenceTags, stripAssistantTags } from '../src/assistant-tags';

describe('stripAssistantTags', () => {
	it.each([
		[
			'a citation',
			'Total paid was <citation-number id="query_a1b2" column="total_paid">99</citation-number>.',
			'Total paid was 99.',
		],
		[
			'a saved file',
			'Here it is: <saved-file path="/home/exports/churn-2025.csv">churn-2025.csv</saved-file>',
			'Here it is: churn-2025.csv',
		],
		[
			'a story reference',
			'See <story-reference id="b411e523">Top 5 Customers by Payments</story-reference>.',
			'See Top 5 Customers by Payments.',
		],
		[
			'a context file',
			'See <context-file path="docs/glossary.md" lines="4-8">the glossary</context-file>.',
			'See the glossary.',
		],
	])('keeps the text %s wraps', (_tag, text, expected) => {
		expect(stripAssistantTags(text)).toBe(expected);
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

describe('extractStoryReferenceTags', () => {
	it('reads the stories an answer hands over, with their titles', () => {
		const text =
			'Here:\n<story-reference id="s1">Revenue</story-reference>\nand <story-reference id=\'s2\'> Churn </story-reference>.';
		expect(extractStoryReferenceTags(text)).toEqual([
			{ storyId: 's1', title: 'Revenue' },
			{ storyId: 's2', title: 'Churn' },
		]);
	});
});
