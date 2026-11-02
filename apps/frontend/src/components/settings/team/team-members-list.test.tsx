// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { TeamMembersList } from './team-members-list';

import type { TeamMember } from './types';

beforeEach(() => {
	vi.stubGlobal(
		'ResizeObserver',
		vi.fn(() => ({
			observe: vi.fn(),
			disconnect: vi.fn(),
		})),
	);
});

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
});

it('edits seat access for organization and project-only users while locking admins', () => {
	const onAccessChange = vi.fn();
	render(
		<TeamMembersList
			members={[
				{
					id: 'admin-1',
					name: 'Admin',
					email: 'admin@example.com',
					role: 'admin',
					status: 'active',
					membershipSource: 'organization',
				},
				{
					id: 'member-1',
					name: 'Member',
					email: 'member@example.com',
					role: 'user',
					status: 'active',
					membershipSource: 'organization',
				},
				{
					id: 'project-1',
					name: 'Project User',
					email: 'project@example.com',
					role: 'user',
					status: 'active',
					membershipSource: 'project',
				},
			]}
			isAdmin
			accessByUserId={{
				'admin-1': 'seated',
				'member-1': 'read-only',
				'project-1': 'seated',
			}}
			accessDisabledByUserId={{ 'admin-1': true }}
			accessSummary='2/3'
			onAccessChange={onAccessChange}
		/>,
	);

	expect(screen.getByRole('table').classList.contains('table-fixed')).toBe(true);
	expect(screen.getByText('2/3')).toBeTruthy();
	expect(screen.queryByRole('checkbox')).toBeNull();
	expect(screen.getByText('Project only')).toBeTruthy();

	openActions('Member');
	fireEvent.click(screen.getByRole('menuitem', { name: 'Assign seat' }));
	expect(onAccessChange).toHaveBeenCalledWith(expect.objectContaining({ id: 'member-1' }), 'seated');

	openActions('Project User');
	fireEvent.click(screen.getByRole('menuitem', { name: 'Make read-only' }));
	expect(onAccessChange).toHaveBeenCalledWith(expect.objectContaining({ id: 'project-1' }), 'read-only');
});

it('keeps row order independent of seat assignment order', () => {
	const alice = member('alice', 'Alice');
	const bob = member('bob', 'Bob');
	const { rerender } = render(
		<TeamMembersList
			members={[bob, alice]}
			isAdmin={false}
			accessByUserId={{ alice: 'read-only', bob: 'seated' }}
		/>,
	);

	expect(memberNames()).toEqual(['Alice', 'Bob']);

	rerender(
		<TeamMembersList
			members={[alice, bob]}
			isAdmin={false}
			accessByUserId={{ alice: 'seated', bob: 'read-only' }}
		/>,
	);

	expect(memberNames()).toEqual(['Alice', 'Bob']);
});

it('keeps the access action button in place while an assignment is pending', () => {
	render(
		<TeamMembersList
			members={[member('member-1', 'Member')]}
			isAdmin
			accessByUserId={{ 'member-1': 'seated' }}
			accessChangesDisabled
			onAccessChange={vi.fn()}
		/>,
	);

	expect(screen.getByRole('button', { name: 'Actions for Member' })).toHaveProperty('disabled', true);
});

function openActions(name: string) {
	fireEvent.pointerDown(screen.getByRole('button', { name: `Actions for ${name}` }), {
		button: 0,
		ctrlKey: false,
	});
}

function member(id: string, name: string): TeamMember {
	return {
		id,
		name,
		email: `${id}@example.com`,
		role: 'user',
		status: 'active',
		membershipSource: 'organization',
	};
}

function memberNames(): string[] {
	return screen
		.getAllByRole('row')
		.slice(1)
		.map((row) => row.children[0]?.textContent ?? '');
}
