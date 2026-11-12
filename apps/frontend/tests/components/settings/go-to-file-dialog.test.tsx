// @vitest-environment jsdom

import { QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { stubResizeObserver, stubScrollIntoView } from '../../helpers/browser-stubs';
import { createTestQueryClient } from '../../helpers/query-client';

import { GoToFileDialog } from '@/components/settings/go-to-file-dialog';
import {
	OpenContextFileCallbackProvider,
	useRegisterOpenContextFileCallback,
} from '@/contexts/open-context-file-callback';
import { isMac } from '@/lib/platform';

const mocks = vi.hoisted(() => ({
	navigate: vi.fn(),
	isOnContextExplorer: false,
}));

vi.mock('@tanstack/react-router', () => ({
	useNavigate: () => mocks.navigate,
	useMatchRoute: () => () => mocks.isOnContextExplorer,
}));

vi.mock('@/main', () => ({
	trpc: {
		contextExplorer: {
			getFileTree: {
				queryOptions: () => ({
					queryKey: ['file-tree'],
					queryFn: () => ({
						entries: [
							{
								name: 'docs',
								path: '/docs',
								type: 'directory',
								children: [{ name: 'orders.md', path: '/docs/orders.md', type: 'file' }],
							},
							{ name: 'RULES.md', path: '/RULES.md', type: 'file' },
						],
					}),
				}),
			},
		},
	},
}));

describe('GoToFileDialog', () => {
	beforeEach(() => {
		stubResizeObserver();
		stubScrollIntoView();
		mocks.navigate.mockReset();
		mocks.isOnContextExplorer = false;
	});

	afterEach(cleanup);

	it('opens with the shortcut and lists only the files matching the query', async () => {
		renderDialog();

		pressGoToFile();
		fireEvent.change(await screen.findByPlaceholderText('Search files by name...'), {
			target: { value: 'rules' },
		});

		expect(await screen.findByRole('option', { name: /RULES\.md/ })).toBeTruthy();
		expect(screen.queryByRole('option', { name: /orders\.md/ })).toBeNull();
	});

	it('navigates to the File Explorer with the picked file from another settings page', async () => {
		const openFileInExplorer = vi.fn();
		renderDialog(openFileInExplorer);

		pressGoToFile();
		fireEvent.click(await screen.findByRole('option', { name: /orders\.md/ }));

		expect(mocks.navigate).toHaveBeenCalledWith({
			to: '/settings/context-explorer',
			search: { path: '/docs/orders.md' },
		});
		expect(openFileInExplorer).not.toHaveBeenCalled();
		expect(screen.queryByPlaceholderText('Search files by name...')).toBeNull();
	});

	it('opens the picked file in the File Explorer shown, so it can guard unsaved changes', async () => {
		mocks.isOnContextExplorer = true;
		const openFileInExplorer = vi.fn();
		renderDialog(openFileInExplorer);

		pressGoToFile();
		fireEvent.click(await screen.findByRole('option', { name: /orders\.md/ }));

		expect(openFileInExplorer).toHaveBeenCalledWith('/docs/orders.md');
		expect(mocks.navigate).not.toHaveBeenCalled();
	});
});

function pressGoToFile() {
	fireEvent.keyDown(document, { key: 'p', metaKey: isMac, ctrlKey: !isMac });
}

function renderDialog(openFileInExplorer = vi.fn()) {
	render(
		<QueryClientProvider client={createTestQueryClient()}>
			<OpenContextFileCallbackProvider>
				<ExplorerStub onOpenFile={openFileInExplorer} />
				<GoToFileDialog />
			</OpenContextFileCallbackProvider>
		</QueryClientProvider>,
	);
}

function ExplorerStub({ onOpenFile }: { onOpenFile: (path: string) => void }) {
	useRegisterOpenContextFileCallback(onOpenFile, [onOpenFile]);
	return null;
}
