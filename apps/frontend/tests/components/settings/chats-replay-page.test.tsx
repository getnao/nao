// @vitest-environment jsdom

import { QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestQueryClient } from '../../helpers/query-client';
import { ChatsReplayPage } from '@/components/settings/chats-replay-page';

const mocks = vi.hoisted(() => ({
	queryOptions: vi.fn(),
}));

vi.mock('@/main', () => ({
	trpc: {
		project: {
			getProjectChats: {
				queryOptions: mocks.queryOptions,
			},
		},
	},
}));

describe('ChatsReplayPage', () => {
	beforeEach(() => {
		mocks.queryOptions.mockImplementation((input) => ({
			queryKey: ['project-chats', input],
			queryFn: async () => ({ chats: [], total: 0 }),
		}));
	});

	afterEach(() => {
		cleanup();
		vi.clearAllMocks();
	});

	it('uses 20 rows as the production default page size', async () => {
		renderPage();

		expect(screen.getByRole('combobox').textContent).toContain('20');
		await waitFor(() =>
			expect(mocks.queryOptions).toHaveBeenCalledWith({
				page: 0,
				pageSize: 20,
				filters: undefined,
				sorting: undefined,
			}),
		);
	});

	it('sends the search term to the chats query', async () => {
		renderPage('revenue');

		await waitFor(() =>
			expect(mocks.queryOptions).toHaveBeenCalledWith(expect.objectContaining({ page: 0, search: 'revenue' })),
		);
	});
});

function renderPage(search?: string) {
	render(
		<QueryClientProvider client={createTestQueryClient()}>
			<ChatsReplayPage
				search={search}
				selectedUserNames={undefined}
				selectedFeedbackStates={undefined}
				selectedToolStates={undefined}
				selectedSources={undefined}
				onOpenChat={vi.fn()}
			/>
		</QueryClientProvider>,
	);
}
