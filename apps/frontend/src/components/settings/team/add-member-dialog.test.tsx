// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AddMemberDialog } from './add-member-dialog';

const groupOptions = [
	{ id: 'all-users', name: 'All Users', isDefault: true },
	{ id: 'analysts', name: 'Analysts', isDefault: false },
	{ id: 'finance', name: 'Finance', isDefault: false },
];

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

describe('AddMemberDialog groups', () => {
	it('shows available groups and submits selected non-default IDs', async () => {
		const onSubmit = vi.fn().mockResolvedValue({});
		render(<AddMemberDialog open onOpenChange={vi.fn()} groupOptions={groupOptions} onSubmit={onSubmit} />);

		expect(screen.getByText('All Users is added automatically.')).toBeTruthy();
		openGroupPicker();
		expect(
			screen.getByRole('menuitemcheckbox', { name: 'All Users (automatic)' }).getAttribute('aria-disabled'),
		).toBe('true');
		fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'Analysts' }));
		closeGroupPicker();
		fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'person@example.com' } });
		fireEvent.click(screen.getByRole('button', { name: 'Add member' }));

		await waitFor(() =>
			expect(onSubmit).toHaveBeenCalledWith({
				email: 'person@example.com',
				name: undefined,
				groupIds: ['analysts'],
			}),
		);
	});

	it('keeps selected groups through the missing-name retry', async () => {
		const onSubmit = vi.fn().mockResolvedValueOnce({ needsName: true }).mockResolvedValueOnce({});
		render(<AddMemberDialog open onOpenChange={vi.fn()} groupOptions={groupOptions} onSubmit={onSubmit} />);

		openGroupPicker();
		fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'Finance' }));
		closeGroupPicker();
		fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'new@example.com' } });
		fireEvent.click(screen.getByRole('button', { name: 'Add member' }));
		await screen.findByLabelText('Name');

		fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'New User' } });
		fireEvent.click(screen.getByRole('button', { name: 'Add member' }));

		await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(2));
		expect(onSubmit).toHaveBeenNthCalledWith(2, {
			email: 'new@example.com',
			name: 'New User',
			groupIds: ['finance'],
		});
	});

	it('resets selected groups when closed and reopened', () => {
		render(<DialogHarness onSubmit={vi.fn().mockResolvedValue({})} />);

		openGroupPicker();
		fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'Analysts' }));
		closeGroupPicker();
		fireEvent.click(screen.getByRole('button', { name: 'Close' }));
		fireEvent.click(screen.getByRole('button', { name: 'Open dialog' }));
		openGroupPicker();

		expect(screen.getByRole('menuitemcheckbox', { name: 'Analysts' }).getAttribute('aria-checked')).toBe('false');
	});

	it('resets selected groups after a successful submit', async () => {
		const onSubmit = vi.fn().mockResolvedValue({});
		render(<DialogHarness onSubmit={onSubmit} />);

		openGroupPicker();
		fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'Analysts' }));
		closeGroupPicker();
		fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'person@example.com' } });
		fireEvent.click(screen.getByRole('button', { name: 'Add member' }));
		await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

		fireEvent.click(screen.getByRole('button', { name: 'Open dialog' }));
		openGroupPicker();
		expect(screen.getByRole('menuitemcheckbox', { name: 'Analysts' }).getAttribute('aria-checked')).toBe('false');
	});

	it('keeps organization-style usage unchanged without group options', async () => {
		const onSubmit = vi.fn().mockResolvedValue({});
		render(<AddMemberDialog open onOpenChange={vi.fn()} onSubmit={onSubmit} />);

		expect(screen.queryByText('Groups')).toBeNull();
		expect(screen.queryByRole('button', { name: /Select user groups/ })).toBeNull();
		fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'member@example.com' } });
		fireEvent.click(screen.getByRole('button', { name: 'Add member' }));

		await waitFor(() =>
			expect(onSubmit).toHaveBeenCalledWith({
				email: 'member@example.com',
				name: undefined,
			}),
		);
	});
});

function DialogHarness({ onSubmit }: { onSubmit: () => Promise<Record<string, never>> }) {
	const [open, setOpen] = useState(true);
	return (
		<>
			<button onClick={() => setOpen(true)}>Open dialog</button>
			<AddMemberDialog open={open} onOpenChange={setOpen} groupOptions={groupOptions} onSubmit={onSubmit} />
		</>
	);
}

function openGroupPicker() {
	fireEvent.pointerDown(screen.getByRole('button', { name: /Select user groups/ }), {
		button: 0,
		ctrlKey: false,
	});
}

function closeGroupPicker() {
	fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
}
