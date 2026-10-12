// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CHART_TYPE_OPTIONS, ChartTypePicker } from './chart-type-picker';
import { TooltipProvider } from '@/components/ui/tooltip';

describe('ChartTypePicker', () => {
	afterEach(() => {
		cleanup();
	});

	it('renders one radio per chart type with the current one checked', () => {
		renderPicker('line');

		expect(screen.getAllByRole('radio')).toHaveLength(CHART_TYPE_OPTIONS.length);
		expect(screen.getByRole('radio', { name: 'Line' }).getAttribute('aria-checked')).toBe('true');
		expect(screen.getByRole('radio', { name: 'Bar' }).getAttribute('aria-checked')).toBe('false');
	});

	it('reports the picked chart type', () => {
		const onValueChange = renderPicker('bar');

		fireEvent.click(screen.getByRole('radio', { name: 'Donut' }));

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
