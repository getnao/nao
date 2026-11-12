// @vitest-environment jsdom

import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Editor } from '@tiptap/core';

import { MarkdownFileEditor } from '@/components/settings/markdown-file-editor';

const SOURCE = [
	'# Orders',
	'',
	'Net revenue excludes __refunds__ and *taxes*.',
	'',
	'* first item',
	'* second item',
	'',
	'|column|meaning|',
	'|---|---|',
	'|id|the order id|',
	'',
].join('\n');

describe('MarkdownFileEditor', () => {
	afterEach(cleanup);

	it('rewrites only the block that was edited, keeping how the rest of the file is written', () => {
		const onChange = vi.fn();
		renderEditor({ value: SOURCE, onChange });

		act(() => {
			getEditor().commands.insertContentAt(getBlockEnd('Net revenue'), ' Taxes are local.');
		});

		expect(onChange).toHaveBeenLastCalledWith(
			SOURCE.replace(
				'Net revenue excludes __refunds__ and *taxes*.',
				'Net revenue excludes **refunds** and *taxes*. Taxes are local.',
			),
		);
	});

	it('separates a new block from its neighbors with blank lines', () => {
		const onChange = vi.fn();
		renderEditor({ value: SOURCE, onChange });

		act(() => {
			getEditor().commands.insertContentAt(getBlockEnd('Orders'), {
				type: 'paragraph',
				content: [{ type: 'text', text: 'One row per order.' }],
			});
		});

		expect(onChange).toHaveBeenLastCalledWith(SOURCE.replace('# Orders\n\n', '# Orders\n\nOne row per order.\n\n'));
	});

	it('follows changes made outside of it without reporting them back', () => {
		const onChange = vi.fn();
		const { rerender } = renderEditor({ value: SOURCE, onChange });

		rerender(editorElement({ value: '# Customers\n', onChange }));

		expect(screen.getByRole('heading', { name: 'Customers' })).toBeTruthy();
		expect(onChange).not.toHaveBeenCalled();
	});

	it.each([
		{ markup: 'an HTML comment', value: '<!-- owner: data team -->\n\nText\n' },
		{ markup: 'a link definition', value: 'See [docs].\n\n[docs]: https://example.com\n' },
	])('shows the rendered file instead when it holds $markup, which editing would lose', ({ value }) => {
		renderEditor({ value, onChange: vi.fn() });

		expect(screen.getByTestId('rendered-markdown')).toBeTruthy();
		expect(screen.queryByLabelText('Markdown editor')).toBeNull();
	});
});

function renderEditor(props: { value: string; onChange: (markdown: string) => void }) {
	return render(editorElement(props));
}

function editorElement({ value, onChange }: { value: string; onChange: (markdown: string) => void }) {
	return (
		<MarkdownFileEditor
			value={value}
			filePath='/docs/orders.md'
			searchQuery=''
			onChange={onChange}
			onSave={vi.fn()}
			fallback={<div data-testid='rendered-markdown' />}
		/>
	);
}

function getEditor(): Editor {
	return (document.querySelector('.ProseMirror') as HTMLElement & { editor: Editor }).editor;
}

function getBlockEnd(text: string): number {
	let blockEnd = -1;
	getEditor().state.doc.forEach((node, offset) => {
		if (blockEnd === -1 && node.textContent.startsWith(text)) {
			blockEnd = offset + node.nodeSize - 1;
		}
	});
	return blockEnd;
}
