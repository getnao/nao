import { describe, expect, it } from 'vitest';

import { buildStoryTableBlock } from '../src/chart-block';
import { parseTableBlock, splitCodeIntoSegments } from '../src/story-segments';
import { displayTable } from '../src/tools';

describe('buildStoryTableBlock', () => {
	it('round-trips a table with conditional formatting through the story parser', () => {
		const block = buildStoryTableBlock({
			query_id: 'query_abc',
			title: 'Revenue by region',
			conditional_formats: {
				revenue: { type: 'color-scale' },
				churn: { type: 'threshold', operator: '>=', value: 0.1, color: 'rgba(239,68,68,0.3)' },
			},
		});

		const attrString = block.replace(/^<table\s+/, '').replace(/\s*\/>$/, '');
		const parsed = parseTableBlock(attrString);

		expect(parsed).not.toBeNull();
		expect(parsed?.queryId).toBe('query_abc');
		expect(parsed?.title).toBe('Revenue by region');
		expect(parsed?.conditionalFormats).toEqual({
			revenue: { type: 'color-scale' },
			churn: { type: 'threshold', operator: '>=', value: 0.1, color: 'rgba(239,68,68,0.3)' },
		});
	});

	it('omits the formatting attribute when there are no rules', () => {
		const block = buildStoryTableBlock({ query_id: 'query_x', title: 'Plain' });
		expect(block).not.toContain('formatting=');
	});

	it('produces a table segment recognised by splitCodeIntoSegments', () => {
		const block = buildStoryTableBlock({
			query_id: 'query_1',
			conditional_formats: { amount: { type: 'color-scale' } },
		});
		const segments = splitCodeIntoSegments(block);
		const table = segments.find((segment) => segment.type === 'table');
		expect(table).toBeDefined();
		expect(table?.type === 'table' && table.table.conditionalFormats).toEqual({
			amount: { type: 'color-scale' },
		});
	});

	it('keeps threshold formatting through splitCodeIntoSegments despite ">" in the operator', () => {
		const block = buildStoryTableBlock({
			query_id: 'query_2',
			title: 'Churn',
			conditional_formats: {
				churn: { type: 'threshold', operator: '>=', value: 0.1, color: 'rgba(239,68,68,0.3)' },
				growth: { type: 'threshold', operator: '>', value: 0, color: '#22c55e' },
			},
		});

		const segments = splitCodeIntoSegments(block);
		const table = segments.find((segment) => segment.type === 'table');
		expect(table).toBeDefined();
		expect(table?.type === 'table' && table.table.conditionalFormats).toEqual({
			churn: { type: 'threshold', operator: '>=', value: 0.1, color: 'rgba(239,68,68,0.3)' },
			growth: { type: 'threshold', operator: '>', value: 0, color: '#22c55e' },
		});
	});

	it('parses a hand-written table tag with ">" inside quoted formatting without truncation', () => {
		const code = `Intro text\n<table query_id="q1" formatting='{"score":{"type":"threshold","operator":">=","value":90,"color":"green"}}' />\nOutro`;
		const segments = splitCodeIntoSegments(code);
		const table = segments.find((segment) => segment.type === 'table');
		expect(table?.type === 'table' && table.table.conditionalFormats).toEqual({
			score: { type: 'threshold', operator: '>=', value: 90, color: 'green' },
		});
		expect(segments.some((segment) => segment.type === 'markdown' && segment.content === 'Outro')).toBe(true);
	});
});

describe('displayTable.InputSchema', () => {
	it('accepts a valid table config with conditional formats', () => {
		const result = displayTable.InputSchema.safeParse({
			query_id: 'query_1',
			title: 'Sales',
			conditional_formats: {
				sales: { type: 'threshold', operator: '<', value: 10, color: '#ef4444' },
			},
		});
		expect(result.success).toBe(true);
	});

	it('rejects an unknown rule type', () => {
		const result = displayTable.InputSchema.safeParse({
			query_id: 'query_1',
			conditional_formats: { sales: { type: 'formula', expr: 'x > 1' } },
		});
		expect(result.success).toBe(false);
	});
});
