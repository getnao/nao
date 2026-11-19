// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { stubClipboard, stubScrollIntoView } from '../../helpers/browser-stubs';
import type { UserRole } from '@nao/shared/types';
import {
	ConditionalRulesHelp,
	DefaultProjectRole,
	UserGroupSemanticLayerMode,
} from '@/components/settings/user-group-editor';

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
	stubScrollIntoView();
	stubClipboard(writeText);
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

describe('UserGroupSemanticLayerMode', () => {
	it('selects an override and keeps the unavailable control visible but disabled', async () => {
		const onChange = vi.fn();
		const { rerender } = render(
			<UserGroupSemanticLayerMode
				value={null}
				projectMode='prioritized'
				isConfigured
				disabled={false}
				onChange={onChange}
			/>,
		);

		fireEvent.click(screen.getByRole('combobox', { name: 'Semantic layer' }));
		fireEvent.click(await screen.findByRole('option', { name: 'Semantics only' }));
		expect(onChange).toHaveBeenCalledWith('exclusive');

		rerender(
			<UserGroupSemanticLayerMode
				value={null}
				projectMode='prioritized'
				isConfigured={false}
				disabled
				onChange={onChange}
			/>,
		);
		expect(screen.getByRole('combobox', { name: 'Semantic layer' }).hasAttribute('disabled')).toBe(true);
		expect(screen.getByText('No semantic layer is configured for this project.')).toBeTruthy();
	});

	it('explains the All Users baseline and previews combined custom-group access', () => {
		const onChange = vi.fn();
		const { rerender } = render(
			<UserGroupSemanticLayerMode
				value={null}
				projectMode='disabled'
				isDefaultGroup
				isConfigured
				disabled={false}
				onChange={onChange}
			/>,
		);

		expect(screen.getByText(/Applies to everyone/)).toBeTruthy();
		expect(screen.getByText(/Keep Project default/)).toBeTruthy();

		rerender(
			<UserGroupSemanticLayerMode
				value='disabled'
				projectMode='disabled'
				allUsersMode='exclusive'
				isConfigured
				disabled={false}
				onChange={onChange}
			/>,
		);

		expect(screen.getByText(/Baseline for members of this group/).textContent).toContain('Semantics first');
		expect(screen.getByText(/Semantic queries:/).textContent).toContain(
			'Semantic queries: Allowed · Warehouse SQL: Allowed',
		);
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
