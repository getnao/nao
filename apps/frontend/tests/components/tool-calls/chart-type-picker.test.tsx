// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CHART_TYPE_OPTIONS, ChartTypePicker } from '@/components/tool-calls/chart-type-picker';
import { TooltipProvider } from '@/components/ui/tooltip';

describe('ChartTypePicker', () => {
	afterEach(() => {
		cleanup();
	});

	it('renders one button per chart type with the current one pressed', () => {
		renderPicker('line');

		expect(screen.getAllByRole('button')).toHaveLength(CHART_TYPE_OPTIONS.length);
		expect(screen.getByRole('button', { name: 'Line' }).getAttribute('aria-pressed')).toBe('true');
		expect(screen.getByRole('button', { name: 'Bar' }).getAttribute('aria-pressed')).toBe('false');
	});

	it('reports the picked chart type', () => {
		const onValueChange = renderPicker('bar');

		fireEvent.click(screen.getByRole('button', { name: 'Donut' }));

		expect(onValueChange).toHaveBeenCalledWith('donut');
	});
});

function renderPicker(value: 'bar' | 'line') {
	const onValueChange = vi.fn();
	render(
		<TooltipProvider>
			<ChartTypePicker value={value} onValueChange={onValueChange} />
		</TooltipProvider>,
	);
	return onValueChange;
}
