import { describe, expect, it } from 'vitest';

import { renderChartToSvg } from '../src/components/generate-chart';

const ROWS = [
	{ month: 'Jan', inspections: 12 },
	{ month: 'Feb', inspections: 18 },
];

const SERIES_LABEL = 'Total inspections';

describe('renderChartToSvg legend visibility', () => {
	it('draws the legend by default', () => {
		expect(render({})).toContain(SERIES_LABEL);
	});

	it('hides the legend when show_legend is false', () => {
		expect(render({ show_legend: false })).not.toContain(SERIES_LABEL);
	});

	it('hides the pie legend when show_legend is false', () => {
		expect(render({ chart_type: 'pie' })).toContain('>Jan<');
		expect(render({ chart_type: 'pie', show_legend: false })).not.toContain('>Jan<');
	});

	it('keeps the legend hidden when the caller excludes it, even if show_legend is true', () => {
		expect(render({ show_legend: true }, false)).not.toContain(SERIES_LABEL);
	});
});

function render(config: Partial<Parameters<typeof renderChartToSvg>[0]['config']>, includeLegend?: boolean): string {
	return renderChartToSvg({
		config: {
			chart_type: 'bar',
			x_axis_key: 'month',
			x_axis_type: 'category',
			series: [{ data_key: 'inspections', label: SERIES_LABEL }],
			...config,
		},
		data: ROWS,
		includeLegend,
	});
}
