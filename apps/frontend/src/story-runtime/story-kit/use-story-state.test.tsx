// @vitest-environment jsdom

import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { initStoryState, replaceStoryState } from '../story-state';
import { useStoryState } from './use-story-state';

let setGauge: (next: number | ((current: number) => number) | null) => void = () => {};

function Gauge() {
	const [value, setValue] = useStoryState<number>('gauge', 50);
	setGauge = setValue as typeof setGauge;
	return <span data-testid='gauge'>{value}</span>;
}

afterEach(cleanup);

describe('useStoryState', () => {
	it('renders the saved value from the first render', () => {
		initStoryState({ gauge: 80 }, vi.fn());
		render(<Gauge />);

		expect(screen.getByTestId('gauge').textContent).toBe('80');
	});

	it('falls back to the initial value and hands each change to the host', () => {
		const persist = vi.fn();
		initStoryState(undefined, persist);
		render(<Gauge />);
		expect(screen.getByTestId('gauge').textContent).toBe('50');

		act(() => setGauge((current) => current + 5));

		expect(screen.getByTestId('gauge').textContent).toBe('55');
		expect(persist).toHaveBeenCalledWith({ key: 'gauge', value: 55 });
	});

	it('removes the key on null, which brings the initial value back', () => {
		const persist = vi.fn();
		initStoryState({ gauge: 80 }, persist);
		render(<Gauge />);

		act(() => setGauge(null));

		expect(screen.getByTestId('gauge').textContent).toBe('50');
		expect(persist).toHaveBeenCalledWith({ key: 'gauge', value: null });
	});

	it('shows whatever the host switches the story to', () => {
		initStoryState({ gauge: 80 }, vi.fn());
		render(<Gauge />);

		act(() => replaceStoryState({ gauge: 10 }));

		expect(screen.getByTestId('gauge').textContent).toBe('10');
	});

	it('keeps changes to the page in a downloaded story', () => {
		initStoryState({ gauge: 80 }, null);
		render(<Gauge />);

		act(() => setGauge(20));

		expect(screen.getByTestId('gauge').textContent).toBe('20');
	});
});
