// @vitest-environment jsdom

import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useQueryData } from './hooks';

const host = vi.hoisted(() => ({
	getStoryTheme: vi.fn(),
	isEditingEnabled: vi.fn(),
	requestQueryData: vi.fn(),
	requestSql: vi.fn(),
	subscribeToEditing: vi.fn(),
	subscribeToTheme: vi.fn(),
}));

vi.mock('../story-host', () => host);

let refetchRegion: () => void = () => {};

function RegionRows({ queryId, region }: { queryId: string; region: string }) {
	const rows = useQueryData(queryId, { filters: { region } });
	refetchRegion = rows.refetch;
	return <span data-testid='rows'>{rows.status === 'success' ? rows.data.length : rows.status}</span>;
}

afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});

describe('useQueryData', () => {
	it('refreshes the request on screen once: going back to any earlier one reads the cache again', async () => {
		host.requestQueryData.mockResolvedValue({ columns: ['n'], data: [{ n: 1 }] });
		const { rerender } = render(<RegionRows queryId='query_refresh' region='EU' />);
		await waitFor(() => expect(screen.getByTestId('rows').textContent).toBe('1'));

		rerender(<RegionRows queryId='query_refresh' region='US' />);
		await waitFor(() => expect(host.requestQueryData).toHaveBeenCalledTimes(2));
		act(() => refetchRegion());
		await waitFor(() => expect(host.requestQueryData).toHaveBeenCalledTimes(3));

		rerender(<RegionRows queryId='query_refresh' region='EU' />);
		await waitFor(() => expect(screen.getByTestId('rows').textContent).toBe('1'));
		rerender(<RegionRows queryId='query_refresh' region='US' />);
		await waitFor(() => expect(screen.getByTestId('rows').textContent).toBe('1'));
		expect(host.requestQueryData).toHaveBeenCalledTimes(3);
		expect(host.requestQueryData.mock.calls.map(([, options]) => options.fresh)).toEqual([false, false, true]);
	});
});
