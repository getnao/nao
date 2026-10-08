// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ChartEditorPreview } from './chart-editor-preview';

vi.mock('@/hooks/use-date-format', () => ({
	useDateFormat: () => ({ preset: 'european' }),
}));

vi.mock('@/hooks/use-resize-observer', () => ({
	useResizeObserver: () => undefined,
}));

vi.mock('@/main', () => ({
	trpc: {},
}));

const rows = [
	{ month: '2025-01', revenue: 100, orders: 4 },
	{ month: '2025-02', revenue: 250, orders: 7 },
];

const draft = {
	query_id: 'q1',
	title: 'Revenue',
	chart_type: 'kpi_card' as const,
	x_axis_key: 'month',
	x_axis_type: null,
	series: [{ data_key: 'revenue', label: 'Revenue' }],
};

describe('ChartEditorPreview', () => {
	afterEach(cleanup);

	it('renders the live chart and explains the selection', () => {
		render(
			<ChartEditorPreview
				draft={draft}
				data={rows}
				availableColumns={['month', 'revenue', 'orders']}
				palette={['#123456']}
			/>,
		);

		expect(screen.getByText('What this chart shows')).toBeDefined();
		expect(screen.getByText('KPI card · 2 rows')).toBeDefined();
		expect(screen.getAllByText('Revenue').length).toBeGreaterThan(0);
		expect(screen.getByText('revenue')).toBeDefined();
		expect(screen.getByText('month')).toBeDefined();
		expect(screen.getByText('number · 100 – 250 · sum 350')).toBeDefined();
		expect(screen.queryByRole('tab', { name: /query/i })).toBeNull();
	});

	it('switches to the data table and the query view', () => {
		render(
			<ChartEditorPreview
				draft={draft}
				data={rows}
				availableColumns={['month', 'revenue', 'orders']}
				palette={['#123456']}
				queryView={<pre>select 1</pre>}
			/>,
		);

		fireEvent.click(screen.getByRole('tab', { name: /data/i }));
		expect(screen.getByText('2025-02')).toBeDefined();
		expect(screen.getByText(/Columns used by the chart are tinted/)).toBeDefined();

		fireEvent.click(screen.getByRole('tab', { name: /query/i }));
		expect(screen.getByText('select 1')).toBeDefined();
	});

	it('shows issues when the selection cannot be drawn', () => {
		render(
			<ChartEditorPreview
				draft={{ ...draft, chart_type: 'line', series: [] }}
				data={rows}
				availableColumns={['month', 'revenue', 'orders']}
				palette={['#123456']}
			/>,
		);

		expect(screen.getByText('Add at least one series to plot a value.')).toBeDefined();
		expect(screen.getByText('Add a series to preview the chart.')).toBeDefined();
	});
});
