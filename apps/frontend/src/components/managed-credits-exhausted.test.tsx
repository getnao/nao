// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, expect, it, vi } from 'vitest';

import { ManagedCreditsExhausted } from './managed-credits-exhausted';
import type { MouseEventHandler, ReactNode } from 'react';

const mocks = vi.hoisted(() => ({
	openBilling: vi.fn(async () => undefined),
	invalidateQueries: vi.fn(async () => undefined),
	navigate: vi.fn(async () => undefined),
	setActiveOrganizationId: vi.fn(),
}));

vi.mock('@tanstack/react-router', () => ({
	Link: ({
		children,
		to,
		onClick,
	}: {
		children: ReactNode;
		to: string;
		onClick?: MouseEventHandler<HTMLAnchorElement>;
	}) => (
		<a href={to} onClick={onClick}>
			{children}
		</a>
	),
	useNavigate: () => mocks.navigate,
}));

vi.mock('@tanstack/react-query', () => ({
	useQueryClient: () => ({ invalidateQueries: mocks.invalidateQueries }),
}));

vi.mock('@/hooks/use-open-organization-billing', () => ({
	useOpenOrganizationBilling: () => mocks.openBilling,
}));

vi.mock('@/lib/active-organization', () => ({
	setActiveOrganizationId: mocks.setActiveOrganizationId,
}));

afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});

it('shows both recovery actions to an organization and project admin', async () => {
	render(
		<ManagedCreditsExhausted
			open
			onOpenChange={vi.fn()}
			canAddProviderKey
			creditOrganizationId='organization-id'
		/>,
	);

	expect(screen.getByRole('dialog')).toBeTruthy();
	expect(screen.queryByRole('button', { name: 'Close' })).toBeNull();
	expect(screen.getByRole('button', { name: 'Buy nao credits' })).toBeTruthy();
	expect(screen.getByRole('link', { name: 'Use your own AI provider' })).toBeTruthy();
	expect(screen.getByRole('link', { name: 'invite users' }).getAttribute('href')).toBe(
		'/settings/organization/members',
	);

	fireEvent.click(screen.getByRole('link', { name: 'invite users' }));
	await waitFor(() => expect(mocks.navigate).toHaveBeenCalledWith({ to: '/settings/organization/members' }));
	expect(mocks.setActiveOrganizationId).toHaveBeenCalledWith('organization-id');
	expect(mocks.invalidateQueries).toHaveBeenCalledOnce();
	expect(mocks.setActiveOrganizationId.mock.invocationCallOrder[0]).toBeLessThan(
		mocks.navigate.mock.invocationCallOrder[0],
	);

	fireEvent.click(screen.getByRole('button', { name: 'Buy nao credits' }));
	expect(mocks.openBilling).toHaveBeenCalledWith('organization-id');
});

it('shows only the action each admin is authorized to use', () => {
	const view = render(
		<ManagedCreditsExhausted
			open
			onOpenChange={vi.fn()}
			canAddProviderKey={false}
			creditOrganizationId='organization-id'
		/>,
	);

	expect(screen.getByRole('button', { name: 'Buy nao credits' })).toBeTruthy();
	expect(screen.queryByRole('link', { name: 'Use your own AI provider' })).toBeNull();

	view.rerender(
		<ManagedCreditsExhausted open onOpenChange={vi.fn()} canAddProviderKey creditOrganizationId={undefined} />,
	);
	expect(screen.queryByRole('button', { name: 'Buy nao credits' })).toBeNull();
	expect(screen.getByRole('link', { name: 'Use your own AI provider' })).toBeTruthy();
	expect(screen.queryByRole('link', { name: 'invite users' })).toBeNull();
});

it('directs members to their organization admin without management actions', () => {
	render(
		<ManagedCreditsExhausted
			open
			onOpenChange={vi.fn()}
			canAddProviderKey={false}
			creditOrganizationId={undefined}
		/>,
	);

	expect(screen.getByText(/Ask your organization admin/)).toBeTruthy();
	expect(screen.queryByRole('button', { name: 'Buy nao credits' })).toBeNull();
	expect(screen.queryByRole('link', { name: 'Use your own AI provider' })).toBeNull();
	expect(screen.queryByRole('link', { name: 'invite users' })).toBeNull();
	expect(screen.getByRole('button', { name: 'Got it' })).toBeTruthy();
});

it('lets a member dismiss the popup', () => {
	function ControlledManagedCreditsExhausted() {
		const [open, setOpen] = useState(true);
		return (
			<ManagedCreditsExhausted
				open={open}
				onOpenChange={setOpen}
				canAddProviderKey={false}
				creditOrganizationId={undefined}
			/>
		);
	}

	render(<ControlledManagedCreditsExhausted />);
	fireEvent.click(screen.getByRole('button', { name: 'Got it' }));

	expect(screen.queryByRole('dialog')).toBeNull();
});
