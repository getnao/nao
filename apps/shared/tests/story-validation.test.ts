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
			const code = '<chart query_id="q1" chart_type="bubble" x_axis_key="month" data_key="revenue" title="x" />';
			const errors = validateStoryCode(code);
			expect(errors).toHaveLength(1);
			expect(errors[0].message).toMatch(/Invalid chart_type "bubble"/);
		});

		it('accepts the donut chart_type', () => {
			const code = '<chart query_id="q1" chart_type="donut" x_axis_key="month" data_key="revenue" title="x" />';
			const errors = validateStoryCode(code);
			expect(errors).toHaveLength(0);
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

		it('accepts a series label containing a backslash', () => {
			const code =
				'<chart query_id="q1" chart_type="line" x_axis_key="month" series=\'[{"data_key":"rev","label":"Disc\\Rebate"}]\' title="x" />';
			expect(validateStoryCode(code)).toEqual([]);
		});

		it('accepts a series label containing a bracket', () => {
			const code =
				'<chart query_id="q1" chart_type="line" x_axis_key="month" series=\'[{"data_key":"rev","label":"a]b"}]\' title="x" />';
			expect(validateStoryCode(code)).toEqual([]);
		});

		it('accepts a self-closing chart whose title contains a slash', () => {
			const code =
				'<chart query_id="q1" chart_type="line" x_axis_key="week" series=\'[{"data_key":"orders"}]\' title="13/07 update" />';
			expect(validateStoryCode(code)).toEqual([]);
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

		it('accepts valid widths', () => {
			const code = [
				'<grid widths="3,1">',
				'<chart query_id="a" chart_type="line" x_axis_key="x" data_key="y" title="t" />',
				'<chart query_id="b" chart_type="bar" x_axis_key="x" data_key="y" title="t" />',
				'</grid>',
			].join('\n');
			expect(validateStoryCode(code)).toEqual([]);
		});

		it('flags widths with the wrong count', () => {
			const code = [
				'<grid widths="3">',
				'<chart query_id="a" chart_type="line" x_axis_key="x" data_key="y" title="t" />',
				'<chart query_id="b" chart_type="bar" x_axis_key="x" data_key="y" title="t" />',
				'</grid>',
			].join('\n');
			const errors = validateStoryCode(code);
			expect(errors.some((e) => e.message === 'Grid `widths` has 1 values but the grid has 2 columns.')).toBe(
				true,
			);
		});

		it('flags non-integer widths', () => {
			const code = [
				'<grid widths="1.5,-1">',
				'<chart query_id="a" chart_type="line" x_axis_key="x" data_key="y" title="t" />',
				'<chart query_id="b" chart_type="bar" x_axis_key="x" data_key="y" title="t" />',
				'</grid>',
			].join('\n');
			const errors = validateStoryCode(code);
			expect(
				errors.some((e) => e.message === 'Grid `widths` must be a comma-separated list of positive integers.'),
			).toBe(true);
		});

		it('accepts a grid without widths', () => {
			const code = [
				'<grid cols="2">',
				'<chart query_id="a" chart_type="line" x_axis_key="x" data_key="y" title="t" />',
				'<chart query_id="b" chart_type="bar" x_axis_key="x" data_key="y" title="t" />',
				'</grid>',
			].join('\n');
			expect(validateStoryCode(code)).toEqual([]);
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

	describe('tabs validation', () => {
		it('accepts a well-formed tabbed story', () => {
			const code = [
				'<tab title="Overview">',
				'# Overview',
				'</tab>',
				'<tab title="Details">',
				'<table query_id="q1" title="Details" />',
				'</tab>',
			].join('\n');

			expect(validateStoryCode(code)).toEqual([]);
		});

		it('accepts a tab title containing >', () => {
			const code = ['<tab title="Revenue > 1000">', '# Revenue', '</tab>'].join('\n');
			expect(validateStoryCode(code)).toEqual([]);
		});

		it('does not treat table blocks as tabs', () => {
			expect(validateStoryCode('<table query_id="q1" title="Details" />')).toEqual([]);
		});

		it('flags content before the first tab', () => {
			const errors = validateStoryCode('Intro\n<tab title="Overview">Content</tab>');
			expect(errors.some((e) => /not allowed outside <tab> blocks/.test(e.message))).toBe(true);
		});

		it('flags a tab missing a title', () => {
			const errors = validateStoryCode('<tab>Content</tab>');
			expect(errors.some((e) => /missing a required `title`/.test(e.message))).toBe(true);
		});

		it('flags an unterminated tab', () => {
			const errors = validateStoryCode('<tab title="Overview">Content');
			expect(errors.some((e) => /missing a matching <\/tab>/.test(e.message))).toBe(true);
		});

		it('flags content between tabs', () => {
			const code = [
				'<tab title="Overview">Overview</tab>',
				'Stray paragraph',
				'<tab title="Details">Details</tab>',
			].join('\n');
			const errors = validateStoryCode(code);
			expect(errors.some((e) => /not allowed outside <tab>/.test(e.message))).toBe(true);
		});

		it('flags content after the last tab', () => {
			const code = '<tab title="Overview">Content</tab>\nAfter';
			const errors = validateStoryCode(code);
			expect(errors.some((e) => /not allowed outside <tab> blocks/.test(e.message))).toBe(true);
		});
	});

	describe('filter validation', () => {
		it('accepts a well-formed filter tag with table source', () => {
			const code = '<filter id="country" column="country" label="Country" type="multi_select" table="orders" />';
			expect(validateStoryCode(code)).toEqual([]);
		});

		it('accepts a filter with hardcoded options', () => {
			const code = `<filter id="country" label="Country" type="select" options='["US","FR"]' />`;
			expect(validateStoryCode(code)).toEqual([]);
		});

		it('flags select filters missing both options and table/column', () => {
			expect(
				validateStoryCode('<filter id="country" type="select" />').some((e) =>
					/require either `options=/.test(e.message),
				),
			).toBe(true);
		});

		it('flags invalid filter types', () => {
			expect(
				validateStoryCode('<filter id="country" column="country" type="number_range" table="orders" />').some(
					(e) => /Invalid filter type/.test(e.message),
				),
			).toBe(true);
		});

		it('flags filter ids that cannot be used in SQL templates', () => {
			const errors = validateStoryCode('<filter id="order-status" type="search" />');
			expect(errors.some((error) => error.message.includes('Invalid filter id "order-status"'))).toBe(true);
		});

		it('flags duplicate filter ids', () => {
			const code = [
				'<filter id="country" column="country" type="select" table="orders" />',
				'<filter id="country" column="region" type="select" table="orders" />',
			].join('\n');
			expect(validateStoryCode(code).some((e) => /must be unique/.test(e.message))).toBe(true);
		});
	});

	it('reports line and column for errors', () => {
		const code = ['# intro', '', 'some text', '', '<chart query_id="q" />'].join('\n');
		const errors = validateStoryCode(code);
		expect(errors[0].line).toBe(5);
		expect(errors[0].column).toBe(1);
	});
});
