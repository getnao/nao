// @vitest-environment jsdom

import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { initStoryState } from '../story-state';
import { useSharedStoryState, useStoryState } from './use-story-state';

let setGauge: (next: number | ((current: number) => number) | null) => void = () => {};

function Gauge() {
	const [value, setValue] = useStoryState<number>('gauge', 50);
	setGauge = setValue as typeof setGauge;
	return <span data-testid='gauge'>{value}</span>;
}

let setVotes: (next: number | ((current: number) => number)) => void = () => {};

function Votes() {
	const [value, setValue] = useSharedStoryState<number>('gauge', 0);
	setVotes = setValue;
	return <span data-testid='votes'>{value}</span>;
}

afterEach(cleanup);

describe('useStoryState', () => {
	it('renders the saved value from the first render', () => {
		initStoryState({ shared: {}, own: { gauge: 80 } }, vi.fn());
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
		expect(persist).toHaveBeenCalledWith({ key: 'gauge', value: 55, shared: false });
	});

	it('removes the key on null, which brings the initial value back', () => {
		const persist = vi.fn();
		initStoryState({ shared: {}, own: { gauge: 80 } }, persist);
		render(<Gauge />);

		act(() => setGauge(null));

		expect(screen.getByTestId('gauge').textContent).toBe('50');
		expect(persist).toHaveBeenCalledWith({ key: 'gauge', value: null, shared: false });
	});

	it('keeps changes to the page in a downloaded story', () => {
		initStoryState({ shared: {}, own: { gauge: 80 } }, null);
		render(<Gauge />);

		act(() => setGauge(20));

		expect(screen.getByTestId('gauge').textContent).toBe('20');
	});

	it('reads and writes the shared value apart from the personal one', () => {
		const persist = vi.fn();
		initStoryState({ shared: { gauge: 4 }, own: { gauge: 80 } }, persist);
		render(
			<>
				<Gauge />
				<Votes />
			</>,
		);

		act(() => setVotes((current) => current + 1));

		expect(screen.getByTestId('votes').textContent).toBe('5');
		expect(screen.getByTestId('gauge').textContent).toBe('80');
		expect(persist).toHaveBeenCalledWith({ key: 'gauge', value: 5, shared: true });
	});
});
