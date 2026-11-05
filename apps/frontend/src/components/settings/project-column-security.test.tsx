// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { ProjectColumnSecurity } from './project-column-security';

const mutate = vi.fn();

vi.mock('@/hooks/use-license', () => ({
	useLicenseFeatures: () => ({ data: { 'row-level-security': true } }),
}));
vi.mock('@/main', () => ({
	trpc: {
		userGroup: {
			columnSecurity: {
				queryKey: () => ['column-security'],
				queryOptions: () => ({ queryKey: ['column-security'] }),
			},
			updateColumnSecurity: {
				mutationOptions: (options: unknown) => options,
			},
		},
	},
}));
vi.mock('@tanstack/react-query', () => ({
	useMutation: () => ({ mutate, isPending: false, error: null }),
	useQuery: () => ({ data: { version: 1, tables: [] }, isLoading: false, isError: false }),
	useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));

beforeEach(() => {
	mutate.mockReset();
});

afterEach(cleanup);

it('saves a newly hidden column without hiding other columns', () => {
	render(
		<ProjectColumnSecurity
			objects={[
				{
					databaseType: 'postgres',
					database: 'analytics',
					schema: 'public',
					table: 'users',
					columns: ['email', 'id'],
				},
			]}
		/>,
	);

	fireEvent.click(screen.getAllByRole('button', { name: 'Mark sensitive fields' })[0]);
	fireEvent.click(screen.getByRole('button', { name: 'Expand analytics database' }));
	fireEvent.click(screen.getByRole('button', { name: 'Expand public schema' }));
	fireEvent.click(screen.getByRole('button', { name: 'Expand users table columns' }));
	fireEvent.click(screen.getByRole('checkbox', { name: 'Hide email on users' }));
	fireEvent.click(screen.getByRole('button', { name: 'Save' }));
	expect(mutate).toHaveBeenCalledWith(
		{
			version: 1,
			tables: [
				{
					databaseType: 'postgres',
					database: 'analytics',
					schema: 'public',
					table: 'users',
					restrictedColumns: ['email'],
				},
			],
		},
		expect.objectContaining({ onSuccess: expect.any(Function) }),
	);
});
