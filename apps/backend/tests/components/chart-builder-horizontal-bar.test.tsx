import { buildChart } from '@nao/shared';
import React from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

const WIDTH = 600;

describe('horizontal_bar_100 without axes', () => {
	it('stretches every stacked row across the full width, as in story thumbnails', () => {
		const chart = buildChart({
			data: [
				{ region: 'EMEA', won: 3, lost: 7 },
				{ region: 'AMER', won: 5, lost: 5 },
			],
			chartType: 'horizontal_bar_100',
			xAxisKey: 'region',
			series: [{ data_key: 'won' }, { data_key: 'lost' }],
			colorFor: (key) => (key === 'won' ? '#aa0000' : '#00aa00'),
			labelFormatter: (value) => value,
			hideAxes: true,
		});
		const html = renderToString(React.cloneElement(chart, { width: WIDTH, height: 300 }));

		const lastSegments = [...html.matchAll(/fill="#00aa00"[^>]*?d="([^"]+)"/g)].map((match) => match[1]);
		expect(lastSegments).toHaveLength(2);
		for (const path of lastSegments) {
			expect(path).toContain(`${WIDTH},`);
		}
	});
});
