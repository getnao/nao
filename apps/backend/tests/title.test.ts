import { describe, expect, it } from 'vitest';

import { sanitizeTitle, titleFromPrompt } from '../src/utils/title';

describe('sanitizeTitle', () => {
	it('keeps a plain title as is', () => {
		expect(sanitizeTitle('Revenue by region last quarter')).toBe('Revenue by region last quarter');
	});

	it('strips the quotes and markdown decoration models wrap titles in', () => {
		expect(sanitizeTitle('"Revenue by region"')).toBe('Revenue by region');
		expect(sanitizeTitle('`Revenue by region`')).toBe('Revenue by region');
		expect(sanitizeTitle('**Revenue by region**')).toBe('Revenue by region');
		expect(sanitizeTitle('## Revenue by region')).toBe('Revenue by region');
	});

	it('keeps only the first line when the model adds commentary', () => {
		expect(sanitizeTitle('Revenue by region\n\nLet me know if you want another one.')).toBe('Revenue by region');
	});

	it('returns an empty string when the model answered nothing', () => {
		expect(sanitizeTitle('   \n  ')).toBe('');
	});

	it('rejects prose that does not look like a title', () => {
		expect(
			sanitizeTitle(
				"I don't have access to your proprietary subscription data, databases, or business systems — I can't pull live metrics.",
			),
		).toBe('');
		expect(sanitizeTitle('a'.repeat(300))).toBe('');
	});
});

describe('titleFromPrompt', () => {
	it('falls back to the first line of the prompt', () => {
		expect(titleFromPrompt('How many users signed up?\nBreak it down by plan.')).toBe('How many users signed up?');
	});

	it('truncates a long prompt', () => {
		expect(titleFromPrompt('a'.repeat(100))).toBe(`${'a'.repeat(57)}...`);
	});
});
