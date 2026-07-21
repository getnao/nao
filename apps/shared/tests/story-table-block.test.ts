import { describe, expect, it } from 'vitest';

import { buildStoryTableBlock } from '../src/chart-block';
import type { ColumnConditionalFormats } from '../src/conditional-formatting';
import { injectTableFormatting, parseTableBlock, splitCodeIntoSegments } from '../src/story-segments';
import { displayChart } from '../src/tools';

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

	it('preserves a color-scale main color through build → split → parse', () => {
		const conditionalFormats = {
			revenue: { type: 'color-scale' as const, color: '#ff0000' },
			margin: { type: 'color-scale' as const, minColor: '#000000', maxColor: '#ffffff', min: 0, max: 1 },
		};
		const block = buildStoryTableBlock({
			query_id: 'query_z',
			title: 'Perf',
			conditional_formats: conditionalFormats,
		});

		const segments = splitCodeIntoSegments(block);
		const table = segments.find((segment) => segment.type === 'table');
		expect(table?.type === 'table' && table.table.conditionalFormats).toEqual(conditionalFormats);
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

	it('sets rawTag on the parsed table segment', () => {
		const tag = `<table query_id="q9" title="Sales" />`;
		const segments = splitCodeIntoSegments(`text\n${tag}\nmore`);
		const table = segments.find((segment) => segment.type === 'table');
		expect(table?.type === 'table' && table.table.rawTag).toBe(tag);
	});
});

describe('injectTableFormatting', () => {
	const formatsByQueryId: Record<string, ColumnConditionalFormats> = {
		q1: { revenue: { type: 'color-scale', color: '#ff0000' } },
		q2: { churn: { type: 'threshold', operator: '>=', value: 0.1, color: 'red' } },
	};

	it('injects formatting into a plain table tag that has a matching query_id', () => {
		const injected = injectTableFormatting('<table query_id="q1" title="Revenue" />', formatsByQueryId);
		const parsed = splitCodeIntoSegments(injected).find((s) => s.type === 'table');
		expect(parsed?.type === 'table' && parsed.table.conditionalFormats).toEqual({
			revenue: { type: 'color-scale', color: '#ff0000' },
		});
	});

	it('leaves tables with explicit formatting untouched (agent-authored wins)', () => {
		const original = `<table query_id="q1" formatting='{"revenue":{"type":"color-scale"}}' />`;
		expect(injectTableFormatting(original, formatsByQueryId)).toBe(original);
	});

	it('leaves tables whose query_id has no stored formatting untouched', () => {
		const original = '<table query_id="qX" title="Other" />';
		expect(injectTableFormatting(original, formatsByQueryId)).toBe(original);
	});

	it('injects threshold formatting (quote-aware) and round-trips', () => {
		const injected = injectTableFormatting('<table query_id="q2" />', formatsByQueryId);
		const parsed = splitCodeIntoSegments(injected).find((s) => s.type === 'table');
		expect(parsed?.type === 'table' && parsed.table.conditionalFormats).toEqual({
			churn: { type: 'threshold', operator: '>=', value: 0.1, color: 'red' },
		});
	});

	it('is a no-op when the formats map is empty', () => {
		const original = '<table query_id="q1" />';
		expect(injectTableFormatting(original, {})).toBe(original);
	});
});

describe('displayChart.InputSchema table variant', () => {
	it('accepts a valid chart config', () => {
		const result = displayChart.InputSchema.safeParse({
			query_id: 'query_1',
			chart_type: 'bar',
			x_axis_key: 'month',
			x_axis_type: 'category',
			series: [{ data_key: 'sales' }],
			title: 'Monthly sales',
		});
		expect(result.success).toBe(true);
	});

	it('rejects a chart config missing chart fields', () => {
		const result = displayChart.InputSchema.safeParse({
			query_id: 'query_1',
			chart_type: 'bar',
		});
		expect(result.success).toBe(false);
	});

	it('accepts a valid table config with conditional formats', () => {
		const result = displayChart.InputSchema.safeParse({
			query_id: 'query_1',
			chart_type: 'table',
			title: 'Sales',
			conditional_formats: {
				sales: { type: 'threshold', operator: '<', value: 10, color: '#ef4444' },
			},
		});
		expect(result.success).toBe(true);
	});

	it('rejects an unknown rule type', () => {
		const result = displayChart.InputSchema.safeParse({
			query_id: 'query_1',
			chart_type: 'table',
			conditional_formats: { sales: { type: 'formula', expr: 'x > 1' } },
		});
		expect(result.success).toBe(false);
	});
});
