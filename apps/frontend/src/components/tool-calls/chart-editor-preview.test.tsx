// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ChartEditorPreview } from './chart-editor-preview';
import { TooltipProvider } from '@/components/ui/tooltip';
import { summarizeChartSelection } from '@/lib/chart-selection-summary';

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

const rows = [
	{ month: '2025-01', revenue: 100, orders: 4 },
	{ month: '2025-02', revenue: 250, orders: 7 },
];

const columns = ['month', 'revenue', 'orders'];

const draft = {
	query_id: 'q1',
	title: 'Revenue',
	chart_type: 'kpi_card' as const,
	x_axis_key: 'month',
	x_axis_type: null,
	series: [{ data_key: 'revenue', label: 'Revenue' }],
};

function renderPreview(previewDraft: Parameters<typeof summarizeChartSelection>[0] = draft) {
	return render(
		<TooltipProvider>
			<ChartEditorPreview
				draft={previewDraft}
				data={rows}
				columns={columns}
				summary={summarizeChartSelection(previewDraft, rows, ['#123456'])}
			/>
		</TooltipProvider>,
	);
}

describe('ChartEditorPreview', () => {
	afterEach(cleanup);

	it('renders the live chart by default', () => {
		renderPreview();

		expect(screen.getByRole('button', { name: 'Chart' }).getAttribute('aria-pressed')).toBe('true');
		expect(screen.getAllByText('Revenue').length).toBeGreaterThan(0);
		expect(screen.queryByText('2025-02')).toBeNull();
	});

	it('switches to the table and to the split view', () => {
		renderPreview();

		fireEvent.click(screen.getByRole('button', { name: 'Table' }));
		expect(screen.getByText('2025-02')).toBeDefined();

		fireEvent.click(screen.getByRole('button', { name: 'Chart and table' }));
		expect(screen.getByText('2025-02')).toBeDefined();
		expect(screen.getAllByText('Revenue').length).toBeGreaterThan(0);
	});

	it('shows issues when the selection cannot be drawn', () => {
		renderPreview({ ...draft, chart_type: 'line', series: [] });

		expect(screen.getByText('Add at least one series to plot a value.')).toBeDefined();
		expect(screen.getByText('Add a series to preview the chart.')).toBeDefined();
	});
});
