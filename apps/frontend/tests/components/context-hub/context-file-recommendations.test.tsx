// @vitest-environment jsdom

import { QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createTestQueryClient } from '../../helpers/query-client';
import { ContextFileRecommendations } from '@/components/context-hub/context-file-recommendations';
import { TooltipProvider } from '@/components/ui/tooltip';

const mocks = vi.hoisted(() => ({
	applyToChanges: vi.fn(),
	setStatus: vi.fn(),
	invalidateExplorerQueries: vi.fn(),
	invalidateRecommendationQueries: vi.fn(),
	search: {} as { recommendation?: string },
	fileRecommendations: [] as unknown[],
}));

vi.mock('@tanstack/react-router', () => ({
	Link: ({ children }: { children: React.ReactNode }) => <a>{children}</a>,
	useSearch: () => mocks.search,
}));
vi.mock('@/hooks/use-context-recommendations', () => ({
	useFileRecommendations: () => mocks.fileRecommendations,
}));
vi.mock('@/lib/context-explorer-queries', () => ({
	invalidateExplorerQueries: mocks.invalidateExplorerQueries,
	invalidateRecommendationQueries: mocks.invalidateRecommendationQueries,
}));
vi.mock('@/main', () => ({
	trpc: {
		contextRecommendation: {
			applyToChanges: {
				mutationOptions: (options: object) => ({ ...options, mutationFn: mocks.applyToChanges }),
			},
			setStatus: { mutationOptions: (options: object) => ({ ...options, mutationFn: mocks.setStatus }) },
		},
	},
}));

const RECOMMENDATION = {
	id: 'rec-1',
	title: 'Exclude refunds from revenue',
	summary: 'Revenue answers include refunded orders.',
};
const EDIT = {
	path: '/RULES.md',
	kind: 'edit',
	oldContent: '## Revenue\nSum of amounts.\n',
	newContent: '## Revenue\nSum of amounts, refunds excluded.\n',
};

function renderRecommendations({ isDirty = false } = {}) {
	return render(
		<QueryClientProvider client={createTestQueryClient()}>
			<TooltipProvider>
				<ContextFileRecommendations path='/RULES.md' isDirty={isDirty} />
			</TooltipProvider>
		</QueryClientProvider>,
	);
}

describe('ContextFileRecommendations', () => {
	beforeEach(() => {
		vi.resetAllMocks();
		mocks.search = {};
		mocks.fileRecommendations = [{ recommendation: RECOMMENDATION, edit: EDIT }];
	});

	afterEach(cleanup);

	it('shows nothing for a file without recommendation', () => {
		mocks.fileRecommendations = [];

		const { container } = renderRecommendations();

		expect(container.textContent).toBe('');
	});

	it.each([
		{ requested: undefined, isDiffShown: false },
		{ requested: 'rec-1', isDiffShown: true },
	])('shows the proposed diff when the link asked for $requested', ({ requested, isDiffShown }) => {
		mocks.search = { recommendation: requested };

		renderRecommendations();

		expect(screen.getByText('Exclude refunds from revenue')).toBeDefined();
		expect(screen.queryByText(/refunds excluded/) !== null).toBe(isDiffShown);
	});

	it('applies the change to the user changes and refreshes the hub', async () => {
		mocks.applyToChanges.mockResolvedValue({ changedPaths: ['/RULES.md'], unchangedPaths: [], conflicts: [] });
		renderRecommendations();

		fireEvent.click(screen.getByRole('button', { name: 'Apply' }));

		await waitFor(() => expect(mocks.invalidateExplorerQueries).toHaveBeenCalled());
		expect(mocks.applyToChanges.mock.calls[0][0]).toEqual({ id: 'rec-1' });
		expect(mocks.invalidateRecommendationQueries).toHaveBeenCalled();
	});

	it('tells what could not be applied', async () => {
		mocks.applyToChanges.mockResolvedValue({
			changedPaths: [],
			unchangedPaths: [],
			conflicts: [{ path: '/RULES.md', reason: 'The file changed since nao proposed this edit.' }],
		});
		renderRecommendations();

		fireEvent.click(screen.getByRole('button', { name: 'Apply' }));

		expect(await screen.findByText(/The file changed since nao proposed this edit/)).toBeDefined();
	});

	it('does not apply over unsaved edits', () => {
		renderRecommendations({ isDirty: true });

		expect(screen.getByRole('button', { name: 'Apply' }).hasAttribute('disabled')).toBe(true);
	});

	it('dismisses the recommendation', async () => {
		renderRecommendations();

		fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));

		await waitFor(() => expect(mocks.setStatus).toHaveBeenCalled());
		expect(mocks.setStatus.mock.calls[0][0]).toEqual({ id: 'rec-1', status: 'dismissed' });
	});
});
