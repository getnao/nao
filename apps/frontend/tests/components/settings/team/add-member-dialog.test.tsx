// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { stubResizeObserver } from '../../../helpers/browser-stubs';
import { openDropdownMenu } from '../../../helpers/dropdown-menu';
import type { ComponentProps } from 'react';
import { AddMemberDialog } from '@/components/settings/team/add-member-dialog';

const groupOptions = [
	{ id: 'all-users', name: 'All Users', isDefault: true },
	{ id: 'analysts', name: 'Analysts', isDefault: false },
	{ id: 'finance', name: 'Finance', isDefault: false },
];

beforeEach(stubResizeObserver);

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
});

const added = (email: string) => ({ email, status: 'added' as const, name: 'Person' });

describe('AddMemberDialog groups', () => {
	it('shows available groups and submits selected non-default IDs', async () => {
		const onSubmit = vi.fn().mockResolvedValue([added('person@example.com')]);
		render(<AddMemberDialog open onOpenChange={vi.fn()} groupOptions={groupOptions} onSubmit={onSubmit} />);

		expect(screen.getByText('All Users is added automatically.')).toBeTruthy();
		openGroupPicker();
		expect(
			screen.getByRole('menuitemcheckbox', { name: 'All Users (automatic)' }).getAttribute('aria-disabled'),
		).toBe('true');
		fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'Analysts' }));
		closeGroupPicker();
		submitEmails('person@example.com');

		await waitFor(() =>
			expect(onSubmit).toHaveBeenCalledWith({
				members: [{ email: 'person@example.com' }],
				groupIds: ['analysts'],
			}),
		);
	});

	it('removes a selected group from its token without submitting', async () => {
		const onSubmit = vi.fn().mockResolvedValue([added('person@example.com')]);
		render(<AddMemberDialog open onOpenChange={vi.fn()} groupOptions={groupOptions} onSubmit={onSubmit} />);

		openGroupPicker();
		fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'Analysts' }));
		fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'Finance' }));
		closeGroupPicker();
		expect(screen.queryByRole('button', { name: 'Remove group All Users' })).toBeNull();
		fireEvent.click(screen.getByRole('button', { name: 'Remove group Analysts' }));
		expect(onSubmit).not.toHaveBeenCalled();

		submitEmails('person@example.com');

		await waitFor(() =>
			expect(onSubmit).toHaveBeenCalledWith({
				members: [{ email: 'person@example.com' }],
				groupIds: ['finance'],
			}),
		);
	});

	it('resets selected groups when closed and reopened', () => {
		render(<DialogHarness onSubmit={vi.fn()} />);

		pickGroup('Analysts');
		fireEvent.click(screen.getByRole('button', { name: 'Close' }));
		fireEvent.click(screen.getByRole('button', { name: 'Open dialog' }));
		openGroupPicker();

		expect(screen.getByRole('menuitemcheckbox', { name: 'Analysts' }).getAttribute('aria-checked')).toBe('false');
	});

	it('closes and resets after existing accounts are added', async () => {
		render(<DialogHarness onSubmit={vi.fn().mockResolvedValue([added('person@example.com')])} />);

		pickGroup('Analysts');
		submitEmails('person@example.com');
		await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

		fireEvent.click(screen.getByRole('button', { name: 'Open dialog' }));
		openGroupPicker();
		expect(screen.getByRole('menuitemcheckbox', { name: 'Analysts' }).getAttribute('aria-checked')).toBe('false');
	});

	it('keeps organization-style usage without group options', async () => {
		const onSubmit = vi.fn().mockResolvedValue([added('member@example.com')]);
		render(<AddMemberDialog open onOpenChange={vi.fn()} onSubmit={onSubmit} />);

		expect(screen.queryByText('Groups')).toBeNull();
		expect(screen.queryByRole('button', { name: /Select user groups/ })).toBeNull();
		submitEmails('member@example.com');

		await waitFor(() => expect(onSubmit).toHaveBeenCalledWith({ members: [{ email: 'member@example.com' }] }));
	});

	it('blocks project submission and retries when groups fail to load', () => {
		const onSubmit = vi.fn();
		const onRetryGroups = vi.fn();
		render(
			<AddMemberDialog
				open
				onOpenChange={vi.fn()}
				groupOptions={[]}
				groupsError
				onRetryGroups={onRetryGroups}
				onSubmit={onSubmit}
			/>,
		);

		expect(screen.getByText('Failed to load groups.')).toBeTruthy();
		fireEvent.change(screen.getByLabelText('Emails'), { target: { value: 'person@example.com' } });
		const submit = screen.getByRole('button', { name: 'Add member' }) as HTMLButtonElement;
		expect(submit.disabled).toBe(true);
		fireEvent.click(submit);
		expect(onSubmit).not.toHaveBeenCalled();

		fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
		expect(onRetryGroups).toHaveBeenCalledOnce();
	});
});

