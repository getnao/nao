// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { selectable } from '@nao/shared/story-parts';

import { configureStoryInspector } from './story-inspector';

const BOX = { top: 100, left: 20, right: 420, bottom: 300, width: 400, height: 200, x: 20, y: 100 } as DOMRect;

describe('story inspector', () => {
	const onAsk = vi.fn();
	const onStoryClick = vi.fn();

	beforeEach(() => {
		document.body.innerHTML = `
			<main>
				<section data-nao-block-kind="bar-chart" data-nao-block-title="Revenue" data-nao-block-query="q1">
					<h3>Revenue</h3>
					<svg>
						<text data-nao-part="axis-tick" data-nao-part-label="">Feb</text>
						<rect data-nao-part="data-point" data-nao-part-series="revenue" data-nao-part-category="2018-02" data-nao-part-value="26"></rect>
						<text data-nao-part="axis-tick"> </text>
					</svg>
				</section>
				<p data-nao-part="title">Loose</p>
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
			hover(document.querySelector('h3')!);
			document.querySelector('h3')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));

			expect(outline().hidden).toBe(false);
			expect(onAsk).toHaveBeenCalledWith({
				block: { kind: 'bar-chart', title: 'Revenue', queryId: 'q1' },
				text: 'Revenue',
			});
			expect(onStoryClick).not.toHaveBeenCalled();
		});

		it('cites the part under the pointer', () => {
			document.querySelector('text')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));

			expect(onAsk).toHaveBeenCalledWith({
				block: {
					kind: 'bar-chart',
					title: 'Revenue',
					queryId: 'q1',
					part: { kind: 'axis-tick', label: 'Feb' },
				},
				text: 'Feb',
			});
		});

		it('cites a data point with its identity', () => {
			document.querySelector('rect')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));

			expect(onAsk).toHaveBeenCalledWith({
				block: {
					kind: 'bar-chart',
					title: 'Revenue',
					queryId: 'q1',
					part: { kind: 'data-point', series: 'revenue', category: '2018-02', value: '26' },
				},
				text: '2018-02',
			});
		});

		it('quotes what a KPI value or a table cell shows rather than its label', () => {
			document.querySelector('section')!.insertAdjacentHTML(
				'beforeend',
				`<span data-nao-part="kpi-value" data-nao-part-label="Total revenue" data-nao-part-value="$1,103">$1,103</span>
				<span data-nao-part="kpi-comparison" data-nao-part-label="vs last month" data-nao-part-value="+12%">+12%</span>
				<span data-nao-part="cell" data-nao-part-label="Amount" data-nao-part-category="Alice" data-nao-part-value="20">20</span>
				<span data-nao-part="cell" data-nao-part-label="Name" data-nao-part-category="Bob"></span>`,
			);

			for (const span of document.querySelectorAll('span[data-nao-part]')) {
				span.dispatchEvent(new MouseEvent('click', { bubbles: true }));
			}

			expect(onAsk.mock.calls.map(([ask]) => ask.text)).toEqual(['$1,103', '+12%', '20', 'Name']);
		});

		it('cites the block from its frame', () => {
			document.querySelector('section')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));

			const { block } = onAsk.mock.calls[0]![0];
			expect(block).toEqual({ kind: 'bar-chart', title: 'Revenue', queryId: 'q1' });
			expect(block).not.toHaveProperty('part');
		});

		it('keeps a long multi-line part label on one short line', () => {
			const description = document.createElement('p');
			description.dataset.naoPart = 'description';
			description.textContent = `First line\n   ${'long '.repeat(100)}`;
			document.querySelector('section')!.append(description);

			description.dispatchEvent(new MouseEvent('click', { bubbles: true }));

			const { block, text } = onAsk.mock.calls[0]![0];
			expect(block.part.label).not.toMatch(/\s{2}|\n/);
			expect(block.part.label.length).toBeLessThanOrEqual(200);
			expect(text).toBe(block.part.label);
		});

		it('ignores a part with no label', () => {
			document.querySelectorAll('text')[1]!.dispatchEvent(new MouseEvent('click', { bubbles: true }));

			const { block } = onAsk.mock.calls[0]![0];
			expect(block).toEqual({ kind: 'bar-chart', title: 'Revenue', queryId: 'q1' });
			expect(block).not.toHaveProperty('part');
		});

		it('ignores a part outside a block', () => {
			document.querySelector('p[data-nao-part]')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));

			expect(onAsk).toHaveBeenCalledWith({ block: { kind: 'text' }, text: 'Loose' });
		});

		it('cites a selectable element of the story by its name and detail, inside a kit block or not', () => {
			const card = document.createElement('div');
			setAttributes(card, selectable({ name: 'Card', detail: '7 of hearts' }));
			card.innerHTML = '<p>7♥</p>';
			document.querySelector('main')!.append(card);
			const undo = document.createElement('button');
			setAttributes(undo, selectable({ name: 'Undo' }));
			document.querySelector('section')!.append(undo);

			card.querySelector('p')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
			undo.dispatchEvent(new MouseEvent('click', { bubbles: true }));

			expect(onAsk.mock.calls.map(([ask]) => ask)).toEqual([
				{
					block: { kind: 'element', part: { kind: 'element', label: 'Card', value: '7 of hearts' } },
					text: 'Card · 7 of hearts',
				},
				{
					block: {
						kind: 'bar-chart',
						title: 'Revenue',
						queryId: 'q1',
						part: { kind: 'element', label: 'Undo' },
					},
					text: 'Undo',
				},
			]);
		});

		it('quotes a text block with its text', () => {
			document.querySelector('b')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));

			expect(onAsk).toHaveBeenCalledWith({ block: { kind: 'text' }, text: 'Sales dropped in March.' });
		});
	});
});

function setAttributes(element: Element, attributes: Record<string, string>) {
	for (const [name, value] of Object.entries(attributes)) {
		element.setAttribute(name, value);
	}
}

function hover(target: Element) {
	target.dispatchEvent(new Event('pointerover', { bubbles: true }));
}

function outline(): HTMLElement {
	return document.querySelector('nao-story-inspector')!.shadowRoot!.querySelector('.outline')!;
}
