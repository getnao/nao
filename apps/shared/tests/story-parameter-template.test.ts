import { describe, expect, it } from 'vitest';

import {
	extractSemanticQueryParameterIds,
	resolveSemanticQueryParameters,
	substituteStoryParameters,
} from '../src/story-parameter-template';

describe('substituteStoryParameters', () => {
	it('replaces values and labels and leaves unknown placeholders', () => {
		const parameters = { metric: { value: 'revenue', label: 'Revenue' } };
		expect(
			substituteStoryParameters('{{ params.metric }} / {{params.metric.label}} / {{ params.other }}', parameters),
		).toBe('revenue / Revenue / {{ params.other }}');
	});
});

describe('resolveSemanticQueryParameters', () => {
	const query = {
		metrics: ['{{ params.metric }}'],
		group_by: ['metric_time__{{ params.grain }}'],
		where: ["{{ Dimension('customer__region') }} = 'EMEA'"],
		params: { metric: 'revenue', grain: 'week' },
	};

	it('uses the stored defaults and strips params', () => {
		expect(resolveSemanticQueryParameters(query)).toEqual({
			metrics: ['revenue'],
			group_by: ['metric_time__week'],
			where: ["{{ Dimension('customer__region') }} = 'EMEA'"],
		});
	});

	it('lets selected values override the defaults', () => {
		expect(resolveSemanticQueryParameters(query, { metric: 'unique_sales', grain: 'month' })).toMatchObject({
			metrics: ['unique_sales'],
			group_by: ['metric_time__month'],
		});
	});

	it('rejects placeholders without a value', () => {
		expect(() => resolveSemanticQueryParameters({ metrics: ['{{ params.metric }}'] })).toThrow(
			/params\.metric \}\} without a value/,
		);
	});

	it('does not treat Object.prototype members as parameters', () => {
		expect(substituteStoryParameters('{{ params.toString }}', {})).toBe('{{ params.toString }}');
		expect(() => resolveSemanticQueryParameters({ metrics: ['{{ params.constructor }}'] })).toThrow(
			/params\.constructor \}\} without a value/,
		);
	});

	it('lists the parameters a query uses', () => {
		expect(extractSemanticQueryParameterIds(query)).toEqual(['metric', 'grain']);
	});
});
