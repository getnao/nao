import { describe, expect, it } from 'vitest';

import { validateStoryCode } from '../src/story-validation';

describe('validateStoryCode', () => {
	it('returns no errors for well-formed code', () => {
		const code = [
			'# Revenue report',
			'',
			'Some markdown content here.',
			'',
			'<chart query_id="q1" chart_type="line" x_axis_key="month" series=\'[{"data_key":"revenue"}]\' title="Revenue" />',
			'',
			'<table query_id="q2" title="Details" />',
			'',
			'<grid cols="2">',
			'<chart query_id="q3" chart_type="bar" x_axis_key="day" data_key="count" title="Counts" />',
			'<chart query_id="q4" chart_type="pie" x_axis_key="category" data_key="value" title="Shares" />',
			'</grid>',
		].join('\n');

		expect(validateStoryCode(code)).toEqual([]);
	});

	it('accepts plain markdown without any embed tags', () => {
		expect(validateStoryCode('# title\n\nHello **world**!')).toEqual([]);
	});

	describe('chart validation', () => {
		it('flags missing required attributes', () => {
			const code = '<chart query_id="q1" />';
			const errors = validateStoryCode(code);
			expect(errors.some((e) => /missing required attributes: chart_type, x_axis_key/.test(e.message))).toBe(
				true,
			);
		});

		it('flags invalid chart_type', () => {
			const code = '<chart query_id="q1" chart_type="donut" x_axis_key="month" data_key="revenue" title="x" />';
			const errors = validateStoryCode(code);
			expect(errors).toHaveLength(1);
			expect(errors[0].message).toMatch(/Invalid chart_type "donut"/);
		});

		it('flags invalid x_axis_type', () => {
			const code =
				'<chart query_id="q1" chart_type="line" x_axis_key="month" x_axis_type="bogus" data_key="revenue" title="x" />';
			const errors = validateStoryCode(code);
			expect(errors.some((e) => e.message.includes('Invalid x_axis_type "bogus"'))).toBe(true);
		});

		it('flags a chart without series or data_key', () => {
			const code = '<chart query_id="q1" chart_type="line" x_axis_key="month" title="x" />';
			const errors = validateStoryCode(code);
			expect(errors.some((e) => e.message.includes('series=[...]'))).toBe(true);
		});

		it('flags a chart with malformed JSON series', () => {
			const code = '<chart query_id="q1" chart_type="line" x_axis_key="month" series="[not json" title="x" />';
			const errors = validateStoryCode(code);
			expect(errors.some((e) => e.message.toLowerCase().includes('valid json array'))).toBe(true);
		});

		it('flags a chart with an empty series array', () => {
			const code = '<chart query_id="q1" chart_type="line" x_axis_key="month" series="[]" title="x" />';
			const errors = validateStoryCode(code);
			expect(errors.some((e) => e.message.includes('non-empty JSON array'))).toBe(true);
		});

		it('flags series entries without data_key', () => {
			const code =
				'<chart query_id="q1" chart_type="line" x_axis_key="month" series=\'[{"color":"red"}]\' title="x" />';
			const errors = validateStoryCode(code);
			expect(errors.some((e) => e.message.includes('data_key'))).toBe(true);
		});

		it('flags <chart> tags closed with ">" instead of "/>"', () => {
			const code = '<chart query_id="q1" chart_type="line" x_axis_key="month" data_key="revenue" title="x">';
			const errors = validateStoryCode(code);
			expect(errors.some((e) => e.message.includes('self-closing'))).toBe(true);
		});
	});

	describe('table validation', () => {
		it('flags tables missing query_id', () => {
			const code = '<table title="Orders" />';
			const errors = validateStoryCode(code);
			expect(errors).toHaveLength(1);
			expect(errors[0].message).toMatch(/missing required attribute: query_id/);
		});

		it('does not flag markdown tables', () => {
			const code = '| foo | bar |\n| --- | --- |\n| 1 | 2 |';
			expect(validateStoryCode(code)).toEqual([]);
		});

		it('still validates <table> tags that follow a markdown table in the document', () => {
			const code = ['| a | b |', '| - | - |', '| 1 | 2 |', '', '<table title="Oops" />'].join('\n');
			const errors = validateStoryCode(code);
			expect(errors).toHaveLength(1);
			expect(errors[0].message).toMatch(/missing required attribute: query_id/);
			expect(errors[0].line).toBe(5);
		});

		it('skips <table> tags embedded inside a markdown table cell', () => {
			const code = '| a | <table query_id="q" /> |\n| - | - |\n| 1 | 2 |';
			expect(validateStoryCode(code)).toEqual([]);
		});

		it('flags <table> tags closed with ">" instead of "/>"', () => {
			const code = '<table query_id="q" title="t">';
			const errors = validateStoryCode(code);
			expect(errors.some((e) => e.message.includes('self-closing'))).toBe(true);
		});
	});

	describe('grid validation', () => {
		it('flags unterminated grid blocks', () => {
			const code =
				'<grid cols="2">\n<chart query_id="q1" chart_type="line" x_axis_key="x" data_key="y" title="t" />';
			const errors = validateStoryCode(code);
			expect(errors.some((e) => e.message.includes('matching </grid>'))).toBe(true);
		});

		it('flags invalid cols values', () => {
			const code = '<grid cols="12">\n</grid>';
			const errors = validateStoryCode(code);
			expect(errors.some((e) => e.message.includes('between 1 and 4'))).toBe(true);
		});

		it('supports nested grids', () => {
			const code = [
				'<grid cols="2">',
				'<grid cols="1">',
				'<chart query_id="a" chart_type="line" x_axis_key="x" data_key="y" title="t" />',
				'</grid>',
				'<chart query_id="b" chart_type="line" x_axis_key="x" data_key="y" title="t" />',
				'</grid>',
			].join('\n');
			expect(validateStoryCode(code)).toEqual([]);
		});
	});

	it('reports line and column for errors', () => {
		const code = ['# intro', '', 'some text', '', '<chart query_id="q" />'].join('\n');
		const errors = validateStoryCode(code);
		expect(errors[0].line).toBe(5);
		expect(errors[0].column).toBe(1);
	});
});
