// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FileViewer, isRootRulesPath } from './file-viewer';
import type { ReactNode } from 'react';

vi.mock('@tanstack/react-query', () => ({
	useMutation: vi.fn(() => ({ isPending: false, mutate: vi.fn() })),
	useQueryClient: vi.fn(() => ({
		invalidateQueries: vi.fn(),
		setQueryData: vi.fn(),
	})),
}));

vi.mock('react-resizable-panels', () => ({
	useDefaultLayout: vi.fn(() => ({ defaultLayout: undefined, onLayoutChanged: vi.fn() })),
}));

vi.mock('streamdown', () => ({
	Streamdown: ({ children }: { children: string }) => <div data-testid='markdown-preview'>{children}</div>,
}));

vi.mock('@/components/settings/file-source-editor', () => ({
	FileSourceEditor: ({ value, onChange }: { value: string; onChange: (value: string) => void }) => (
		<textarea aria-label='File source' value={value} onChange={(event) => onChange(event.target.value)} />
	),
}));

vi.mock('@/components/ui/resizable', () => ({
	ResizablePanel: ({ children }: { children: ReactNode }) => <div>{children}</div>,
	ResizablePanelGroup: ({ children }: { children: ReactNode }) => <div>{children}</div>,
	ResizableSeparator: () => null,
}));

vi.mock('@/components/ui/tooltip', () => ({
	SimpleTooltip: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock('@/hooks/use-preview-highlights', () => ({ usePreviewHighlights: vi.fn() }));

vi.mock('@/main', () => ({
	trpc: {
		contextExplorer: {
			getChangedFiles: { queryKey: vi.fn(() => []) },
			readFile: { queryOptions: vi.fn(() => ({ queryKey: [] })) },
			writeFile: { mutationOptions: vi.fn(() => ({})) },
		},
	},
}));

const groups = {
	enforced: true,
	groups: [
		{ id: 'all', name: 'All Users', isDefault: true },
		{ id: 'finance', name: 'Finance', isDefault: false },
		{ id: 'marketing', name: 'Marketing', isDefault: false },
	],
};

beforeEach(() => {
	vi.stubGlobal('localStorage', createMemoryStorage());
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

describe('FileViewer RULES preview', () => {
	it('recognizes only project-root RULES.md across slash conventions', () => {
		expect(isRootRulesPath('RULES.md')).toBe(true);
		expect(isRootRulesPath('/RULES.md')).toBe(true);
		expect(isRootRulesPath('.\\RULES.md')).toBe(true);
		expect(isRootRulesPath('/nested/RULES.md')).toBe(false);
		expect(isRootRulesPath('docs\\RULES.md')).toBe(false);
		expect(isRootRulesPath('/rules.md')).toBe(false);
	});

	it('defaults to All Users and previews the union of selected groups from raw source', async () => {
		const content = [
			'Public',
			'{% if group("Finance") %}',
			'Finance instructions that use enough characters to change the token estimate.',
			'{% endif %}',
			'{% if group("Marketing") %}',
			'Marketing instructions',
			'{% endif %}',
		].join('\n');
		renderViewer({ filePath: '/RULES.md', content });

		expect(screen.getByRole('button', { name: 'Select user groups. Current groups: All Users' })).toBeTruthy();
		expect(screen.getByTestId('markdown-preview').textContent).toBe('Public\n');
		const initialTokens = screen.getByText(/tokens$/).textContent;

		openGroupPicker();
		expect(
			screen.getByRole('menuitemcheckbox', { name: 'All Users (automatic)' }).getAttribute('aria-disabled'),
		).toBe('true');
		fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'Finance' }));
		fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'Marketing' }));

		await waitFor(() =>
			expect(screen.getByTestId('markdown-preview').textContent).toContain('Finance instructions'),
		);
		expect(screen.getByTestId('markdown-preview').textContent).toContain('Marketing instructions');
		expect(screen.getByText(/tokens$/).textContent).not.toBe(initialTokens);

		fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
		fireEvent.click(screen.getByRole('button', { name: 'Show markdown source' }));
		expect((screen.getByLabelText('File source') as HTMLTextAreaElement).value).toBe(content);
	});

	it('fails closed for a malformed draft while keeping raw source editable', () => {
		const content = 'Public\n{% if group("Finance") %}\nProtected instructions';
		renderViewer({ filePath: 'RULES.md', content });

		expect(screen.getByText(/conditional block without a matching endif/)).toBeTruthy();
		expect(screen.queryByText(/Protected instructions/)).toBeNull();
		fireEvent.click(screen.getByRole('button', { name: 'Show markdown source' }));
		expect((screen.getByLabelText('File source') as HTMLTextAreaElement).value).toBe(content);
	});

	it('leaves nested Markdown unchanged without a group selector', () => {
		const content = '{% if group("Finance") %}\nNested content\n{% endif %}';
		renderViewer({ filePath: '/docs/RULES.md', content });

		expect(screen.queryByRole('button', { name: /Select user groups/ })).toBeNull();
		expect(screen.getByTestId('markdown-preview').textContent).toBe(content);
	});

	it('uses unenforced rendering and hides the selector when groups are unlicensed', () => {
		const content = '{% if group("Finance") %}\nFinance content\n{% endif %}';
		renderViewer({ filePath: '/RULES.md', content, rulesPreviewGroups: { enforced: false, groups: [] } });

		expect(screen.queryByRole('button', { name: /Select user groups/ })).toBeNull();
		expect(screen.getByTestId('markdown-preview').textContent).toBe('Finance content\n');
	});
});

function renderViewer({
	filePath,
	content,
	rulesPreviewGroups = groups,
}: {
	filePath: string;
	content: string;
	rulesPreviewGroups?: typeof groups | { enforced: false; groups: [] };
}) {
	render(
		<FileViewer
			filePath={filePath}
			content={content}
			hash='hash'
			isLoading={false}
			isError={false}
			isEditable
			editabilityGuidance={null}
			searchQuery=''
			sourceAutoOpenRequestId={null}
			onDirtyChange={vi.fn()}
			onOpenGuidancePath={vi.fn()}
			onReload={vi.fn()}
			rulesPreviewGroups={rulesPreviewGroups}
		/>,
	);
}

function openGroupPicker() {
	fireEvent.pointerDown(screen.getByRole('button', { name: /Select user groups/ }), {
		button: 0,
		ctrlKey: false,
	});
}

function createMemoryStorage(): Storage {
	const values = new Map<string, string>();
	return {
		get length() {
			return values.size;
		},
		clear: () => values.clear(),
		getItem: (key) => values.get(key) ?? null,
		key: (index) => [...values.keys()][index] ?? null,
		removeItem: (key) => values.delete(key),
		setItem: (key, value) => values.set(key, value),
	};
}
