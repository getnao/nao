// @vitest-environment jsdom

import { parseStoryTabs } from '@nao/shared/story-tabs';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useRef, useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Editor } from '@tiptap/react';

import {
	blockSelectionPluginKey,
	emptySelection,
	topLevelBlockPositions,
} from '@/components/side-panel/story-block-selection';
import { StoryTabbedEditor } from '@/components/side-panel/story-tabbed-editor';

vi.hoisted(() => {
	Object.defineProperty(window.URL, 'createObjectURL', {
		configurable: true,
		value: vi.fn(() => 'blob:test'),
	});
});

vi.mock('@/components/side-panel/story-chart-embed', () => ({
	StoryChartEmbed: ({ chart }: { chart: { queryId: string } }) => <div>Chart {chart.queryId}</div>,
}));

vi.mock('@/components/side-panel/story-map-embed', () => ({
	StoryMapEmbed: () => null,
}));

vi.mock('@/components/side-panel/story-table-embed', () => ({
	StoryTableEmbed: () => null,
}));

vi.mock('@/components/chat-messages/markdown-table', () => ({
	MarkdownTable: () => null,
}));

vi.mock('@/contexts/story-chart-edit', () => ({
	EditorStoryChartEditProvider: ({ children }: { children: React.ReactNode }) => children,
	useStoryChartEdit: () => null,
}));

vi.mock('@/contexts/story-map-edit', () => ({
	EditorStoryMapEditProvider: ({ children }: { children: React.ReactNode }) => children,
	useStoryMapEdit: () => null,
}));

const rawTag = '<chart query_id="q1" chart_type="bar" x_axis_key="month" data_key="value" />';

function EditorHarness({ code }: { code: string }) {
	const editorRef = useRef<Editor | null>(null);
	const getCodeRef = useRef<(() => string) | null>(null);
	const [snapshot, setSnapshot] = useState('');

	return (
		<>
			<StoryTabbedEditor code={code} editorRef={editorRef} getCodeRef={getCodeRef} />
			<button type='button' onClick={() => setSnapshot(getCodeRef.current?.() ?? '')}>
				Snapshot
			</button>
			<button
				type='button'
				onClick={() => {
					const editor = editorRef.current;
					if (!editor) {
						return;
					}
					const blocks = topLevelBlockPositions(editor.state.doc).filter((position) => {
						const node = editor.state.doc.nodeAt(position);
						return node?.type.name !== 'paragraph' || node.content.size > 0;
					});
					editor.view.dispatch(
						editor.state.tr.setMeta(blockSelectionPluginKey, {
							...emptySelection(),
							blocks,
							anchor: blocks[0] ?? null,
						}),
					);
				}}
			>
				Select all blocks
			</button>
			<button
				type='button'
				onClick={() => {
					const editor = editorRef.current;
					if (!editor) {
						return;
					}
					const [first] = topLevelBlockPositions(editor.state.doc);
					editor.view.dispatch(
						editor.state.tr.setMeta(blockSelectionPluginKey, {
							...emptySelection(),
							blocks: [first],
							anchor: first,
						}),
					);
				}}
			>
				Select first block
			</button>
			<output>{snapshot}</output>
		</>
	);
}

async function openChartMenu() {
	const grip = await screen.findByRole('button', { name: 'Move story block' });
	fireEvent.pointerDown(grip, { button: 0, ctrlKey: false });
	expect(screen.queryByRole('menuitem', { name: 'Delete' })).toBeNull();
	expect(grip.getAttribute('aria-expanded')).toBe('false');
	fireEvent.click(grip, { button: 0, ctrlKey: false });
	await screen.findByRole('menuitem', { name: 'Delete' });
	expect(grip.getAttribute('aria-expanded')).toBe('true');
	return grip;
}

