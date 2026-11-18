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
	transferAllFromUser: vi.fn(),
}));

vi.mock('@/main', () => ({
	trpc: {
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
const recipient = { id: 'new-owner', name: 'Bob', email: 'bob@example.com' };

describe('TransferAutomationsDialog', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		stubResizeObserver();
		stubScrollIntoView();
		mocks.countOwnedByUser.mockResolvedValue({ count: 2 });
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
			<TransferAutomationsDialog member={member} recipients={[recipient]} onOpenChange={onOpenChange} />
		</QueryClientProvider>,
	);
	return { onOpenChange, invalidateQueries };
}

async function transferToRecipient() {
	expect(await screen.findByText(/Alice owns 2 automations/)).toBeTruthy();
	chooseRecipient();
	fireEvent.click(transferButton());
}

function chooseRecipient() {
	fireEvent.keyDown(screen.getByRole('combobox', { name: 'New owner' }), { key: 'Enter' });
	fireEvent.click(screen.getByRole('option', { name: /Bob/ }));
}

function transferButton() {
	return screen.getByRole('button', { name: 'Transfer' });
}
