// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';

import { TeamMembersList } from './team-members-list';
import type { TeamMember } from './types';

const DAY_MS = 24 * 60 * 60 * 1000;

afterEach(cleanup);

it('shows the two-factor authentication state of each member', () => {
	const dueDate = new Date(Date.now() + 3 * DAY_MS);
	render(
		<TeamMembersList
			isAdmin={false}
			members={[
				member({ id: 'enrolled', twoFactorEnabled: true }),
				member({ id: 'due', twoFactorDeadline: dueDate }),
				member({ id: 'overdue', twoFactorDeadline: new Date(Date.now() - DAY_MS) }),
				member({ id: 'not-required', twoFactorDeadline: null }),
			]}
		/>,
	);

	expect(screen.getByText('2FA')).toBeTruthy();
	expect(screen.getByText(/^2FA due /)).toBeTruthy();
	expect(screen.getByText('2FA overdue')).toBeTruthy();
	expect(screen.getAllByText(/2FA/)).toHaveLength(3);
});

function member(overrides: Partial<TeamMember> & { id: string }): TeamMember {
	return {
		name: overrides.id,
		email: `${overrides.id}@example.com`,
		role: 'user',
		status: 'active',
		...overrides,
	};
}
