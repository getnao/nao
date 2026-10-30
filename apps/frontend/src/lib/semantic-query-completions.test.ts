import { describe, expect, it } from 'vitest';

import { getSemanticQueryCompletions } from './semantic-query-completions';
import type { executeSemanticQuery } from '@nao/shared/tools';
import type { SemanticQueryListField } from './semantic-query-completions';
import type { SemanticQueryDraft } from './semantic-query-draft';

const ORDER_DIMENSIONS = ['metric_time', 'order__ordered_at', 'order__status'];

const CATALOG: executeSemanticQuery.Catalog = {
	metrics: [
		{ name: 'average_order_value', label: null, description: null, dimensions: ORDER_DIMENSIONS },
		{ name: 'orders', label: null, description: 'Number of orders', dimensions: ORDER_DIMENSIONS },
		{ name: 'revenue', label: 'Revenue', description: null, dimensions: ORDER_DIMENSIONS },
		{ name: 'signups', label: null, description: null, dimensions: ['metric_time', 'user__country'] },
	],
	dimensions: [
		{ name: 'order__ordered_at', type: 'time', granularity: 'month', description: null },
		{ name: 'order__status', type: 'categorical', granularity: null, description: 'Order status' },
		{ name: 'user__country', type: 'categorical', granularity: null, description: null },
	],
};

const EMPTY_DRAFT: SemanticQueryDraft = {
	metrics: [],
	group_by: [],
	where: [],
	order_by: [],
	limit: '',
	start_time: '',
	end_time: '',
};

describe('metric completions', () => {
	it('lists every metric for an empty row', () => {
		const result = complete('metrics', '', { metrics: [''] });

		expect(labels(result)).toEqual(['average_order_value', 'orders', 'revenue', 'signups']);
	});

	it('puts names starting with the typed text first and replaces the whole name', () => {
		const result = complete('metrics', 'ord', { metrics: ['ord'] });

		expect(labels(result)).toEqual(['orders', 'average_order_value']);
		expect(result).toMatchObject({ from: 0, to: 3 });
	});

	it('matches the label and description too', () => {
		expect(labels(complete('metrics', 'number', { metrics: ['number'] }))).toEqual(['orders']);
	});

	it('leaves out metrics already picked in other rows', () => {
		const result = complete('metrics', '', { metrics: ['revenue', ''] }, 1);

		expect(labels(result)).not.toContain('revenue');
	});

	it('replaces the word around the cursor when editing in the middle of a name', () => {
		const result = complete('metrics', 'revxx', { metrics: ['revxx'] }, 0, 3);

		expect(result).toMatchObject({ from: 0, to: 5 });
	});
});

describe('group by completions', () => {
	it('offers time dimensions at every granularity from their finest one, metric_time first', () => {
		const result = complete('group_by', '', { metrics: ['revenue'], group_by: [''] });

		expect(labels(result)).toEqual([
			'metric_time__day',
			'metric_time__week',
			'metric_time__month',
			'metric_time__quarter',
			'metric_time__year',
			'order__ordered_at__month',
			'order__ordered_at__quarter',
			'order__ordered_at__year',
			'order__status',
		]);
	});

	it('only offers dimensions every selected metric shares', () => {
		const result = complete('group_by', '', { metrics: ['revenue', 'signups'], group_by: [''] });

		expect(labels(result).every((label) => label.startsWith('metric_time__'))).toBe(true);
	});

	it('offers every dimension before a metric is picked', () => {
		const result = complete('group_by', 'country', { group_by: ['country'] });

		expect(labels(result)).toEqual(['user__country']);
	});

	it('leaves out what is already grouped by', () => {
		const result = complete(
			'group_by',
			'status',
			{ metrics: ['revenue'], group_by: ['order__status', 'status'] },
			1,
		);

		expect(result.items).toEqual([]);
	});
});

describe('order by completions', () => {
	it('offers the selected metrics and group by items', () => {
		const draft = { metrics: ['revenue'], group_by: ['order__status'], order_by: [''] };

		expect(labels(complete('order_by', '', draft))).toEqual(['revenue', 'order__status']);
	});

	it('keeps the descending prefix and replaces only the name', () => {
		const result = complete('order_by', '-rev', { metrics: ['revenue'], order_by: ['-rev'] });

		expect(result.items).toEqual([{ label: '-revenue', detail: 'Descending', insertText: 'revenue' }]);
		expect(result).toMatchObject({ from: 1, to: 4 });
	});
});

describe('where completions', () => {
	it('offers filter templates for an empty filter', () => {
		const result = complete('where', '', { metrics: ['revenue'], where: [''] });

		expect(result.items).toContainEqual({
			label: 'order__status',
			detail: 'Order status',
			insertText: "{{ Dimension('order__status') }}",
		});
		expect(result.items).toContainEqual({
			label: 'order__ordered_at',
			detail: 'Time dimension',
			insertText: "{{ TimeDimension('order__ordered_at', 'month') }}",
		});
	});

	it('completes the dimension name inside a template', () => {
		const value = "{{ Dimension('stat";
		const result = complete('where', value, { metrics: ['revenue'], where: [value] });

		expect(result.items).toEqual([{ label: 'order__status', detail: 'Order status', insertText: 'order__status' }]);
		expect(result).toMatchObject({ from: value.length - 4, to: value.length });
	});

	it('only offers time dimensions inside a TimeDimension template', () => {
		const value = "{{ TimeDimension('";
		const result = complete('where', value, { metrics: ['revenue'], where: [value] });

		expect(labels(result)).toEqual(['metric_time', 'order__ordered_at']);
	});

	it('offers metrics inside a Metric template', () => {
		const value = "{{ Metric('ord";
		const result = complete('where', value, { where: [value] });

		expect(labels(result)).toEqual(['orders', 'average_order_value']);
	});

	it('stays quiet while typing a value or an operator', () => {
		const filter = "{{ Dimension('order__status') }} = ";

		expect(complete('where', filter, { where: [filter] }).items).toEqual([]);
		expect(complete('where', `${filter}'comp`, { where: [`${filter}'comp`] }).items).toEqual([]);
	});
});

function complete(
	field: SemanticQueryListField,
	value: string,
	draft: Partial<SemanticQueryDraft>,
	rowIndex = 0,
	cursor = value.length,
) {
	return getSemanticQueryCompletions({
		field,
		value,
		cursor,
		rowIndex,
		draft: { ...EMPTY_DRAFT, ...draft },
		catalog: CATALOG,
	});
}

function labels(result: { items: { label: string }[] }): string[] {
	return result.items.map((item) => item.label);
}
