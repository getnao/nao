import { describe, expect, it } from 'vitest';

import { buildStoryChartBlock } from '../src/chart-block';
import { splitCodeIntoSegments } from '../src/story-segments';

function seriesOf(code: string) {
	const segment = splitCodeIntoSegments(code).find((s) => s.type === 'chart');
	return segment?.type === 'chart' ? segment.chart.series : null;
}

describe('splitCodeIntoSegments chart series', () => {
	it('round-trips a label containing a backslash built via buildStoryChartBlock', () => {
		const code = buildStoryChartBlock({
			query_id: 'q1',
			chart_type: 'bar',
			x_axis_key: 'month',
			series: [{ data_key: 'rev', color: 'var(--chart-1)', label: 'Disc\\Rebate' }],
			title: 'Revenue',
		});

		expect(seriesOf(code)).toEqual([{ data_key: 'rev', color: 'var(--chart-1)', label: 'Disc\\Rebate' }]);
	});

	it('recovers a hand-authored series where a backslash was not JSON-escaped', () => {
		const code =
			'<chart query_id="q1" chart_type="bar" x_axis_key="month" series=\'[{"data_key":"rev","label":"Disc\\Rebate"}]\' />';

		expect(seriesOf(code)).toEqual([{ data_key: 'rev', label: 'Disc\\Rebate' }]);
	});

	it('round-trips a label containing a double quote', () => {
		const code = buildStoryChartBlock({
			query_id: 'q1',
			chart_type: 'bar',
			x_axis_key: 'month',
			series: [{ data_key: 'rev', color: 'var(--chart-1)', label: 'a "quoted" label' }],
			title: 'Revenue',
		});

		expect(seriesOf(code)).toEqual([{ data_key: 'rev', color: 'var(--chart-1)', label: 'a "quoted" label' }]);
	});
});
