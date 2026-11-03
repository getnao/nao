import { describe, expect, it } from 'vitest';

import { generateKpiCardImage } from '../src/components/generate-kpi-card';

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

describe('generateKpiCardImage', () => {
	it('renders a KPI card as a PNG, including titles and values that need escaping', () => {
		const png = generateKpiCardImage({
			config: {
				query_id: 'query-1',
				chart_type: 'kpi_card',
				title: 'Orders <all time> & more',
				series: [
					{ data_key: 'orders', label: 'Orders' },
					{ data_key: 'revenue', label: 'Revenue', value_format: { d3_format: ',.2f', prefix: '$' } },
				],
			} as never,
			rows: [{ orders: 99, revenue: 1672.5 }],
		});

		expect(png.subarray(0, 4)).toEqual(PNG_SIGNATURE);
	});
});
