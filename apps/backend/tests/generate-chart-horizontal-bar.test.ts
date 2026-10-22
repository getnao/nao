import { describe, expect, it } from 'vitest';

import { renderChartToSvg } from '../src/components/generate-chart';

const countries = [
	'China',
	'India',
	'Turkey',
	'United States',
	'Egypt',
	'Italy',
	'Spain',
	'Mexico',
	'Brazil',
	'Nigeria',
];

describe('renderChartToSvg (horizontal bar)', () => {
	it('labels every bar when the rows fit the chart height', () => {
		const svg = render(countries.map((country, index) => ({ country, production: 100 - index })));

		expect(readCategoryLabels(svg)).toEqual(countries);
	});

	it('skips category labels once the rows are denser than a line of text', () => {
		const rows = Array.from({ length: 60 }, (_, index) => ({ country: `Country ${index + 1}`, production: index }));
		const labels = readCategoryLabels(render(rows));

		expect(labels.length).toBeGreaterThan(1);
		expect(labels.length).toBeLessThan(rows.length);
	});
});

function render(data: Record<string, unknown>[]): string {
	return renderChartToSvg({
		config: {
			chart_type: 'horizontal_bar',
			x_axis_key: 'country',
			x_axis_type: 'category',
			series: [{ data_key: 'production' }],
		},
		data,
	});
}

function readCategoryLabels(svg: string): string[] {
	const labelPattern = /class="recharts-text recharts-cartesian-axis-tick-value"[^>]*>([^<]*)<\/text>/g;
	return [...svg.matchAll(labelPattern)].map((match) => match[1]);
}
