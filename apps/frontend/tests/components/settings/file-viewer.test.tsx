// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { stubLocalStorage, stubResizeObserver } from '../../helpers/browser-stubs';
import { openDropdownMenu } from '../../helpers/dropdown-menu';
import type { ReactNode } from 'react';
import { FileViewer, isRootRulesPath } from '@/components/settings/file-viewer';

const owners = [{ id: 'ada', name: 'Ada Lovelace', email: 'ada@example.com' }];

vi.mock('@tanstack/react-query', () => ({
	useMutation: vi.fn(() => ({ isPending: false, mutate: vi.fn() })),
	useQuery: vi.fn(() => ({ data: owners })),
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
			getFileHeaderProblems: { queryKey: vi.fn(() => []) },
			listFileOwners: { queryOptions: vi.fn(() => ({ queryKey: [] })) },
			readFile: { queryOptions: vi.fn(() => ({ queryKey: [] })) },
			writeFile: { mutationOptions: vi.fn(() => ({})) },
		},
	},
}));

const groups = {
	status: 'ready' as const,
	enforced: true,
	groups: [
		{ id: 'all', name: 'All Users', isDefault: true },
		{ id: 'finance', name: 'Finance', isDefault: false },
		{ id: 'marketing', name: 'Marketing', isDefault: false },
	],
};

beforeEach(() => {
	stubLocalStorage();
	stubResizeObserver();
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
			'{% if group("finance") %}',
			'Finance instructions that use enough characters to change the token estimate.',
			'{% endif %}',
			'{% if group("marketing") %}',
			'Marketing instructions',
			'{% endif %}',
		].join('\n');
		renderViewer({ filePath: '/RULES.md', content });

		const preview = screen.getByRole('region', { name: 'Markdown preview' });
		const toolbar = screen.getByRole('toolbar', { name: 'Rules preview options' });
		const fileHeader = toolbar.previousElementSibling;
		expect(fileHeader?.textContent).toContain('RULES.md');
		expect(fileHeader?.nextElementSibling).toBe(toolbar);
		expect(fileHeader?.contains(toolbar)).toBe(false);
		expect(preview.contains(toolbar)).toBe(false);
		expect(within(toolbar).getByText('Preview as')).toBeTruthy();
		expect(
			within(toolbar).getByRole('button', { name: 'Select user groups. Current groups: All Users' }),
		).toBeTruthy();
		expect(screen.getByTestId('markdown-preview').textContent).toBe('Public\n');
		const initialTokens = screen.getByText(/tokens$/).textContent;

		openDropdownMenu(/Select user groups/);
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
		fireEvent.click(screen.getByRole('button', { name: 'Split' }));
		const source = screen.getByLabelText('File source') as HTMLTextAreaElement;
		expect(source.value).toBe(content);
		const splitPreview = screen.getByRole('region', { name: 'Markdown preview' });
		expect(splitPreview.contains(toolbar)).toBe(false);
		expect(splitPreview.contains(source)).toBe(false);
	});

	it('fails closed for a malformed draft while keeping raw source editable', () => {
		const content = 'Public\n{% if group("Finance") %}\nProtected instructions';
		renderViewer({ filePath: 'RULES.md', content });

		expect(screen.getByText(/conditional block without a matching endif/)).toBeTruthy();
		expect(screen.queryByText(/Protected instructions/)).toBeNull();
		fireEvent.click(screen.getByRole('button', { name: 'Source' }));
		expect((screen.getByLabelText('File source') as HTMLTextAreaElement).value).toBe(content);
	});

	it.each([
		{ view: 'Preview', showsPreview: true, showsSource: false },
		{ view: 'Split', showsPreview: true, showsSource: true },
		{ view: 'Source', showsPreview: false, showsSource: true },
	])('shows the panes of the $view view of a Markdown file', ({ view, showsPreview, showsSource }) => {
		renderViewer({ filePath: '/docs/guide.md', content: '# Guide' });

		fireEvent.click(screen.getByRole('button', { name: view }));

		expect(screen.getByRole('button', { name: view }).getAttribute('aria-pressed')).toBe('true');
		expect(screen.queryByRole('region', { name: 'Markdown preview' }) !== null).toBe(showsPreview);
		expect(screen.queryByLabelText('File source') !== null).toBe(showsSource);
	});

	it('leaves nested Markdown unchanged without a group selector', () => {
		const content = '{% if group("Finance") %}\nNested content\n{% endif %}';
		renderViewer({ filePath: '/docs/RULES.md', content });

		expect(screen.queryByRole('toolbar', { name: 'Rules preview options' })).toBeNull();
		expect(screen.queryByRole('button', { name: /Select user groups/ })).toBeNull();
		const editorText = screen.getByLabelText('Markdown editor').textContent;
		for (const part of ['{% if group("Finance") %}', 'Nested content', '{% endif %}']) {
			expect(editorText).toContain(part);
		}
	});

	it('uses unenforced rendering and hides the selector when groups are unlicensed', () => {
		const content = '{% if group("Finance") %}\nFinance content\n{% endif %}';
		renderViewer({
			filePath: '/RULES.md',
			content,
			rulesPreviewGroups: { status: 'ready', enforced: false, groups: [] },
		});

		expect(screen.queryByRole('toolbar', { name: 'Rules preview options' })).toBeNull();
		expect(screen.queryByRole('button', { name: /Select user groups/ })).toBeNull();
		expect(screen.getByTestId('markdown-preview').textContent).toBe('Finance content\n');
	});

	it.each([
		{ state: { status: 'loading' as const }, message: 'Loading RULES.md preview access...' },
		{ state: { status: 'error' as const }, message: 'Failed to load RULES.md preview access.' },
	])('does not render conditional rules while preview access is $state.status', ({ state, message }) => {
		const content = '{% if group("Finance") %}\nProtected instructions\n{% endif %}';
		renderViewer({ filePath: '/RULES.md', content, rulesPreviewGroups: state });

		expect(screen.getByText(message)).toBeTruthy();
		expect(screen.queryByTestId('markdown-preview')).toBeNull();
		expect(screen.queryByText('Protected instructions')).toBeNull();
		expect(screen.queryByRole('toolbar', { name: 'Rules preview options' })).toBeNull();
		expect(screen.queryByText(/tokens$/)).toBeNull();
	});
});

