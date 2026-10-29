// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ChartDisplay } from './display-chart';
import type { ChartDisplayProps } from './display-chart';

vi.mock('@/hooks/use-date-format', () => ({
	useDateFormat: () => ({ preset: 'european' }),
}));

vi.mock('@/hooks/use-resize-observer', () => ({
	useResizeObserver: () => undefined,
}));

vi.mock('@/main', () => ({
	trpc: {},
}));

vi.stubGlobal(
	'ResizeObserver',
	class {
		observe() {}
		unobserve() {}
		disconnect() {}
	},
);

describe('ChartDisplay', () => {
	afterEach(cleanup);

	it('renders a left-aligned title for KPI cards', () => {
		render(
			<ChartDisplay
				title='Messages'
				titleStyle='left'
				data={[{ totalMessages: 12, uniqueUsers: 4 }]}
				chartType='kpi_card'
				xAxisKey='date'
				xAxisType='category'
				series={[
					{ data_key: 'totalMessages', label: 'Total messages' },
					{ data_key: 'uniqueUsers', label: 'Unique users' },
				]}
			/>,
		);

		expect(screen.getByText('Messages')).toBeDefined();
		expect(screen.getByText('Total messages')).toBeDefined();
		expect(screen.getByText('Unique users')).toBeDefined();
	});

	it('hides the legend when the chart has a single series', () => {
		renderBarChart({ series: [{ data_key: 'inspections', label: 'Inspections' }] });

		expect(screen.queryByText('Inspections')).toBeNull();
	});

	it('shows the legend when the chart is split into several series', () => {
		renderBarChart({
			series: [
				{ data_key: 'inspections', label: 'Inspections' },
				{ data_key: 'failures', label: 'Failures' },
			],
		});

		expect(screen.getByText('Inspections')).toBeDefined();
		expect(screen.getByText('Failures')).toBeDefined();
	});

	it('keeps an explicit showLegend over the single-series default', () => {
		renderBarChart({ series: [{ data_key: 'inspections', label: 'Inspections' }], showLegend: true });

		expect(screen.getByText('Inspections')).toBeDefined();
	});
});

function renderBarChart({ series, showLegend }: Pick<ChartDisplayProps, 'series' | 'showLegend'>) {
	render(
		<ChartDisplay
			title='Total inspections'
			titleStyle='left'
			data={[
				{ month: 'Jan', inspections: 12, failures: 2 },
				{ month: 'Feb', inspections: 18, failures: 3 },
			]}
			chartType='bar'
			xAxisKey='month'
			xAxisType='category'
			series={series}
			showLegend={showLegend}
		/>,
	);
}
