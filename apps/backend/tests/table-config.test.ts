import { describe, expect, it } from 'vitest';

import { selectLatestDisplayTableFormats } from '../src/queries/table-config.utils';

describe('selectLatestDisplayTableFormats', () => {
	it('keeps the latest formatting per query_id (rows ordered oldest → newest)', () => {
		const rows = [
			{ toolInput: { query_id: 'q1', conditional_formats: { a: { type: 'color-scale' } } } },
			{
				toolInput: {
					query_id: 'q1',
					conditional_formats: { a: { type: 'threshold', operator: '>=', value: 1, color: 'red' } },
				},
			},
		];
		expect(selectLatestDisplayTableFormats(rows)).toEqual({
			q1: { a: { type: 'threshold', operator: '>=', value: 1, color: 'red' } },
		});
	});

	it('keeps entries from different query_ids independently', () => {
		const rows = [
			{ toolInput: { query_id: 'q1', conditional_formats: { a: { type: 'color-scale' } } } },
			{ toolInput: { query_id: 'q2', conditional_formats: { b: { type: 'color-scale', color: '#ff0000' } } } },
		];
		expect(selectLatestDisplayTableFormats(rows)).toEqual({
			q1: { a: { type: 'color-scale' } },
			q2: { b: { type: 'color-scale', color: '#ff0000' } },
		});
	});

	it('skips malformed inputs and empty formatting maps', () => {
		const rows = [
			{ toolInput: null },
			{ toolInput: { query_id: 'q1' } },
			{ toolInput: { query_id: 'q1', conditional_formats: {} } },
			{ toolInput: { query_id: 'q2', conditional_formats: { a: { type: 'color-scale' } } } },
		];
		expect(selectLatestDisplayTableFormats(rows)).toEqual({
			q2: { a: { type: 'color-scale' } },
		});
	});
});
