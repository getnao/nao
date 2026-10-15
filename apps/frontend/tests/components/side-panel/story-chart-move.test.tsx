// @vitest-environment jsdom

import { parseStoryTabs } from '@nao/shared/story-tabs';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useRef, useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Editor } from '@tiptap/react';
import type { MutableRefObject } from 'react';

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

describe('edit-mode chart actions', () => {
	const scrollIntoView = vi.fn();
	const nativeDragEvent = globalThis.DragEvent;

	beforeEach(() => {
		Element.prototype.scrollIntoView = scrollIntoView;
		Object.defineProperty(globalThis, 'DragEvent', {
			configurable: true,
			value: MouseEvent,
		});
		const getComputedStyle = window.getComputedStyle.bind(window);
		vi.spyOn(window, 'getComputedStyle').mockImplementation((element, pseudoElement) => {
			const computed = getComputedStyle(element, pseudoElement);
			const iterator = (computed as unknown as { [Symbol.iterator]?: unknown })[Symbol.iterator];
			if (typeof iterator !== 'function') {
				Object.defineProperty(computed, Symbol.iterator, {
					configurable: true,
					value: function* () {
						for (let index = 0; index < computed.length; index += 1) {
							yield computed.item(index);
						}
					},
				});
			}
			return computed;
		});
	});

	afterEach(() => {
		cleanup();
		scrollIntoView.mockClear();
		vi.restoreAllMocks();
		if (nativeDragEvent) {
			Object.defineProperty(globalThis, 'DragEvent', {
				configurable: true,
				value: nativeDragEvent,
			});
		} else {
			delete (globalThis as { DragEvent?: typeof DragEvent }).DragEvent;
		}
	});

	it('keeps the chart menu closed when pointer-down becomes a drag', async () => {
		render(<EditorHarness code={rawTag} />);

		const floatingHandle = document.querySelector('.drag-handle');
		const fixedGrip = floatingHandle?.firstElementChild;
		expect(floatingHandle?.children.length).toBe(1);
		expect(fixedGrip?.classList.contains('drag-handle-button')).toBe(true);
		const { editorDom, firstBlock, lastBlock } = getBoundaryBlocks();
		const chartBlock = editorDom.querySelector<HTMLElement>('[data-type="chart-block"]');
		expect(chartBlock).not.toBeNull();
		const blockRect = new DOMRect(0, 0, 500, 40);
		mockBoundaryBlockRects(firstBlock, blockRect, lastBlock, blockRect);
		await withElementsFromPoint(
			() => [chartBlock as Element, editorDom],
			async () => {
				fireEvent.mouseMove(editorDom, { clientX: 100, clientY: 20 });
				await waitFor(() => expect(fixedGrip?.classList.contains('invisible')).toBe(true));
			},
		);
		const grip = await findInlineBlockGrip();
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

	it('shows the action grip tooltip and hides it when the menu opens', async () => {
		render(<EditorHarness code={rawTag} />);

		const grip = await screen.findByRole('button', { name: 'Move story block' });
		fireEvent.pointerMove(grip.parentElement as HTMLElement, { pointerType: 'mouse' });

		await waitFor(() => {
			const tooltip = document.querySelector('[data-slot="tooltip-content"]');
			expect(tooltip?.getAttribute('data-side')).toBe('bottom');
			expect(tooltip?.getAttribute('data-align')).toBe('center');
			const lines = Array.from(tooltip?.children ?? []).slice(0, 2);
			expect(lines.map((line) => line.textContent)).toEqual(['Click to open menu', 'Drag to move']);

			const actionWords = lines.map((line) => line.querySelector('.text-foreground'));
			expect(actionWords.map((word) => word?.textContent)).toEqual(['Click', 'Drag']);
			expect(actionWords.every((word) => word?.classList.contains('font-medium'))).toBe(true);

			const descriptions = lines.map((line) => line.querySelector('.text-muted-foreground'));
			expect(descriptions.map((description) => description?.textContent)).toEqual(['to open menu', 'to move']);
		});

		const dataTransfer = createDataTransfer();
		fireEvent.dragStart(grip, { dataTransfer });
		await waitFor(() => expect(document.querySelector('[data-slot="tooltip-content"]')).toBeNull());
		fireEvent.dragEnd(grip, { dataTransfer });

		fireEvent.click(grip);
		await screen.findByRole('menuitem', { name: 'Delete' });
		const menu = screen.getByRole('menu', { name: 'Move story block actions' });
		expect(menu.getAttribute('data-side')).toBe('bottom');
		expect(menu.getAttribute('data-align')).toBe('center');
		await waitFor(() => expect(screen.queryByText('Click to open menu')).toBeNull());
	});

	it('suppresses a moved handle tooltip until the pointer leaves and returns', async () => {
		const editorRef = createEditorRef();
		render(<EditorHarness code={`${rawTag}\n\nAfter`} exposedEditorRef={editorRef} />);

		const grip = await screen.findByRole('button', { name: 'Move story block' });
		const trigger = grip.parentElement as HTMLElement;
		fireEvent.pointerMove(trigger, { pointerType: 'mouse' });
		await waitFor(() => expect(document.querySelector('[data-slot="tooltip-content"]')).not.toBeNull());

		const editor = editorRef.current;
		const editorDom = document.querySelector<HTMLElement>('.ProseMirror');
		expect(editor).not.toBeNull();
		expect(editorDom).not.toBeNull();
		if (!editor || !editorDom) {
			return;
		}

		await withElementsFromPoint(
			() => {
				const currentGrip = screen.queryByRole('button', { name: 'Move story block' });
				return currentGrip ? [currentGrip] : [];
			},
			async () => {
				const dataTransfer = createDataTransfer();
				fireEvent.dragStart(grip, { clientX: 20, clientY: 20, dataTransfer });
				await waitFor(() => expect(document.querySelector('[data-slot="tooltip-content"]')).toBeNull());

				vi.spyOn(editor.view, 'posAtCoords').mockReturnValue({
					pos: editor.state.doc.content.size,
					inside: -1,
				});
				fireEvent.drop(editorDom, { clientX: 20, clientY: 80, dataTransfer });
				fireEvent.dragEnd(grip, { clientX: 20, clientY: 80, dataTransfer });

				await waitFor(() => expect(editor.getMarkdown().trim()).toBe(`After\n\n${rawTag}`));
				const movedGrip = await screen.findByRole('button', { name: 'Move story block' });
				const movedTrigger = movedGrip.parentElement as HTMLElement;
				fireEvent.pointerMove(movedTrigger, { pointerType: 'mouse' });
				await new Promise((resolve) => setTimeout(resolve, 800));
				expect(document.querySelector('[data-slot="tooltip-content"]')).toBeNull();

				fireEvent.pointerLeave(movedTrigger, { pointerType: 'mouse' });
				fireEvent.pointerMove(movedTrigger, { pointerType: 'mouse' });
				await waitFor(() => expect(document.querySelector('[data-slot="tooltip-content"]')).not.toBeNull());
			},
		);
	});

	it('keeps stable geometry and the local menu on the generic text gutter handle', async () => {
		render(<EditorHarness code={'First paragraph\n\nSecond paragraph'} />);

		await withFirstParagraphHovered(async () => {
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
		});
	});

	it('leaves a same-editor generic list drop to the native Tiptap handler', async () => {
		const editorRef = createEditorRef();
		render(<EditorHarness code={'- Alpha\n- Beta\n\nAfter'} exposedEditorRef={editorRef} />);
		const { editorDom, firstBlock: list, lastBlock } = getBoundaryBlocks();
		mockBoundaryBlockRects(list, new DOMRect(0, 0, 500, 60), lastBlock, new DOMRect(0, 70, 500, 40));

		await withElementsFromPoint(
			() => [list, editorDom],
			async () => {
				fireEvent.mouseMove(editorDom, { clientX: 100, clientY: 20 });
				const grip = await screen.findByRole('button', { name: 'Move story block' });
				const floatingHandle = grip.closest('.drag-handle') as HTMLElement;
				const dataTransfer = createDataTransfer();
				expect(() => {
					fireEvent.dragStart(floatingHandle, { clientX: 100, clientY: 20, dataTransfer });
				}).not.toThrow();

				const editor = editorRef.current;
				expect(editor).not.toBeNull();
				expect(editor?.view.dragging).not.toBeNull();
				if (!editor) {
					return;
				}

				vi.spyOn(editor.view, 'posAtCoords').mockReturnValue({
					pos: editor.state.doc.content.size,
					inside: -1,
				});
				expect(() => {
					fireEvent.drop(editorDom, { clientX: 100, clientY: 120, dataTransfer });
				}).not.toThrow();
				expect(editor.view.dragging).toBeNull();
				fireEvent.dragEnd(floatingHandle, { dataTransfer });

				await waitFor(() => expect(editor.getMarkdown().trim()).toBe('After\n\n- Alpha\n- Beta'));
				expect(editor.getMarkdown()).not.toMatch(/^-\s*$/m);
				expect(document.querySelector('.drop-cursor')).toBeNull();
				expect(document.querySelector('.nao-block-selected')).toBeNull();
				expect(document.querySelector('[data-slot="tooltip-content"]')).toBeNull();
				expect(floatingHandle.dataset.dragging).toBe('false');
			},
		);
	});

	it('clears the block selection when directly clicking another tab', async () => {
		const editorRef = createEditorRef();
		render(<EditorHarness code={tabbedCode(['Selected'], ['Existing'])} exposedEditorRef={editorRef} />);

		fireEvent.click(screen.getByRole('button', { name: 'Select first block' }));
		const editor = editorRef.current;
		expect(editor).not.toBeNull();
		if (!editor) {
			return;
		}
		expect(blockSelectionPluginKey.getState(editor.state)?.blocks).not.toHaveLength(0);

		fireEvent.click(screen.getByRole('button', { name: 'Destination' }));

		await waitFor(() => {
			expect(blockSelectionPluginKey.getState(editor.state)).toEqual(emptySelection());
			expect(screen.getByText('Existing')).not.toBeNull();
		});
	});

	it('moves a chart through the nested grip menu and selects it in the destination tab', async () => {
		render(<EditorHarness code={tabbedCode(['Before', '', rawTag, '', 'After'], ['Existing'])} />);

		const grip = await openChartMenu();
		expect(grip.draggable).toBe(true);
		const moveItem = await screen.findByRole('menuitem', { name: 'Move to a tab' });
		expect(grip.getAttribute('aria-expanded')).toBe('true');
		fireEvent.pointerMove(moveItem, { pointerType: 'mouse' });
		const destinationItem = await screen.findByRole('menuitem', { name: 'Destination' });
		const submenu = destinationItem.closest('[data-slot="dropdown-menu-sub-content"]');
		expect(submenu?.getAttribute('data-side')).toBe('right');
		expect(submenu?.getAttribute('data-align')).toBe('start');
		expect(submenu?.getAttribute('data-story-block-action-submenu-offset')).toBe('5');
		expect(submenu?.getAttribute('data-story-block-action-submenu-align-offset')).toBe('-4');
		expect(submenu?.classList.contains('border-border/50')).toBe(true);
		expect(submenu?.classList.contains('shadow-xl')).toBe(true);
		expect(destinationItem.getAttribute('role')).toBe('menuitem');
		for (const className of ['rounded-sm', 'py-0.5', 'pr-2', 'pl-2', 'text-sm', 'font-normal', 'leading-5']) {
			expect(destinationItem.classList.contains(className)).toBe(true);
		}
		for (const className of ['py-1', 'py-2', 'pr-8', 'text-xs', 'font-medium', 'leading-none']) {
			expect(destinationItem.classList.contains(className)).toBe(false);
		}
		fireEvent.click(destinationItem);

		await waitFor(() => {
			expect(screen.getByText('Chart q1').closest('.nao-block-selected')).not.toBeNull();
		});
		expect(scrollIntoView).toHaveBeenCalledWith({ block: 'center', behavior: 'smooth' });

		const tabs = readSnapshotTabs();
		expect(tabs?.[0].innerCode.trim()).toBe('Before\n\nAfter');
		expect(tabs?.[1].innerCode.trim()).toBe(`Existing\n\n${rawTag}`);
	});

	it('selects and scrolls a chart moved into an empty tab', async () => {
		render(<EditorHarness code={tabbedCode(['Before', '', rawTag], [])} />);

		await openChartMenu();
		await moveToDestinationTab();

		const destinationButton = screen.getByRole('button', { name: 'Destination' });
		await waitFor(() => {
			expect(screen.getByText('Chart q1').closest('.nao-block-selected')).not.toBeNull();
			expect(destinationButton.parentElement?.classList.contains('bg-background')).toBe(true);
		});
		const selectedBlocks = document.querySelectorAll('.ProseMirror > .nao-block-selected');
		const trailingParagraph = document.querySelector('.ProseMirror > p:last-child');
		expect(selectedBlocks).toHaveLength(1);
		expect(trailingParagraph?.textContent).toBe('');
		expect(trailingParagraph?.classList.contains('nao-block-selected')).toBe(false);
		expect(document.activeElement?.classList.contains('ProseMirror')).toBe(true);
		expect(scrollIntoView).toHaveBeenCalledWith({ block: 'center', behavior: 'smooth' });
	});

	it('excludes a trailing empty paragraph when selecting moved heading content', async () => {
		render(<EditorHarness code={tabbedCode(['# Order Trends', '', rawTag], ['Existing'])} />);

		fireEvent.click(screen.getByRole('button', { name: 'Select all blocks' }));
		fireEvent.click(await findInlineBlockGrip());
		await moveToDestinationTab();

		await waitFor(() => {
			expect(screen.getByRole('heading', { name: 'Order Trends' }).closest('.nao-block-selected')).not.toBeNull();
			expect(screen.getByText('Chart q1').closest('.nao-block-selected')).not.toBeNull();
		});
		const selectedBlocks = document.querySelectorAll('.ProseMirror > .nao-block-selected');
		const trailingParagraph = document.querySelector('.ProseMirror > p:last-child');
		expect(selectedBlocks).toHaveLength(2);
		expect(trailingParagraph?.textContent).toBe('');
		expect(trailingParagraph?.classList.contains('nao-block-selected')).toBe(false);
	});

	it('deactivates an editor drop target before moving a single block to a tab', async () => {
		const secondChart = rawTag.replace('q1', 'q2');
		render(<EditorHarness code={tabbedCode([rawTag, '', secondChart], ['Existing'])} />);

		const grips = await screen.findAllByRole('button', { name: 'Move story block' });
		const dataTransfer = createDataTransfer();
		fireEvent.dragStart(grips[0], { dataTransfer });

		const editorDropZone = await waitFor(() => {
			const zone = document.querySelector<HTMLElement>('[data-story-block-drop-zone$=":left"]');
			expect(zone).not.toBeNull();
			return zone as HTMLElement;
		});
		fireEvent.dragOver(editorDropZone, { dataTransfer });
		expect(document.querySelector('.story-editor')?.classList.contains('drop-indicator-active')).toBe(true);
		expect(editorDropZone.firstElementChild?.classList.contains('bg-primary-muted')).toBe(true);

		const destinationButton = screen.getByRole('button', { name: 'Destination' });
		const destinationTab = destinationButton.parentElement as HTMLElement;
		fireEvent.dragOver(destinationTab, { dataTransfer });

		expect(document.querySelectorAll('[data-story-block-drop-target]')).toHaveLength(1);
		expect(document.querySelector('.story-editor')?.classList.contains('drop-indicator-active')).toBe(false);
		expect(document.querySelector('[data-story-block-drop-zone]')).toBeNull();
		expect(document.querySelector('.drop-cursor')).toBeNull();

		fireEvent.drop(destinationTab, { dataTransfer });

		await waitFor(() => {
			expect(screen.getByText('Chart q1').closest('.nao-block-selected')).not.toBeNull();
			expect(destinationButton.parentElement?.classList.contains('bg-background')).toBe(true);
		});
		expect(document.querySelector('[data-story-block-drop-target]')).toBeNull();
		expect(document.querySelector('.story-editor')?.classList.contains('drop-indicator-active')).toBe(false);
		expect(document.querySelector('.drop-cursor')).toBeNull();

		const tabs = readSnapshotTabs();
		expect(tabs?.[0].innerCode.trim()).toBe(secondChart);
		expect(tabs?.[1].innerCode.trim()).toBe(`Existing\n\n${rawTag}`);
	});

	it('clears the tab drop target when a block drag ends', async () => {
		render(<EditorHarness code={tabbedCode([rawTag], ['Existing'])} />);

		const grip = await screen.findByRole('button', { name: 'Move story block' });
		const dataTransfer = createDataTransfer();
		fireEvent.dragStart(grip, { dataTransfer });

		const destinationTab = screen.getByRole('button', { name: 'Destination' }).parentElement as HTMLElement;
		fireEvent.dragOver(destinationTab, { dataTransfer });
		expect(destinationTab.hasAttribute('data-story-block-drop-target')).toBe(true);

		fireEvent.dragEnd(grip, { dataTransfer });

		expect(document.querySelector('[data-story-block-drop-target]')).toBeNull();
		expect(document.querySelector('.story-editor')?.classList.contains('drop-indicator-active')).toBe(false);
	});

	it('moves a mixed multi-selection when dropped on an inactive tab', async () => {
		render(<EditorHarness code={tabbedCode(['Before', '', rawTag, '', 'After'], ['Existing'])} />);

		fireEvent.click(screen.getByRole('button', { name: 'Select all blocks' }));
		const grip = await screen.findByRole('button', { name: 'Move story block' });
		const dataTransfer = createDataTransfer();
		fireEvent.dragStart(grip, { dataTransfer });

		const destinationButton = screen.getByRole('button', { name: 'Destination' });
		const destinationTab = destinationButton.parentElement as HTMLElement;
		fireEvent.dragOver(destinationTab, { dataTransfer });
		expect(destinationTab.hasAttribute('data-story-block-drop-target')).toBe(true);
		expect(document.querySelector('.ProseMirror')?.textContent).toContain('Before');

		fireEvent.drop(destinationTab, { dataTransfer });

		await waitFor(() => {
			for (const content of ['Before', 'Chart q1', 'After']) {
				expect(screen.getByText(content).closest('.nao-block-selected')).not.toBeNull();
			}
		});
		expect(scrollIntoView).toHaveBeenCalledWith({ block: 'center', behavior: 'smooth' });
		expect(destinationTab.hasAttribute('data-story-block-drop-target')).toBe(false);

		const tabs = readSnapshotTabs();
		expect(tabs?.[0].innerCode.trim()).toBe('');
		expect(tabs?.[1].innerCode.trim()).toBe(['Existing', '', 'Before', '', rawTag, '', 'After'].join('\n'));
	});

	it('moves a generic text block when its floating handle is dropped on an inactive tab', async () => {
		render(<EditorHarness code={tabbedCode(['First paragraph', '', 'Second paragraph'], ['Existing'])} />);

		await withFirstParagraphHovered(async () => {
			const grip = await screen.findByRole('button', { name: 'Move story block' });
			const floatingHandle = grip.closest('.drag-handle') as HTMLElement;
			const dataTransfer = createDataTransfer();
			fireEvent.dragStart(floatingHandle, { dataTransfer });

			const destinationButton = screen.getByRole('button', { name: 'Destination' });
			const destinationTab = destinationButton.parentElement as HTMLElement;
			fireEvent.dragOver(destinationTab, { dataTransfer });
			expect(destinationTab.hasAttribute('data-story-block-drop-target')).toBe(true);
			fireEvent.drop(destinationTab, { dataTransfer });

			await waitFor(() => {
				expect(document.querySelector('.ProseMirror .nao-block-selected')?.textContent).toContain(
					'First paragraph',
				);
			});
			expect(scrollIntoView).toHaveBeenCalledWith({ block: 'center', behavior: 'smooth' });

			const tabs = readSnapshotTabs();
			expect(tabs?.[0].innerCode.trim()).toBe('Second paragraph');
			expect(tabs?.[1].innerCode.trim()).toBe('Existing\n\nFirst paragraph');
		});
	});

	it('moves a mixed multi-selection in order and highlights every destination block', async () => {
		const secondChart = rawTag;
		render(
			<EditorHarness
				code={tabbedCode(['Repeated text', '', rawTag, '', 'Repeated text', '', secondChart], ['Existing'])}
			/>,
		);

		fireEvent.click(screen.getByRole('button', { name: 'Select all blocks' }));
		const grips = await screen.findAllByRole('button', { name: 'Move story block' });
		fireEvent.click(grips[1]);
		await moveToDestinationTab();

		await waitFor(() => {
			expect(screen.getAllByText('Repeated text')).toHaveLength(2);
			expect(screen.getAllByText('Chart q1')).toHaveLength(2);
			for (const content of screen.getAllByText(/^(Repeated text|Chart q1)$/)) {
				expect(content.closest('.nao-block-selected')).not.toBeNull();
			}
		});
		expect(scrollIntoView).toHaveBeenCalledWith({ block: 'center', behavior: 'smooth' });

		const tabs = readSnapshotTabs();
		expect(tabs?.[0].innerCode.trim()).toBe('');
		expect(tabs?.[1].innerCode.trim()).toBe(
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
		expect(readSnapshot().trim()).toBe('Before\n\nAfter');
	});

	it('preserves blank lines inside fenced code when deleting a block', async () => {
		const codeBlock = ['```sql', 'select 1;', '', 'select 2;', '```'].join('\n');
		render(<EditorHarness code={`${codeBlock}\n\n${rawTag}\n\nAfter`} />);

		await openChartMenu();
		fireEvent.click(await screen.findByRole('menuitem', { name: 'Delete' }));

		await waitFor(() => expect(screen.queryByText('Chart q1')).toBeNull());
		expect(readSnapshot().trim()).toBe(`${codeBlock}\n\nAfter`);
	});

	it('preserves a multi-selection when deleting from one selected handle', async () => {
		render(<EditorHarness code={`Before\n\n${rawTag}\n\nAfter`} />);

		fireEvent.click(screen.getByRole('button', { name: 'Select all blocks' }));
		await openChartMenu();
		fireEvent.click(await screen.findByRole('menuitem', { name: 'Delete' }));

		await waitFor(() => expect(screen.queryByText('Chart q1')).toBeNull());
		expect(readSnapshot().trim()).toBe('');
	});

	it('deletes the chart from the editor transaction and hides tab movement without another tab', async () => {
		render(<EditorHarness code={rawTag} />);

		await openChartMenu();
		expect(screen.queryByRole('menuitem', { name: 'Move to a tab' })).toBeNull();
		fireEvent.click(await screen.findByRole('menuitem', { name: 'Delete' }));

		await waitFor(() => expect(screen.queryByText('Chart q1')).toBeNull());
		expect(readSnapshot()).not.toContain(rawTag);
	});
});

function EditorHarness({
	code,
	exposedEditorRef,
}: {
	code: string;
	exposedEditorRef?: MutableRefObject<Editor | null>;
}) {
	const localEditorRef = useRef<Editor | null>(null);
	const editorRef = exposedEditorRef ?? localEditorRef;
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

function createEditorRef() {
	return { current: null } as MutableRefObject<Editor | null>;
}

function tabbedCode(sourceLines: string[], destinationLines: string[]) {
	return [
		'<tab title="Source">',
		...sourceLines,
		'</tab>',
		'',
		'<tab title="Destination">',
		...destinationLines,
		'</tab>',
	].join('\n');
}

function readSnapshot() {
	fireEvent.click(screen.getByRole('button', { name: 'Snapshot' }));
	return screen.getByRole('status').textContent ?? '';
}

function readSnapshotTabs() {
	return parseStoryTabs(readSnapshot());
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

async function moveToDestinationTab() {
	const moveItem = await screen.findByRole('menuitem', { name: 'Move to a tab' });
	fireEvent.pointerMove(moveItem, { pointerType: 'mouse' });
	fireEvent.click(await screen.findByRole('menuitem', { name: 'Destination' }));
}

/** Returns the grip rendered on a selected block, as opposed to the floating gutter handle. */
async function findInlineBlockGrip() {
	const grips = await screen.findAllByRole('button', { name: 'Move story block' });
	const grip = grips.find((candidate) => !candidate.closest('.drag-handle'));
	expect(grip).toBeDefined();
	return grip as HTMLElement;
}

function getBoundaryBlocks() {
	const editorDom = document.querySelector<HTMLElement>('.ProseMirror');
	const firstBlock = editorDom?.firstElementChild;
	const lastBlock = editorDom?.lastElementChild;
	expect(editorDom).not.toBeNull();
	expect(firstBlock).not.toBeNull();
	expect(lastBlock).not.toBeNull();
	return { editorDom: editorDom as HTMLElement, firstBlock: firstBlock as Element, lastBlock: lastBlock as Element };
}

function mockBoundaryBlockRects(firstBlock: Element, firstRect: DOMRect, lastBlock: Element, lastRect: DOMRect) {
	vi.spyOn(firstBlock, 'getBoundingClientRect').mockReturnValue(firstRect);
	vi.spyOn(lastBlock, 'getBoundingClientRect').mockReturnValue(lastRect);
}

async function withFirstParagraphHovered(run: () => Promise<void>) {
	const { editorDom, firstBlock, lastBlock } = getBoundaryBlocks();
	mockBoundaryBlockRects(firstBlock, new DOMRect(0, 0, 500, 40), lastBlock, new DOMRect(0, 50, 500, 40));
	await withElementsFromPoint(
		() => [firstBlock, editorDom],
		async () => {
			fireEvent.mouseMove(editorDom, { clientX: 100, clientY: 20 });
			await run();
		},
	);
}

/** jsdom has no layout, so the drag handle's hit-testing needs a stubbed `document.elementsFromPoint`. */
async function withElementsFromPoint(resolveElements: () => Element[], run: () => Promise<void>) {
	const elementsFromPoint = document.elementsFromPoint;
	Object.defineProperty(document, 'elementsFromPoint', {
		configurable: true,
		value: resolveElements,
	});
	try {
		await run();
	} finally {
		Object.defineProperty(document, 'elementsFromPoint', {
			configurable: true,
			value: elementsFromPoint,
		});
	}
}

function createDataTransfer(): DataTransfer {
	const data = new Map<string, string>();
	const types: string[] = [];
	return {
		dropEffect: 'none',
		effectAllowed: 'none',
		types,
		setData: vi.fn((type: string, value: string) => {
			data.set(type, value);
			if (!types.includes(type)) {
				types.push(type);
			}
		}),
		getData: vi.fn((type: string) => data.get(type) ?? ''),
		clearData: vi.fn((type?: string) => {
			if (type) {
				data.delete(type);
				const index = types.indexOf(type);
				if (index >= 0) {
					types.splice(index, 1);
				}
				return;
			}
			data.clear();
			types.splice(0);
		}),
		setDragImage: vi.fn(),
	} as unknown as DataTransfer;
}
