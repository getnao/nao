import { describe, expect, it } from 'vitest';

import { fromSemanticQueryDraft, normalizeSemanticQuery, toSemanticQueryDraft } from './semantic-query-draft';
import type { SemanticQueryDraft } from './semantic-query-draft';

const EMPTY_DRAFT: SemanticQueryDraft = {
	metrics: [],
	group_by: [],
	where: [],
	order_by: [],
	limit: '',
	start_time: '',
	end_time: '',
};

describe('fromSemanticQueryDraft', () => {
	it('round-trips a full semantic query', () => {
		const query = {
			metrics: ['revenue', 'orders'],
			group_by: ['metric_time__month', 'customer__region'],
			where: ["{{ Dimension('customer__region') }} = 'EMEA'"],
			order_by: ['-revenue'],
			limit: 10,
			start_time: '2024-01-01',
			end_time: '2024-12-31',
		};

		expect(fromSemanticQueryDraft(toSemanticQueryDraft(query))).toEqual(query);
	});

	it('drops blank entries and empty optional fields', () => {
		const draft = { ...EMPTY_DRAFT, metrics: [' revenue ', ''], group_by: ['  '], start_time: ' ' };

		expect(fromSemanticQueryDraft(draft)).toEqual({ metrics: ['revenue'] });
	});

	it('refuses a draft without a metric', () => {
		expect(fromSemanticQueryDraft({ ...EMPTY_DRAFT, metrics: ['  '] })).toBeNull();
	});

	it.each(['0', '-3', '2.5', 'ten'])('refuses the limit %s', (limit) => {
		expect(fromSemanticQueryDraft({ ...EMPTY_DRAFT, metrics: ['revenue'], limit })).toBeNull();
	});
});

describe('normalizeSemanticQuery', () => {
	it('reads empty lists the way the form saves them, so an untouched form is not dirty', () => {
		expect(normalizeSemanticQuery({ metrics: ['revenue'], group_by: [], where: [] })).toEqual({
			metrics: ['revenue'],
		});
	});
});