describe('FileViewer file header', () => {
	it('writes the title and tags typed in the header into the frontmatter, keeping the body', () => {
		const onDraftChange = vi.fn();
		renderViewer({ filePath: '/notes.md', content: 'Body\n', onDraftChange });

		const title = screen.getByRole('textbox', { name: 'Title' }) as HTMLTextAreaElement;
		fireEvent.change(title, { target: { value: 'Revenue report ' } });
		const tagInput = screen.getByRole('textbox', { name: 'Add a tag' });
		fireEvent.change(tagInput, { target: { value: 'finance' } });
		fireEvent.keyDown(tagInput, { key: 'Enter' });

		expect(title.value).toBe('Revenue report ');
		expect(onDraftChange).toHaveBeenLastCalledWith(
			'/notes.md',
			'---\ntitle: Revenue report\ntags: [finance]\n---\n\nBody\n',
		);
	});

	it.each([
		['a user of the project by name', 'ada@example.com', 'Ada Lovelace'],
		['an unknown owner as a warning', 'gone@example.com', 'gone@example.com'],
	])('shows %s', (_, owner, shownOwner) => {
		renderViewer({ filePath: '/notes.md', content: `---\nowner: ${owner}\n---\nBody\n` });

		const ownerButton = screen.getByRole('button', { name: 'Change owner' });
		expect(ownerButton.textContent).toContain(shownOwner);
		expect(ownerButton.querySelector('.lucide-triangle-alert') !== null).toBe(owner === 'gone@example.com');
	});

	it.each([
		['/docs/revenue_by-region.md', 'Revenue by region', 'Add a description'],
		['/RULES.md', 'Rules', 'The main rules of the agent, read at the start of every conversation.'],
	])('shows the default title and description of %s until the file sets them', (filePath, title, description) => {
		const onDraftChange = vi.fn();
		renderViewer({ filePath, content: 'Body\n', onDraftChange });

		const titleField = screen.getByRole('textbox', { name: 'Title' }) as HTMLTextAreaElement;
		expect(titleField.value).toBe('');
		expect(titleField.placeholder).toBe(title);
		expect((screen.getByRole('textbox', { name: 'Description' }) as HTMLTextAreaElement).placeholder).toContain(
			description,
		);
		expect(onDraftChange).toHaveBeenLastCalledWith(filePath, 'Body\n');
	});

	it('shows the header as Markdown in Source, where editing it changes the properties', () => {
		localStorage.setItem('nao-file-viewer-markdown-view', JSON.stringify('source'));
		const onDraftChange = vi.fn();
		renderViewer({ filePath: '/notes.md', content: '---\ntitle: Old\n---\nBody\n', onDraftChange });

		const source = screen.getByRole('textbox', { name: 'File source' }) as HTMLTextAreaElement;
		expect(source.value).toBe('---\ntitle: Old\n---\nBody\n');
		expect(screen.queryByLabelText('File properties')).toBeNull();
		fireEvent.change(source, { target: { value: '---\ntitle: New\n---\nBody\n' } });
		expect(onDraftChange).toHaveBeenLastCalledWith('/notes.md', '---\ntitle: New\n---\nBody\n');
	});

	it('adds a header from Source to a file that has none', () => {
		localStorage.setItem('nao-file-viewer-markdown-view', JSON.stringify('source'));
		const onDraftChange = vi.fn();
		renderViewer({ filePath: '/RULES.md', content: '# Rules\n', onDraftChange });

		fireEvent.click(screen.getByRole('button', { name: 'Add header' }));

		const [, content] = onDraftChange.mock.lastCall ?? [];
		expect(content).toMatch(
			/^---\ntitle: Rules\ndescription: The main rules of the agent.*\nowner:\ntags: \[\]\n---\n\n# Rules\n$/,
		);
		expect(screen.queryByRole('button', { name: 'Add header' })).toBeNull();
	});

	it('lists the wrong header properties above the source as they are typed', () => {
		localStorage.setItem('nao-file-viewer-markdown-view', JSON.stringify('source'));
		renderViewer({ filePath: '/RULES.md', content: '---\ntitle: Rules\n---\nBody\n' });
		expect(screen.queryByLabelText('Header checks')).toBeNull();

		fireEvent.change(screen.getByRole('textbox', { name: 'File source' }), {
			target: { value: '---\ntitle: Rules\neaze: eaz\nowner: gone@example.com\n---\nBody\n' },
		});

		const checks = screen.getByLabelText('Header checks').textContent;
		expect(checks).toContain('Unknown property "eaze"');
		expect(checks).toContain('The owner gone@example.com is not a user of this project.');
	});

	it('shows a broken header without letting it be edited', () => {
		renderViewer({ filePath: '/notes.md', content: '---\ntitle: [unclosed\n---\nBody\n' });

		expect(screen.getByLabelText('File properties').textContent).toContain('Fix it in Source.');
		expect((screen.getByRole('textbox', { name: 'Title' }) as HTMLTextAreaElement).readOnly).toBe(true);
		expect(screen.queryByRole('button', { name: 'Change owner' })).toBeNull();
	});
});

function renderViewer({
	filePath,
	content,
	rulesPreviewGroups = groups,
	isEditable = true,
	onDraftChange,
}: {
	filePath: string;
	content: string;
	isEditable?: boolean;
	onDraftChange?: (path: string, content: string) => void;
	rulesPreviewGroups?:
		| typeof groups
		| { status: 'ready'; enforced: false; groups: [] }
		| { status: 'loading' }
		| { status: 'error' };
}) {
	render(
		<FileViewer
			filePath={filePath}
			content={content}
			hash='hash'
			isLoading={false}
			isError={false}
			isEditable={isEditable}
			editabilityGuidance={null}
			searchQuery=''
			sourceAutoOpenRequestId={null}
			onDirtyChange={vi.fn()}
			onOpenGuidancePath={vi.fn()}
			onReload={vi.fn()}
			rulesPreviewGroups={rulesPreviewGroups}
			onDraftChange={onDraftChange}
		/>,
	);
}
