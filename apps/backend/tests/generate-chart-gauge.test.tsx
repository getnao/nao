import { describe, expect, it } from 'vitest';

import { renderChartToSvg } from '../src/components/generate-chart';

describe('renderChartToSvg (gauge)', () => {
	it('preserves the gauge coordinate system at export dimensions', () => {
		const svg = renderChartToSvg({
			config: {
				chart_type: 'gauge',
				series: [{ data_key: 'score' }],
				gauge_segments: [
					{ min: 0, max: 50, color: '#ed6e6e' },
					{ min: 50, max: 100, color: '#84bb4c' },
				],
			},
			data: [{ score: 72 }],
			width: 800,
			height: 500,
		});

		expect(svg).toContain('width="800"');
		expect(svg).toContain('height="500"');
		expect(svg).toContain('viewBox="0 0 540 320"');
	});
});
