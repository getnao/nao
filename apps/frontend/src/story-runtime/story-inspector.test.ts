// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { configureStoryInspector } from './story-inspector';

const BOX = { top: 100, left: 20, right: 420, bottom: 300, width: 400, height: 200, x: 20, y: 100 } as DOMRect;

describe('story inspector', () => {
	const onAsk = vi.fn();
	const onStoryClick = vi.fn();

	beforeEach(() => {
		document.body.innerHTML = `
			<main>
				<section data-nao-block-kind="bar-chart" data-nao-block-title="Revenue" data-nao-block-query="q1">
					<h3>Revenue</h3><svg><rect></rect></svg>
				</section>
				<p>Sales dropped in <b>March</b>.</p>
				<div>Loose layout</div>
			</main>`;
		document.body.addEventListener('click', onStoryClick);
		vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue(BOX);
	});

	afterEach(() => {
		configureStoryInspector({ onAsk: null, selectsElements: false });
		document.body.removeEventListener('click', onStoryClick);
		onAsk.mockReset();
		onStoryClick.mockReset();
		vi.restoreAllMocks();
	});

	describe('outside selection mode', () => {
		beforeEach(() => configureStoryInspector({ onAsk, selectsElements: false }));

		it('neither highlights nor captures story elements', () => {
			hover(document.querySelector('rect')!);
			document.querySelector('rect')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));

			expect(outline().hidden).toBe(true);
			expect(onAsk).not.toHaveBeenCalled();
			expect(onStoryClick).toHaveBeenCalled();
		});
	});

	describe('in selection mode', () => {
		beforeEach(() => configureStoryInspector({ onAsk, selectsElements: true }));

		it('highlights the whole kit block and quotes it on click instead of letting the story handle it', () => {
			hover(document.querySelector('rect')!);
			document.querySelector('rect')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));

			expect(outline().hidden).toBe(false);
			expect(onAsk).toHaveBeenCalledWith({
				block: { kind: 'bar-chart', title: 'Revenue', queryId: 'q1' },
				text: 'Revenue',
			});
			expect(onStoryClick).not.toHaveBeenCalled();
		});

		it('quotes a text block with its text', () => {
			document.querySelector('b')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));

			expect(onAsk).toHaveBeenCalledWith({ block: { kind: 'text' }, text: 'Sales dropped in March.' });
		});
	});
});

function hover(target: Element) {
	target.dispatchEvent(new Event('pointerover', { bubbles: true }));
}

function outline(): HTMLElement {
	return document.querySelector('nao-story-inspector')!.shadowRoot!.querySelector('.outline')!;
}
