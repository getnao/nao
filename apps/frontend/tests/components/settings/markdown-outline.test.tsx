// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { MarkdownFileEditor } from '@/components/settings/markdown-file-editor';

const SOURCE = ['# Orders', '', 'Intro.', '', '## Columns', '', '### Keys', '', '## Freshness', ''].join('\n');

describe('MarkdownOutline', () => {
	afterEach(cleanup);

	it('lists the H1 and H2 headings of the file in order', () => {
		renderEditor(SOURCE);

		const items = within(screen.getByRole('navigation', { name: 'Outline' })).getAllByRole('button');

		expect(items.map((item) => item.textContent)).toEqual(['Orders', 'Columns', 'Freshness']);
	});

	it.each([
		{ case: 'a single heading', value: '# Orders\n\nIntro.\n' },
		{ case: 'only H3 headings', value: '### Keys\n\n### Grain\n' },
	])('stays hidden for $case', ({ value }) => {
		renderEditor(value);

		expect(screen.queryByRole('navigation', { name: 'Outline' })).toBeNull();
	});

	it.each([
		{ position: 'the top', scrollTop: 0, headingTops: [0, 500, 900], activeTitle: 'Orders' },
		{ position: 'the bottom', scrollTop: 600, headingTops: [-600, -100, 300], activeTitle: 'Freshness' },
	])('marks the section being read at $position of the file', ({ scrollTop, headingTops, activeTitle }) => {
		renderEditor(SOURCE);
		const container = getScrollContainer();
		Object.defineProperty(container, 'scrollHeight', { configurable: true, value: 1000 });
		Object.defineProperty(container, 'clientHeight', { configurable: true, value: 400 });
		container.scrollTop = scrollTop;
		['Orders', 'Columns', 'Freshness'].forEach((name, index) => {
			const heading = screen.getByRole('heading', { name });
			vi.spyOn(heading, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, headingTops[index], 0, 0));
		});

		fireEvent.scroll(container);

		expect(screen.getByRole('button', { current: 'location' }).textContent).toBe(activeTitle);
	});

	it('scrolls the editor to the picked heading', () => {
		renderEditor(SOURCE);
		const heading = screen.getByRole('heading', { name: 'Freshness' });
		const container = getScrollContainer();
		const scrollTo = vi.fn();
		container.scrollTo = scrollTo;
		container.scrollTop = 50;
		vi.spyOn(container, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 100, 0, 0));
		vi.spyOn(heading, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 300, 0, 0));

		fireEvent.click(screen.getByRole('button', { name: 'Freshness' }));

		expect(scrollTo).toHaveBeenCalledWith({ top: 234, behavior: 'smooth' });
	});
});

function renderEditor(value: string) {
	return render(
		<MarkdownFileEditor
			value={value}
			filePath='/docs/orders.md'
			searchQuery=''
			onChange={vi.fn()}
			onSave={vi.fn()}
			fallback={<div />}
		/>,
	);
}

function getScrollContainer(): HTMLElement {
	const container = screen.getByLabelText('Markdown editor').closest<HTMLElement>('.overflow-auto');
	if (!container) {
		throw new Error('Expected the editor scroll container');
	}
	return container;
}
