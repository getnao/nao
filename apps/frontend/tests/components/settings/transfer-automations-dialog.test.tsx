// @vitest-environment jsdom

import { QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { stubResizeObserver, stubScrollIntoView } from '../../helpers/browser-stubs';
import { createTestQueryClient } from '../../helpers/query-client';
import { deferred } from '../../helpers/deferred';
import { TransferAutomationsDialog } from '@/components/settings/transfer-automations-dialog';

const mocks = vi.hoisted(() => ({
	countOwnedByUser: vi.fn(),
	listTransferRecipients: vi.fn(),
	transferAllFromUser: vi.fn(),
}));

vi.mock('@/main', () => ({
	trpc: {
		project: {
			listTransferRecipients: {
				queryOptions: (input: { fromUserId: string }) => ({
					queryKey: ['project', 'listTransferRecipients', input.fromUserId],
					queryFn: () => mocks.listTransferRecipients(input),
				}),
			},
		},
		automation: {
			pathKey: () => ['automation'],
			countOwnedByUser: {
				queryOptions: (input: { userId: string }) => ({
					queryKey: ['automation', 'countOwnedByUser', input.userId],
					queryFn: () => mocks.countOwnedByUser(input),
				}),
			},
			transferAllFromUser: {
				mutationOptions: (options: object) => ({ mutationFn: mocks.transferAllFromUser, ...options }),
			},
		},
	},
}));

const member = { id: 'leaving-user', name: 'Alice', email: 'alice@example.com' };
const recipient = { id: 'new-owner', name: 'Bob', email: 'bob@example.com', hasTableAccess: true };
const recipientMissingTables = { id: 'narrow-owner', name: 'Carol', email: 'carol@example.com', hasTableAccess: false };

describe('TransferAutomationsDialog', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		stubResizeObserver();
		stubScrollIntoView();
		mocks.countOwnedByUser.mockResolvedValue({ count: 2 });
		mocks.listTransferRecipients.mockResolvedValue([recipient, recipientMissingTables]);
		mocks.transferAllFromUser.mockResolvedValue({ transferredCount: 2 });
	});

	afterEach(() => {
		cleanup();
		vi.unstubAllGlobals();
	});

	it('keeps the transfer disabled while the automations are being counted', async () => {
		mocks.countOwnedByUser.mockReturnValue(deferred().promise);
		renderDialog();

		expect(await screen.findByText('Counting their automations…')).toBeTruthy();
		await waitFor(() => expect(newOwnerSelect().hasAttribute('disabled')).toBe(false));
		chooseRecipient();
		expect(transferButton().hasAttribute('disabled')).toBe(true);
	});

	it('only offers to close when the member owns no automations', async () => {
		mocks.countOwnedByUser.mockResolvedValue({ count: 0 });
		renderDialog();

		expect(await screen.findByText('Alice owns no automations in this project.')).toBeTruthy();
		expect(screen.queryByRole('combobox', { name: 'New owner' })).toBeNull();
		expect(screen.queryByRole('button', { name: 'Transfer' })).toBeNull();
	});

	it("shows members missing some of the previous owner's tables as unavailable", async () => {
		renderDialog();
		expect(await screen.findByText(/Alice owns 2 automations/)).toBeTruthy();
		await waitFor(() => expect(newOwnerSelect().hasAttribute('disabled')).toBe(false));

		fireEvent.keyDown(newOwnerSelect(), { key: 'Enter' });

		const unavailable = screen.getByRole('option', { name: /Carol/ });
		expect(unavailable.getAttribute('aria-disabled')).toBe('true');
		expect(unavailable.textContent).toContain('Missing access to some tables');
		expect(screen.getByRole('option', { name: /Bob/ }).getAttribute('aria-disabled')).toBeNull();
	});

	it('explains why nobody can be chosen when no member has access to every table', async () => {
		mocks.listTransferRecipients.mockResolvedValue([recipientMissingTables]);
		renderDialog();

		expect(await screen.findByText(/No other member can access all the tables/)).toBeTruthy();
		expect(newOwnerSelect().hasAttribute('disabled')).toBe(true);
	});

	it('shows the error and stays open when the transfer fails', async () => {
		mocks.transferAllFromUser.mockRejectedValue(new Error('Bob cannot edit this project'));
		const { onOpenChange } = renderDialog();

		await transferToRecipient();

		expect((await screen.findByRole('alert')).textContent).toBe('Bob cannot edit this project');
		expect(onOpenChange).not.toHaveBeenCalled();
	});

	it('transfers the automations, refreshes them and closes', async () => {
		const { onOpenChange, invalidateQueries } = renderDialog();

		await transferToRecipient();

		await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
		expect(mocks.transferAllFromUser.mock.calls[0][0]).toEqual({
			fromUserId: 'leaving-user',
			recipientId: 'new-owner',
		});
		expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['automation'] });
	});
});

function renderDialog() {
	const queryClient = createTestQueryClient();
	const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries');
	const onOpenChange = vi.fn();
	render(
		<QueryClientProvider client={queryClient}>
			<TransferAutomationsDialog member={member} onOpenChange={onOpenChange} />
		</QueryClientProvider>,
	);
	return { onOpenChange, invalidateQueries };
}

async function transferToRecipient() {
	expect(await screen.findByText(/Alice owns 2 automations/)).toBeTruthy();
	await waitFor(() => expect(newOwnerSelect().hasAttribute('disabled')).toBe(false));
	chooseRecipient();
	fireEvent.click(transferButton());
}

function chooseRecipient() {
	fireEvent.keyDown(newOwnerSelect(), { key: 'Enter' });
	fireEvent.click(screen.getByRole('option', { name: /Bob/ }));
}

function newOwnerSelect() {
	return screen.getByRole('combobox', { name: 'New owner' });
}

function transferButton() {
	return screen.getByRole('button', { name: 'Transfer' });
}
