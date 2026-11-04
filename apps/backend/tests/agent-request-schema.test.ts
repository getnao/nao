import { MAX_IMAGE_SIZE_MB } from '@nao/shared/attachments';
import { describe, expect, it } from 'vitest';

import { describeStoryElement } from '../src/services/agent';
import { AgentRequestUserMessageSchema, CitationDataSchema } from '../src/types/chat';

describe('AgentRequestUserMessageSchema', () => {
	it('enforces the decoded image size limit on the server schema', () => {
		const oversized = Buffer.alloc(MAX_IMAGE_SIZE_MB * 1024 * 1024 + 1).toString('base64');
		const parsed = AgentRequestUserMessageSchema.safeParse({
			text: '',
			images: [{ mediaType: 'image/png', data: oversized }],
		});

		expect(parsed.success).toBe(false);
	});
});

const barChart = { kind: 'bar-chart', title: 'Monthly Revenue', queryId: 'q1' };

describe('describeStoryElement', () => {
	it('describes a data point with its series and value', () => {
		const part = { kind: 'data-point', series: 'revenue', category: '2018-02', value: '26' } as const;

		expect(describeStoryElement({ ...barChart, part })).toBe(
			'the data point "2018-02" of series "revenue" (value 26) in the bar-chart block "Monthly Revenue", reading q1',
		);
	});

	it('describes an axis name by its label', () => {
		expect(describeStoryElement({ ...barChart, part: { kind: 'x-axis', label: 'Month' } })).toBe(
			'the x-axis name "Month" of the bar-chart block "Monthly Revenue", reading q1',
		);
	});

	it('describes a table cell by its column and row', () => {
		const block = {
			kind: 'data-table',
			title: 'Orders',
			queryId: 'q2',
			part: { kind: 'cell', series: 'amount', category: 'Alice', value: '$20' },
		} as const;

		expect(describeStoryElement(block)).toBe(
			'the cell "amount" of row "Alice" (value $20) in the data-table block "Orders", reading q2',
		);
	});

	it('describes the whole block when no part is cited', () => {
		expect(describeStoryElement(barChart)).toBe('the bar-chart block "Monthly Revenue", reading q1');
	});
});

describe('CitationDataSchema', () => {
	const citation = (part: object) => ({ start: 0, end: 4, text: 'Feb', block: { kind: 'bar-chart', part } });

	it('rejects an unknown part kind', () => {
		expect(CitationDataSchema.safeParse(citation({ kind: 'bogus' })).success).toBe(false);
	});

	it('accepts a known part kind', () => {
		expect(CitationDataSchema.safeParse(citation({ kind: 'axis-tick', label: 'Feb' })).success).toBe(true);
	});
});
