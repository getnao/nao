import React from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { buildChart, niceAxisMax, shouldReserveDataLabelHeadroom } from '../src/chart-builder';

function renderChart(element: React.ReactElement) {
	return renderToString(React.cloneElement(element, { width: 600, height: 400 }));
}

describe('buildChart data labels', () => {
	it('rounds axis max using nice tick steps', () => {
		expect(niceAxisMax(622)).toBe(800);
		expect(niceAxisMax(780)).toBe(800);
		expect(niceAxisMax(460)).toBe(600);
	});

	it('does not reserve headroom when labels fit below the nice axis top', () => {
		expect(
			shouldReserveDataLabelHeadroom({
				data: [{ m: 'a', v: 460 }],
				chartType: 'bar',
				xAxisKey: 'm',
				series: [{ data_key: 'v' }],
				showDataLabels: true,
			}),
		).toBe(false);
	});

	it('reserves headroom when labels are close to the nice axis top', () => {
		expect(
			shouldReserveDataLabelHeadroom({
				data: [{ m: 'a', v: 780 }],
				chartType: 'bar',
				xAxisKey: 'm',
				series: [{ data_key: 'v' }],
				showDataLabels: true,
			}),
		).toBe(true);
	});

	it('does not reserve headroom when data labels are disabled', () => {
		expect(
			shouldReserveDataLabelHeadroom({
				data: [{ m: 'a', v: 780 }],
				chartType: 'bar',
				xAxisKey: 'm',
				series: [{ data_key: 'v' }],
			}),
		).toBe(false);
	});

	it('renders x and y axes for cartesian charts', () => {
		const html = renderChart(
			buildChart({
				data: [
					{ month: 'Jan', sales: 460 },
					{ month: 'Feb', sales: 520 },
				],
				chartType: 'bar',
				xAxisKey: 'month',
				xAxisType: 'category',
				series: [{ data_key: 'sales' }],
			}),
		);

		expect(html).toContain('recharts-yAxis');
		expect(html).toContain('recharts-xAxis');
	});

	it('renders point labels when enabled for bar charts', () => {
		const html = renderChart(
			buildChart({
				data: [{ month: 'Jan', sales: 460 }],
				chartType: 'bar',
				xAxisKey: 'month',
				xAxisType: 'category',
				series: [{ data_key: 'sales' }],
				showDataLabels: true,
			}),
		);

		expect(html).toContain('460');
	});

	it('renders stacked labels from non-total series only', () => {
		const html = renderChart(
			buildChart({
				data: [{ month: 'Jan', new_sales: 100, renewal_sales: 200, total_sales: 300 }],
				chartType: 'stacked_bar',
				xAxisKey: 'month',
				xAxisType: 'category',
				series: [
					{ data_key: 'new_sales' },
					{ data_key: 'renewal_sales' },
					{ data_key: 'total_sales', is_total: true },
				],
				showDataLabels: true,
			}),
		);

		expect(html.match(/>300<\/text>/g)).toHaveLength(1);
		expect(html).not.toContain('>600</text>');
	});

	it('does not render total series as stacked bar segments', () => {
		const colors: Record<string, string> = {
			new_sales: '#111111',
			renewal_sales: '#222222',
			total_sales: '#333333',
		};
		const html = renderChart(
			buildChart({
				data: [{ month: 'Jan', new_sales: 100, renewal_sales: 200, total_sales: 300 }],
				chartType: 'stacked_bar',
				xAxisKey: 'month',
				xAxisType: 'category',
				series: [
					{ data_key: 'new_sales' },
					{ data_key: 'renewal_sales' },
					{ data_key: 'total_sales', is_total: true },
				],
				colorFor: (key) => colors[key],
				showDataLabels: false,
			}),
		);

		expect(html).toContain('fill="#111111"');
		expect(html).toContain('fill="#222222"');
		expect(html).not.toContain('fill="#333333"');
	});

	it('thins dense line chart labels while keeping the max value', () => {
		const data = Array.from({ length: 40 }, (_, index) => ({
			day: `Day ${index + 1}`,
			value: index === 37 ? 999 : index + 1,
		}));
		const html = renderChart(
			buildChart({
				data,
				chartType: 'line',
				xAxisKey: 'day',
				xAxisType: 'category',
				series: [{ data_key: 'value' }],
				showDataLabels: true,
			}),
		);
		const labelCount = html.match(/fill="var\(--foreground, #111827\)"/g)?.length ?? 0;

		expect(labelCount).toBeGreaterThan(0);
		expect(labelCount).toBeLessThan(data.length);
		expect(html).toContain('>999</text>');
	});

	it('labels peaks instead of baseline points for dense spiky line charts', () => {
		const values = Array.from({ length: 36 }, () => 1);
		values[4] = 3;
		values[11] = 9;
		values[19] = 4;
		values[28] = 3;
		const data = values.map((value, index) => ({ day: `Day ${index + 1}`, value }));
		const html = renderChart(
			buildChart({
				data,
				chartType: 'line',
				xAxisKey: 'day',
				xAxisType: 'category',
				series: [{ data_key: 'value' }],
				showDataLabels: true,
			}),
		);
		const labelCount = html.match(/fill="var\(--foreground, #111827\)"/g)?.length ?? 0;
		const baselineLabelCount =
			html.match(/<text[^>]*fill="var\(--foreground, #111827\)"[^>]*>1<\/text>/g)?.length ?? 0;

		expect(html).toContain('>9</text>');
		expect(labelCount).toBeGreaterThan(0);
		expect(labelCount).toBeLessThan(data.length);
		expect(labelCount).toBeLessThanOrEqual(12);
		expect(baselineLabelCount).toBe(0);
	});
});