describe('edit-mode chart actions', () => {
	const scrollIntoView = vi.fn();

	beforeEach(() => {
		Element.prototype.scrollIntoView = scrollIntoView;
	});

	afterEach(() => {
		cleanup();
		scrollIntoView.mockClear();
	});

	it('keeps the chart menu closed when pointer-down becomes a drag', async () => {
		render(<EditorHarness code={rawTag} />);

		const floatingHandle = document.querySelector('.drag-handle');
		const fixedGrip = floatingHandle?.firstElementChild;
		expect(floatingHandle?.children.length).toBe(1);
		expect(fixedGrip?.classList.contains('drag-handle-button')).toBe(true);
		const editorDom = document.querySelector<HTMLElement>('.ProseMirror');
		const chartBlock = editorDom?.querySelector<HTMLElement>('[data-type="chart-block"]');
		const firstBlock = editorDom?.firstElementChild;
		const lastBlock = editorDom?.lastElementChild;
		expect(editorDom).not.toBeNull();
		expect(chartBlock).not.toBeNull();
		expect(firstBlock).not.toBeNull();
		expect(lastBlock).not.toBeNull();
		if (!editorDom || !chartBlock || !firstBlock || !lastBlock) {
			return;
		}
		const blockRect = new DOMRect(0, 0, 500, 40);
		vi.spyOn(firstBlock, 'getBoundingClientRect').mockReturnValue(blockRect);
		vi.spyOn(lastBlock, 'getBoundingClientRect').mockReturnValue(blockRect);
		const elementsFromPoint = document.elementsFromPoint;
		Object.defineProperty(document, 'elementsFromPoint', {
			configurable: true,
			value: () => [chartBlock, editorDom],
		});
		try {
			fireEvent.mouseMove(editorDom, { clientX: 100, clientY: 20 });
			await waitFor(() => expect(fixedGrip?.classList.contains('invisible')).toBe(true));
		} finally {
			Object.defineProperty(document, 'elementsFromPoint', {
				configurable: true,
				value: elementsFromPoint,
			});
		}
		const grips = await screen.findAllByRole('button', { name: 'Move story block' });
		const grip = grips.find((candidate) => !candidate.closest('.drag-handle'));
		expect(grip).toBeDefined();
		if (!grip) {
			return;
		}
		const dataTransfer = {
			effectAllowed: 'none',
			setData: vi.fn(),
		};
		expect(fireEvent.pointerDown(grip, { button: 0, ctrlKey: false })).toBe(true);
		expect(screen.queryByRole('menuitem', { name: 'Delete' })).toBeNull();

		fireEvent.dragStart(grip, { dataTransfer });

		expect(dataTransfer.setData).toHaveBeenCalled();
		expect(screen.queryByRole('menuitem', { name: 'Delete' })).toBeNull();
		expect(grip.getAttribute('aria-expanded')).toBe('false');
	});

	it('keeps stable geometry and the local menu on the generic text gutter handle', async () => {
		render(<EditorHarness code={'First paragraph\n\nSecond paragraph'} />);
		const editorDom = document.querySelector<HTMLElement>('.ProseMirror');
		const firstParagraph = editorDom?.firstElementChild;
		const lastParagraph = editorDom?.lastElementChild;
		expect(editorDom).not.toBeNull();
		expect(firstParagraph).not.toBeNull();
		expect(lastParagraph).not.toBeNull();
		if (!editorDom || !firstParagraph || !lastParagraph) {
			return;
		}

		const firstRect = new DOMRect(0, 0, 500, 40);
		const lastRect = new DOMRect(0, 50, 500, 40);
		vi.spyOn(firstParagraph, 'getBoundingClientRect').mockReturnValue(firstRect);
		vi.spyOn(lastParagraph, 'getBoundingClientRect').mockReturnValue(lastRect);
		const elementsFromPoint = document.elementsFromPoint;
		Object.defineProperty(document, 'elementsFromPoint', {
			configurable: true,
			value: () => [firstParagraph, editorDom],
		});

		try {
			fireEvent.mouseMove(editorDom, { clientX: 100, clientY: 20 });
			const grip = await screen.findByRole('button', { name: 'Move story block' });
			const floatingHandle = grip.closest('.drag-handle');
			const fixedGrip = floatingHandle?.firstElementChild;
			const menuAnchor = fixedGrip?.querySelector('[data-slot="dropdown-menu-trigger"]');
			expect(floatingHandle?.children.length).toBe(1);
			expect(fixedGrip).toBe(grip.parentElement);
			expect(fixedGrip?.classList.contains('drag-handle-button')).toBe(true);
			expect(menuAnchor?.classList.contains('absolute')).toBe(true);
			expect(grip.hasAttribute('data-slot')).toBe(false);
			expect(fireEvent.pointerDown(grip, { button: 0, ctrlKey: false })).toBe(true);
			expect(screen.queryByRole('menuitem', { name: 'Delete' })).toBeNull();
			fireEvent.click(grip);
			await screen.findByRole('menuitem', { name: 'Delete' });
		} finally {
			Object.defineProperty(document, 'elementsFromPoint', {
				configurable: true,
				value: elementsFromPoint,
			});
		}
	});

	it('moves a chart through the nested grip menu and selects it in the destination tab', async () => {
		const code = [
			'<tab title="Source">',
			'Before',
			'',
			rawTag,
			'',
			'After',
			'</tab>',
			'',
			'<tab title="Destination">',
			'Existing',
			'</tab>',
		].join('\n');
		render(<EditorHarness code={code} />);

		const grip = await openChartMenu();
		expect(grip.draggable).toBe(true);
		const moveItem = await screen.findByRole('menuitem', { name: 'Move to a tab' });
		expect(grip.getAttribute('aria-expanded')).toBe('true');
		fireEvent.pointerMove(moveItem, { pointerType: 'mouse' });
		fireEvent.click(await screen.findByRole('menuitem', { name: 'Destination' }));

		await waitFor(() => {
			expect(screen.getByText('Chart q1').closest('.nao-block-selected')).not.toBeNull();
		});
		expect(scrollIntoView).toHaveBeenCalledWith({ block: 'center', behavior: 'smooth' });

		fireEvent.click(screen.getByRole('button', { name: 'Snapshot' }));
		const tabs = parseStoryTabs(screen.getByRole('status').textContent ?? '');
		expect(tabs?.[0].innerCode.trim()).toBe('Before\n\nAfter');
		expect(tabs?.[1].innerCode.trim()).toBe(`Existing\n\n${rawTag}`);
	});

	it('moves a mixed multi-selection in order and highlights every destination block', async () => {
		const secondChart = rawTag;
		const code = [
			'<tab title="Source">',
			'Repeated text',
			'',
			rawTag,
			'',
			'Repeated text',
			'',
			secondChart,
			'</tab>',
			'',
			'<tab title="Destination">',
			'Existing',
			'</tab>',
		].join('\n');
		render(<EditorHarness code={code} />);

		fireEvent.click(screen.getByRole('button', { name: 'Select all blocks' }));
		const grips = await screen.findAllByRole('button', { name: 'Move story block' });
		fireEvent.click(grips[1]);
		const moveItem = await screen.findByRole('menuitem', { name: 'Move to a tab' });
		fireEvent.pointerMove(moveItem, { pointerType: 'mouse' });
		fireEvent.click(await screen.findByRole('menuitem', { name: 'Destination' }));

		await waitFor(() => {
			expect(screen.getAllByText('Repeated text')).toHaveLength(2);
			expect(screen.getAllByText('Chart q1')).toHaveLength(2);
			for (const content of screen.getAllByText(/^(Repeated text|Chart q1)$/)) {
				expect(content.closest('.nao-block-selected')).not.toBeNull();
			}
		});
		expect(scrollIntoView).toHaveBeenCalledWith({ block: 'center', behavior: 'smooth' });

		fireEvent.click(screen.getByRole('button', { name: 'Snapshot' }));
		const tabs = parseStoryTabs(screen.getByRole('status').textContent ?? '');
		expect(tabs?.[0].innerCode.trim()).toBe('');
		expect(tabs?.[1].innerCode.trim().replace(/\n{3,}/g, '\n\n')).toBe(
			['Existing', '', 'Repeated text', '', rawTag, '', 'Repeated text', '', secondChart].join('\n'),
		);
	});

	it('replaces selection from an unselected handle before deleting', async () => {
		render(<EditorHarness code={`Before\n\n${rawTag}\n\nAfter`} />);

		fireEvent.click(screen.getByRole('button', { name: 'Select first block' }));
		const grip = await screen.findByRole('button', { name: 'Move story block' });
		fireEvent.click(grip);
		expect(screen.getAllByRole('menu')).toHaveLength(1);
		fireEvent.click(await screen.findByRole('menuitem', { name: 'Delete' }));

		await waitFor(() => expect(screen.queryByText('Chart q1')).toBeNull());
		fireEvent.click(screen.getByRole('button', { name: 'Snapshot' }));
		expect(screen.getByRole('status').textContent?.trim()).toBe('Before\n\nAfter');
	});

	it('preserves a multi-selection when deleting from one selected handle', async () => {
		render(<EditorHarness code={`Before\n\n${rawTag}\n\nAfter`} />);

		fireEvent.click(screen.getByRole('button', { name: 'Select all blocks' }));
		await openChartMenu();
		fireEvent.click(await screen.findByRole('menuitem', { name: 'Delete' }));

		await waitFor(() => expect(screen.queryByText('Chart q1')).toBeNull());
		fireEvent.click(screen.getByRole('button', { name: 'Snapshot' }));
		expect(screen.getByRole('status').textContent?.trim()).toBe('');
	});

	it('deletes the chart from the editor transaction and hides tab movement without another tab', async () => {
		render(<EditorHarness code={rawTag} />);

		await openChartMenu();
		expect(screen.queryByRole('menuitem', { name: 'Move to a tab' })).toBeNull();
		fireEvent.click(await screen.findByRole('menuitem', { name: 'Delete' }));

		await waitFor(() => expect(screen.queryByText('Chart q1')).toBeNull());
		fireEvent.click(screen.getByRole('button', { name: 'Snapshot' }));
		expect(screen.getByRole('status').textContent).not.toContain(rawTag);
	});
});
