// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, expect, it, vi } from 'vitest';

import { ManagedCreditsExhausted } from './managed-credits-exhausted';
import type { ReactNode } from 'react';

const mocks = vi.hoisted(() => ({
	openBilling: vi.fn(async () => undefined),
}));

vi.mock('@tanstack/react-router', () => ({
	Link: ({ children }: { children: ReactNode }) => <a href='/settings/project/agent'>{children}</a>,
}));

vi.mock('@/hooks/use-open-organization-billing', () => ({
	useOpenOrganizationBilling: () => mocks.openBilling,
}));

afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});

it('shows both recovery actions to an organization and project admin', () => {
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
