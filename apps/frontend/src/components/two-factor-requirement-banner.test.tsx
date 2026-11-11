// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { TwoFactorRequirementBanner } from './two-factor-requirement-banner';

const DAY_MS = 24 * 60 * 60 * 1000;

const mocks = vi.hoisted(() => ({
	navigate: vi.fn(),
	pathname: '/',
	requirement: null as { deadline: Date; isOverdue: boolean } | null,
}));

vi.mock('@tanstack/react-router', () => ({
	useNavigate: () => mocks.navigate,
	useRouterState: ({ select }: { select: (state: { location: { pathname: string } }) => unknown }) => {
		return select({ location: { pathname: mocks.pathname } });
	},
}));

vi.mock('@/hooks/use-two-factor-requirement', () => ({
	useTwoFactorRequirement: () => ({ requirement: mocks.requirement }),
}));

beforeEach(() => {
	mocks.navigate.mockClear();
	mocks.pathname = '/';
	mocks.requirement = { deadline: new Date(Date.now() + 3 * DAY_MS), isOverdue: false };
});

afterEach(cleanup);

it('asks the user to set up two-factor authentication before the deadline', () => {
	render(<TwoFactorRequirementBanner />);

	expect(screen.getByText('Your organization requires two-factor authentication.')).toBeTruthy();
	fireEvent.click(screen.getByRole('button', { name: 'Set up' }));
	expect(mocks.navigate).toHaveBeenCalledWith({ to: '/settings/account' });
});

it.each([
	['nothing is required', () => (mocks.requirement = null)],
	['the deadline has passed', () => (mocks.requirement = { deadline: new Date(), isOverdue: true })],
	['the user is already on the account page', () => (mocks.pathname = '/settings/account')],
])('stays hidden when %s', (_case, arrange) => {
	arrange();

	const { container } = render(<TwoFactorRequirementBanner />);

	expect(container.textContent).toBe('');
});
