import { describe, expect, it } from 'vitest';

import { ArrayParameterSchema, OutputSchema } from '../src/tools/execute-sql';

const arrayParameter = {
	query_id: 'query_ab12cd34',
	column: 'user_id',
	type: 'STRING',
} as const;

describe('execute SQL array parameters', () => {
	it('limits BigQuery parameter names to 128 characters', () => {
		expect(ArrayParameterSchema.safeParse({ ...arrayParameter, name: 'a'.repeat(128) }).success).toBe(true);
		expect(ArrayParameterSchema.safeParse({ ...arrayParameter, name: 'a'.repeat(129) }).success).toBe(false);
	});
});

describe('execute SQL output', () => {
	const output = {
		data: [{ ratio: '1.2500' }],
		row_count: 1,
		columns: ['ratio'],
		id: 'query_ab12cd34',
	};

	it('accepts valid decimal column metadata', () => {
		expect(
			OutputSchema.safeParse({
				...output,
				decimal_columns: { ratio: { precision: 20, scale: 4 } },
			}).success,
		).toBe(true);
	});

	it('rejects decimal scales greater than their precision', () => {
		expect(
			OutputSchema.safeParse({
				...output,
				decimal_columns: { ratio: { precision: 4, scale: 5 } },
			}).success,
		).toBe(false);
	});
});