describe('AddMemberDialog bulk add', () => {
	it('turns pasted text into unique email chips', async () => {
		const onSubmit = vi.fn().mockResolvedValue([]);
		render(<AddMemberDialog open onOpenChange={vi.fn()} onSubmit={onSubmit} />);

		fireEvent.paste(screen.getByLabelText('Emails'), {
			clipboardData: { getData: () => 'Jane Doe <Jane@acme.com>; marc@acme.com\njane@acme.com' },
		});

		expect(screen.getByRole('button', { name: 'Remove jane@acme.com' })).toBeTruthy();
		expect(screen.getByRole('button', { name: 'Remove marc@acme.com' })).toBeTruthy();
		fireEvent.click(screen.getByRole('button', { name: 'Add 2 members' }));

		await waitFor(() =>
			expect(onSubmit).toHaveBeenCalledWith({
				members: [{ email: 'jane@acme.com' }, { email: 'marc@acme.com' }],
			}),
		);
	});

	it('keeps apostrophes and typos visible instead of dropping them', () => {
		render(<AddMemberDialog open onOpenChange={vi.fn()} onSubmit={vi.fn()} />);

		fireEvent.paste(screen.getByLabelText('Emails'), {
			clipboardData: { getData: () => "o'connor@acme.com bob.acme.com, 'quoted@acme.com'" },
		});

		expect(screen.getByRole('button', { name: "Remove o'connor@acme.com" })).toBeTruthy();
		expect(screen.getByRole('button', { name: 'Remove bob.acme.com' })).toBeTruthy();
		expect(screen.getByRole('button', { name: 'Remove quoted@acme.com' })).toBeTruthy();
		fireEvent.click(screen.getByRole('button', { name: 'Add 3 members' }));
		expect(screen.getByText('Fix or remove invalid emails: bob.acme.com')).toBeTruthy();
	});

	it('keeps plain addresses next to display-name addresses', () => {
		render(<AddMemberDialog open onOpenChange={vi.fn()} onSubmit={vi.fn()} />);

		fireEvent.paste(screen.getByLabelText('Emails'), {
			clipboardData: { getData: () => 'alice@acme.com Bob <bob@acme.com>' },
		});

		expect(screen.getByRole('button', { name: 'Remove alice@acme.com' })).toBeTruthy();
		expect(screen.getByRole('button', { name: 'Remove bob@acme.com' })).toBeTruthy();
		expect(screen.queryByRole('button', { name: 'Remove bob' })).toBeNull();
	});

	it('ignores a quoted display name that looks like an address', () => {
		render(<AddMemberDialog open onOpenChange={vi.fn()} onSubmit={vi.fn()} />);

		fireEvent.paste(screen.getByLabelText('Emails'), {
			clipboardData: { getData: () => '"alice@old.com" <alice@new.com>, "bob@acme.com"' },
		});

		expect(screen.getByRole('button', { name: 'Remove alice@new.com' })).toBeTruthy();
		expect(screen.queryByRole('button', { name: 'Remove alice@old.com' })).toBeNull();
		expect(screen.getByRole('button', { name: 'Remove bob@acme.com' })).toBeTruthy();
	});

	it('keeps a typed display name together until its address is complete', () => {
		render(<AddMemberDialog open onOpenChange={vi.fn()} onSubmit={vi.fn()} />);
		const input = screen.getByLabelText('Emails');

		for (const text of ['Jane ', 'Jane Doe ', 'Jane Doe <jane@acme.com>', 'Jane Doe <jane@acme.com>,']) {
			fireEvent.change(input, { target: { value: text } });
		}

		expect(screen.getByRole('button', { name: 'Remove jane@acme.com' })).toBeTruthy();
		expect(screen.queryByRole('button', { name: 'Remove jane' })).toBeNull();
		expect(screen.queryByRole('button', { name: 'Remove doe' })).toBeNull();
	});

	it('disables submit and skip while accounts are being created', async () => {
		const onSubmit = vi
			.fn()
			.mockResolvedValueOnce([{ email: 'new@acme.com', status: 'needsName' }])
			.mockReturnValueOnce(new Promise(() => {}));
		render(<AddMemberDialog open onOpenChange={vi.fn()} onSubmit={onSubmit} />);

		submitEmails('new@acme.com');
		fireEvent.click(await screen.findByRole('button', { name: 'Create account' }));

		await waitFor(() =>
			expect((screen.getByRole('button', { name: 'Create account' }) as HTMLButtonElement).disabled).toBe(true),
		);
		expect((screen.getByRole('button', { name: 'Skip new@acme.com' }) as HTMLButtonElement).disabled).toBe(true);
	});

	it('refuses to submit while an email is invalid', () => {
		const onSubmit = vi.fn();
		render(<AddMemberDialog open onOpenChange={vi.fn()} onSubmit={onSubmit} />);

		submitEmails('ok@acme.com paul@acme', 'Add 2 members');

		expect(screen.getByText('Fix or remove invalid emails: paul@acme')).toBeTruthy();
		expect(onSubmit).not.toHaveBeenCalled();
	});

	it('asks names for new accounts only, then shows passwords and other results', async () => {
		const onSubmit = vi
			.fn()
			.mockResolvedValueOnce([
				added('existing@acme.com'),
				{ email: 'jane.doe@acme.com', status: 'needsName' },
				{ email: 'member@acme.com', status: 'alreadyMember' },
			])
			.mockResolvedValueOnce([
				{ email: 'jane.doe@acme.com', status: 'added', name: 'Jane D', password: 'temp-pass' },
			]);
		render(<AddMemberDialog open onOpenChange={vi.fn()} groupOptions={groupOptions} onSubmit={onSubmit} />);

		pickGroup('Finance');
		submitEmails('existing@acme.com, jane.doe@acme.com, member@acme.com', 'Add 3 members');

		const nameInput = (await screen.findByLabelText('Name for jane.doe@acme.com')) as HTMLInputElement;
		expect(nameInput.value).toBe('Jane Doe');
		fireEvent.change(nameInput, { target: { value: 'Jane D' } });
		fireEvent.click(screen.getByRole('button', { name: 'Create account' }));

		expect(await screen.findByText('temp-pass')).toBeTruthy();
		expect(onSubmit).toHaveBeenNthCalledWith(2, {
			members: [{ email: 'jane.doe@acme.com', name: 'Jane D' }],
			groupIds: ['finance'],
		});
		expect(screen.getByText('2 members added')).toBeTruthy();
		expect(screen.getByText('Already a member')).toBeTruthy();
	});

	it('closes when every new account is skipped and the rest were added', async () => {
		const onOpenChange = vi.fn();
		const onSubmit = vi
			.fn()
			.mockResolvedValue([added('existing@acme.com'), { email: 'new@acme.com', status: 'needsName' }]);
		render(<AddMemberDialog open onOpenChange={onOpenChange} onSubmit={onSubmit} />);

		submitEmails('existing@acme.com new@acme.com', 'Add 2 members');
		fireEvent.click(await screen.findByRole('button', { name: 'Skip new@acme.com' }));

		expect(onOpenChange).toHaveBeenCalledWith(false);
		expect(onSubmit).toHaveBeenCalledOnce();
	});
});

function DialogHarness({ onSubmit }: { onSubmit: ComponentProps<typeof AddMemberDialog>['onSubmit'] }) {
	const [open, setOpen] = useState(true);
	return (
		<>
			<button onClick={() => setOpen(true)}>Open dialog</button>
			<AddMemberDialog open={open} onOpenChange={setOpen} groupOptions={groupOptions} onSubmit={onSubmit} />
		</>
	);
}

function pickGroup(name: string) {
	openGroupPicker();
	fireEvent.click(screen.getByRole('menuitemcheckbox', { name }));
	closeGroupPicker();
}

function openGroupPicker() {
	openDropdownMenu(/Select user groups/);
}

function closeGroupPicker() {
	fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
}

function submitEmails(text: string, submitLabel = 'Add member') {
	fireEvent.change(screen.getByLabelText('Emails'), { target: { value: text } });
	fireEvent.click(screen.getByRole('button', { name: submitLabel }));
}
