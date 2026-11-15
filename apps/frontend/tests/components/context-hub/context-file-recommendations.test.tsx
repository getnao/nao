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

function createRecommendations(count: number) {
	return Array.from({ length: count }, (_, index) => ({
		recommendation: { ...RECOMMENDATION, id: `rec-${index}`, title: `Recommendation ${index}` },
		edits: [EDIT],
	}));
}

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
		mocks.fileRecommendations = [{ recommendation: RECOMMENDATION, edits: [EDIT] }];
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

	it('shows every file Apply changes when the recommendation spans several', () => {
		const docEdit = { path: '/docs/refunds.md', kind: 'create', oldContent: '', newContent: '# Refunds policy\n' };
		mocks.fileRecommendations = [{ recommendation: RECOMMENDATION, edits: [EDIT, docEdit] }];
		mocks.search = { recommendation: 'rec-1' };

		renderRecommendations();

		expect(screen.getByRole('button', { name: 'Apply to 2 files' })).toBeDefined();
		expect(screen.getByText('/docs/refunds.md')).toBeDefined();
		expect(screen.getByText(/Refunds policy/)).toBeDefined();
	});

	it.each([
		{ requested: undefined, isListShown: false },
		{ requested: 'rec-3', isListShown: true },
	])('folds a long list behind one row unless the link asked for $requested', ({ requested, isListShown }) => {
		mocks.fileRecommendations = createRecommendations(5);
		mocks.search = { recommendation: requested };

		renderRecommendations();

		expect(screen.getByRole('button', { name: /nao suggests 5 changes/ })).toBeDefined();
		expect(screen.queryAllByRole('button', { name: 'Apply' })).toHaveLength(isListShown ? 5 : 0);
	});

	it('lists the folded recommendations, the requested one first, once the row is opened', () => {
		mocks.fileRecommendations = createRecommendations(5);
		mocks.search = { recommendation: 'rec-3' };

		renderRecommendations();

		const titles = screen.getAllByText(/^Recommendation \d$/).map((title) => title.textContent);
		expect(titles).toEqual([
			'Recommendation 3',
			'Recommendation 0',
			'Recommendation 1',
			'Recommendation 2',
			'Recommendation 4',
		]);
	});

	it('opens the folded list again when a link asks for another recommendation', () => {
		mocks.fileRecommendations = createRecommendations(5);
		mocks.search = { recommendation: 'rec-3' };
		const { rerender } = renderRecommendations();
		fireEvent.click(screen.getByRole('button', { name: /nao suggests 5 changes/ }));

		mocks.search = { recommendation: 'rec-1' };
		rerender(
			<QueryClientProvider client={createTestQueryClient()}>
				<TooltipProvider>
					<ContextFileRecommendations path='/RULES.md' isDirty={false} />
				</TooltipProvider>
			</QueryClientProvider>,
		);

		expect(screen.queryAllByRole('button', { name: 'Apply' })).toHaveLength(5);
	});

	it('keeps what could not be applied after folding and reopening the list', async () => {
		mocks.fileRecommendations = createRecommendations(5);
		mocks.search = { recommendation: 'rec-0' };
		mocks.applyToChanges.mockResolvedValue({
			changedPaths: [],
			unchangedPaths: [],
			conflicts: [{ path: '/RULES.md', reason: 'The file changed since nao proposed this edit.' }],
		});
		renderRecommendations();
		fireEvent.click(screen.getAllByRole('button', { name: 'Apply' })[0]);
		await screen.findByText(/The file changed since nao proposed this edit/);

		const groupToggle = screen.getByRole('button', { name: /nao suggests 5 changes/ });
		fireEvent.click(groupToggle);
		fireEvent.click(groupToggle);

		expect(screen.getByText(/The file changed since nao proposed this edit/)).toBeDefined();
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
