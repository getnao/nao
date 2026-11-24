// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { stubLocalStorage, stubResizeObserver, stubScrollIntoView } from '../../helpers/browser-stubs';
import { openDropdownMenu } from '../../helpers/dropdown-menu';
import type { ReactNode } from 'react';
import { FileViewer, isRootRulesPath } from '@/components/settings/file-viewer';

const owners = [{ id: 'ada', name: 'Ada Lovelace', email: 'ada@example.com' }];
const ORDERS_FOLDER = '/databases/type=duckdb/database=shop/schema=main/table=orders';
const defaultMutation = () => ({ isPending: false, mutate: vi.fn() });

vi.mock('@tanstack/react-query', () => ({
	useMutation: vi.fn(() => defaultMutation()),
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
			applyOwnerToTableFiles: { mutationOptions: vi.fn(() => ({ mutationKey: ['applyOwnerToTableFiles'] })) },
			listFileOwners: { queryOptions: vi.fn(() => ({ queryKey: [] })) },
			listTableFileOwners: { queryOptions: vi.fn(() => ({ queryKey: ['listTableFileOwners'] })) },
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
	vi.mocked(useQuery).mockImplementation(() => ({ data: owners }) as never);
	vi.mocked(useMutation).mockImplementation(() => defaultMutation() as never);
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

	it.each([
		{ name: 'a doc as a document', filePath: '/docs/guide.md', content: '# Guide', showsSource: false },
		{
			name: 'templated root rules as source',
			filePath: 'RULES.md',
			content: '{% if group("Finance") %}\nFinance\n{% endif %}',
			showsSource: true,
		},
		{
			name: 'a doc the visual editor cannot keep as source',
			filePath: '/docs/layout.md',
			content: '<div align="center">Guide</div>',
			showsSource: true,
		},
	])('opens $name without the Markdown view switch', ({ filePath, content, showsSource }) => {
		renderViewer({ filePath, content, hasMarkdownSourceViews: false });

		expect(screen.queryByRole('button', { name: 'Split' })).toBeNull();
		expect(screen.queryByRole('region', { name: 'Markdown preview' }) !== null).toBe(!showsSource);
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

		const ownerButton = screen.getByRole('button', { name: `Change owner, currently ${shownOwner}` });
		expect(ownerButton.textContent).toContain(shownOwner);
		expect(ownerButton.querySelector('.lucide-triangle-alert') !== null).toBe(owner === 'gone@example.com');
	});

	it.each([
		['offers to give the other docs of its table the owner picked', `${ORDERS_FOLDER}/columns.md`, true],
		['does not offer it for a file outside a table folder', '/docs/columns.md', false],
	])('%s', async (_, filePath, isOffered) => {
		stubScrollIntoView();
		const applyOwner = mockTableFiles([
			{ path: `${ORDERS_FOLDER}/preview.md`, owner: 'zoe@example.com', isEditable: true },
			{ path: `${ORDERS_FOLDER}/how_to_use.md`, owner: 'ada@example.com', isEditable: true },
			{ path: `${ORDERS_FOLDER}/ai_summary.md`, owner: null, isEditable: false },
		]);
		renderViewer({ filePath, content: '---\nowner: zoe@example.com\n---\nBody\n' });

		fireEvent.click(screen.getByRole('button', { name: /^Change owner/ }));
		fireEvent.click(await screen.findByRole('option', { name: /Ada Lovelace/ }));

		const prompt = screen.queryByRole('region', { name: 'Table owner' });
		expect(prompt !== null).toBe(isOffered);
		if (prompt) {
			expect(prompt.textContent).toContain(
				'1 other doc of table orders has another owner. Make Ada Lovelace the owner of every doc of the table?',
			);
			fireEvent.click(within(prompt).getByRole('button', { name: 'Apply to every doc' }));
			expect(applyOwner).toHaveBeenCalledWith({ path: filePath, owner: 'ada@example.com' });
		}
	});

	it('stops offering the owner picked once the header names another owner', async () => {
		stubScrollIntoView();
		localStorage.setItem('nao-file-viewer-markdown-view', JSON.stringify('split'));
		mockTableFiles([{ path: `${ORDERS_FOLDER}/preview.md`, owner: null, isEditable: true }]);
		renderViewer({ filePath: `${ORDERS_FOLDER}/columns.md`, content: '---\nowner: zoe@example.com\n---\nBody\n' });

		fireEvent.click(screen.getByRole('button', { name: /^Change owner/ }));
		fireEvent.click(await screen.findByRole('option', { name: /Ada Lovelace/ }));
		expect(screen.getByRole('region', { name: 'Table owner' })).toBeTruthy();

		fireEvent.change(screen.getByRole('textbox', { name: 'File source' }), {
			target: { value: '---\nowner: zoe@example.com\n---\nBody\n' },
		});

		expect(screen.queryByRole('region', { name: 'Table owner' })).toBeNull();
	});

	it('names the docs of the table that could not be saved and offers to retry', async () => {
		stubScrollIntoView();
		const applyOwner = mockTableFiles([], {
			isSuccess: true,
			data: { updatedPaths: [`${ORDERS_FOLDER}/preview.md`], failedPaths: [`${ORDERS_FOLDER}/how_to_use.md`] },
		});
		renderViewer({ filePath: `${ORDERS_FOLDER}/columns.md`, content: '---\nowner: zoe@example.com\n---\nBody\n' });

		fireEvent.click(screen.getByRole('button', { name: /^Change owner/ }));
		fireEvent.click(await screen.findByRole('option', { name: /Ada Lovelace/ }));

		const prompt = screen.getByRole('region', { name: 'Table owner' });
		expect(prompt.textContent).toContain('Updated the owner of 1 other doc of table orders.');
		expect(within(prompt).getByRole('alert').textContent).toBe('1 other doc could not be saved: how_to_use.md.');
		fireEvent.click(within(prompt).getByRole('button', { name: 'Retry' }));
		expect(applyOwner).toHaveBeenCalledWith({
			path: `${ORDERS_FOLDER}/columns.md`,
			owner: 'ada@example.com',
			onlyPaths: [`${ORDERS_FOLDER}/how_to_use.md`],
		});
	});

	it('offers to retry when the users of the project cannot be loaded', async () => {
		const refetch = vi.fn();
		vi.mocked(useQuery).mockImplementation(() => ({ data: undefined, isError: true, refetch }) as never);
		renderViewer({ filePath: '/notes.md', content: '---\nowner: ada@example.com\n---\nBody\n' });

		fireEvent.click(screen.getByRole('button', { name: 'Change owner, currently ada@example.com' }));
		fireEvent.click(within(await screen.findByRole('alert')).getByRole('button', { name: 'Retry' }));

		expect(refetch).toHaveBeenCalled();
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
		expect(screen.queryByRole('button', { name: /^Change owner/ })).toBeNull();
	});
});

describe('FileViewer save shortcut', () => {
	it.each([
		['saves the edits when pressed outside the editors', false],
		['leaves the save to the editor that handled it', true],
	])('%s', (_, isHandledByEditor) => {
		const writeFile = vi.fn();
		vi.mocked(useMutation).mockImplementation(() => ({ isPending: false, mutate: writeFile }) as never);
		localStorage.setItem('nao-file-viewer-markdown-view', JSON.stringify('source'));
		renderViewer({ filePath: '/notes.md', content: 'Body\n' });
		fireEvent.change(screen.getByRole('textbox', { name: 'File source' }), { target: { value: 'Edited\n' } });

		const event = new KeyboardEvent('keydown', { key: 's', ctrlKey: true, bubbles: true, cancelable: true });
		if (isHandledByEditor) {
			event.preventDefault();
		}
		document.body.dispatchEvent(event);

		expect(event.defaultPrevented).toBe(true);
		expect(writeFile.mock.calls.length > 0).toBe(!isHandledByEditor);
		if (!isHandledByEditor) {
			expect(writeFile.mock.calls[0][0]).toEqual({
				path: '/notes.md',
				content: 'Edited\n',
				expectedHash: 'hash',
			});
		}
	});
});

function renderViewer({
	filePath,
	content,
	rulesPreviewGroups = groups,
	isEditable = true,
	hasMarkdownSourceViews,
	onDraftChange,
}: {
	filePath: string;
	content: string;
	isEditable?: boolean;
	hasMarkdownSourceViews?: boolean;
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
			hasMarkdownSourceViews={hasMarkdownSourceViews}
			onDirtyChange={vi.fn()}
			onOpenGuidancePath={vi.fn()}
			onReload={vi.fn()}
			rulesPreviewGroups={rulesPreviewGroups}
			onDraftChange={onDraftChange}
		/>,
	);
}

function mockTableFiles(
	tableFiles: { path: string; owner: string | null; isEditable: boolean }[],
	applyState: { isSuccess: boolean; data?: { updatedPaths: string[]; failedPaths: string[] } } = {
		isSuccess: false,
	},
) {
	const applyOwner = vi.fn();
	vi.mocked(useQuery).mockImplementation(
		(options) => ({ data: options.queryKey[0] === 'listTableFileOwners' ? tableFiles : owners }) as never,
	);
	vi.mocked(useMutation).mockImplementation(
		(options) =>
			(options?.mutationKey?.[0] === 'applyOwnerToTableFiles'
				? { isPending: false, isError: false, ...applyState, mutate: applyOwner }
				: defaultMutation()) as never,
	);
	return applyOwner;
}
