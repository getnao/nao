import { describe, expect, it } from 'vitest';

import { DATABASE_WAREHOUSE_OPTIONS, DATABASE_WAREHOUSE_QUESTION, InputSchema } from './clarification';

describe('clarification InputSchema', () => {
	it('accepts every supported database option for warehouse selection', () => {
		expect(
			InputSchema.parse({
				question: DATABASE_WAREHOUSE_QUESTION,
				options: DATABASE_WAREHOUSE_OPTIONS,
			}),
		).toEqual({
			question: DATABASE_WAREHOUSE_QUESTION,
			options: DATABASE_WAREHOUSE_OPTIONS,
		});
	});

	it('rejects more than five options for other questions', () => {
		expect(() =>
			InputSchema.parse({
				question: 'Choose a value',
				options: ['One', 'Two', 'Three', 'Four', 'Five', 'Six'],
			}),
		).toThrow();
	});

	it.each([
		undefined,
		DATABASE_WAREHOUSE_OPTIONS.slice(0, 5),
		[...DATABASE_WAREHOUSE_OPTIONS.slice(0, -1), 'Oracle'],
	])('rejects an incomplete or invalid database option list', (options) => {
		expect(() =>
			InputSchema.parse({
				question: DATABASE_WAREHOUSE_QUESTION,
				options,
			}),
		).toThrow();
	});
});
