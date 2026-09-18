// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ConditionalRulesHelp, DefaultProjectRole } from './user-group-editor';
import type { UserRole } from '@nao/shared/types';

const writeText = vi.fn();

vi.mock('@/main', () => ({
	trpc: {
		contextExplorer: {
			readFile: {
				queryOptions: () => ({
					queryKey: ['context-explorer', 'rules'],
					queryFn: async () => null,
				}),
			},
		},
	},
}));
vi.mock('@tanstack/react-query', () => ({
	useMutation: vi.fn(),
	useQuery: () => ({ data: null }),
	useQueryClient: vi.fn(),
}));

beforeEach(() => {
	writeText.mockReset();
	HTMLElement.prototype.scrollIntoView = vi.fn();
	Object.defineProperty(navigator, 'clipboard', {
		configurable: true,
		value: { writeText },
	});
});

afterEach(cleanup);

describe('ConditionalRulesHelp', () => {
	it('shows and copies an exactly escaped group snippet with a File Explorer link', async () => {
		const expected = '{% if group("Finance \\"North\\" \\\\ Ops") %}\nGroup-specific instructions...\n{% endif %}';
		const { container } = render(<ConditionalRulesHelp groupName={'Finance "North" \\ Ops'} />);

		expect(container.querySelector('code')?.textContent).toBe(expected);

		fireEvent.click(screen.getByRole('button', { name: 'Copy conditional rules snippet' }));
		await waitFor(() => expect(writeText).toHaveBeenCalledWith(expected));
	});

	it('does not produce an invalid snippet for a blank new-group name', () => {
		const { container, rerender } = render(<ConditionalRulesHelp groupName=' ' />);

		expect(screen.getByText('Enter a group name to generate a snippet.')).toBeTruthy();
		expect(screen.queryByRole('button', { name: 'Copy conditional rules snippet' })).toBeNull();

		rerender(<ConditionalRulesHelp groupName='Finance' />);
		expect(container.querySelector('code')?.textContent).toBe(
			'{% if group("Finance") %}\nGroup-specific instructions...\n{% endif %}',
		);
	});
});

describe('DefaultProjectRole', () => {
	it('explains, orders, selects, and resets the default project role', async () => {
		render(<DefaultProjectRoleHarness />);

		expect(screen.getByText('Will assign this project role to users signing up with SSO')).toBeTruthy();
		expect(screen.getByText('Use organization role')).toBeTruthy();

		fireEvent.click(screen.getByRole('combobox', { name: 'Default project role' }));
		expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual([
			'Use organization role',
			'User',
			'Viewer',
			'Context Admin',
			'Admin',
		]);
		fireEvent.click(await screen.findByRole('option', { name: 'Context Admin' }));
		expect(screen.getByText('Context Admin')).toBeTruthy();

		fireEvent.click(screen.getByRole('button', { name: 'Reset role' }));
		expect(screen.getByText('Use organization role')).toBeTruthy();
	});
});

function DefaultProjectRoleHarness() {
	const [role, setRole] = useState<UserRole | null>(null);
	return (
		<>
			<DefaultProjectRole value={role} onChange={setRole} />
			<button type='button' onClick={() => setRole(null)}>
				Reset role
			</button>
		</>
	);
}
