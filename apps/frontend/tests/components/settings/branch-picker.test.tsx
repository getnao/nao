// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { stubResizeObserver, stubScrollIntoView } from '../../helpers/browser-stubs';
import type { RepoBranchList } from '@nao/shared/types';

import { BranchPicker } from '@/components/settings/branch-picker';

const BRANCHES: RepoBranchList = {
	branches: [
		{
			name: 'alice/orders',
			commit: 'a',
			author: { name: 'Alice', login: 'alice' },
			committedAt: null,
			isMine: false,
		},
		{ name: 'mine/revenue', commit: 'b', author: { name: 'Me', login: 'me' }, committedAt: null, isMine: true },
		{ name: 'main', commit: 'c', author: { name: 'Bob', login: 'bob' }, committedAt: null, isMine: false },
	],
	canFilterMine: true,
};

describe('BranchPicker', () => {
	beforeEach(() => {
		stubResizeObserver();
		stubScrollIntoView();
	});

	afterEach(cleanup);

	it('shows the pinned branch first with its label, and the user as the author of their branches', () => {
		renderPicker(BRANCHES);

		const options = screen.getAllByRole('option');
		expect(options[0].textContent).toContain('main');
		expect(options[0].textContent).toContain('production');
		expect(screen.getByRole('option', { name: /mine\/revenue/ }).textContent).toContain('You');
	});

	it('narrows the branches to those of the user', () => {
		renderPicker(BRANCHES);

		fireEvent.click(screen.getByRole('button', { name: 'Mine' }));

		expect(screen.getAllByRole('option').map((option) => option.getAttribute('data-value'))).toEqual([
			'mine/revenue',
		]);
	});

	it('cannot narrow to the branches of the user when the git provider does not tell them', () => {
		renderPicker({ ...BRANCHES, canFilterMine: false });

		expect(screen.getByRole('button', { name: 'Mine' }).hasAttribute('disabled')).toBe(true);
	});

	it('picks the branch clicked', () => {
		const onSelect = vi.fn();
		renderPicker(BRANCHES, onSelect);

		fireEvent.click(screen.getByRole('option', { name: /alice\/orders/ }));

		expect(onSelect).toHaveBeenCalledWith('alice/orders');
	});
});

function renderPicker(branches: RepoBranchList, onSelect = vi.fn()) {
	render(
		<BranchPicker
			branches={branches}
			isLoading={false}
			error={null}
			selectedBranch={null}
			pinnedBranch={{ name: 'main', label: 'production' }}
			onRetry={vi.fn()}
			onSelect={onSelect}
		/>,
	);
}
