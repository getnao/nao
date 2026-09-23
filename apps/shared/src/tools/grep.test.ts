import { describe, expect, it } from 'vitest';

import { OutputSchema } from './grep';

describe('grep OutputSchema', () => {
	it.each([
		['legacy strings', ['Before'], ['After']],
		[
			'source line metadata',
			[{ line_number: 1, line_content: 'Before' }],
			[{ line_number: 12, line_content: 'After' }],
		],
	])('accepts %s context rows', (_name, contextBefore, contextAfter) => {
		const output = {
			_version: '1' as const,
			matches: [
				{
					path: '/RULES.md',
					line_number: 8,
					line_content: 'Match',
					context_before: contextBefore,
					context_after: contextAfter,
				},
			],
			total_matches: 1,
			truncated: false,
		};

		expect(OutputSchema.parse(output)).toEqual(output);
	});
});
