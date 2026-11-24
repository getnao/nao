// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ChartDisplay } from '@/components/tool-calls/display-chart';

vi.mock('@/hooks/use-date-format', () => ({
	useDateFormat: () => ({ preset: 'european' }),
}));

vi.mock('@/hooks/use-resize-observer', () => ({
	useResizeObserver: () => undefined,
}));

vi.mock('@/main', () => ({
	trpc: {},
}));

describe('ChartDisplay', () => {
	afterEach(() => {
		cleanup();
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
	});

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

	it('marks the left-aligned chart title as a citable title part', () => {
		vi.stubGlobal(
			'ResizeObserver',
			class {
				observe() {}
				unobserve() {}
				disconnect() {}
			},
		);
		vi.spyOn(console, 'warn').mockImplementation(() => {});
		render(
			<ChartDisplay
				title='Revenue by month'
				titleStyle='left'
				data={[
					{ month: '2018-01', revenue: 10 },
					{ month: '2018-02', revenue: 26 },
				]}
				chartType='bar'
				xAxisKey='month'
				xAxisType='category'
				series={[{ data_key: 'revenue' }]}
			/>,
		);

		expect(screen.getByText('Revenue by month').getAttribute('data-nao-part')).toBe('title');
	});
});
