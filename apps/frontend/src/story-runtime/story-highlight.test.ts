// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { highlightStoryElement } from './story-highlight';

describe('highlightStoryElement', () => {
	const scrolled: Element[] = [];

	beforeEach(() => {
		document.body.innerHTML = `
			<section data-nao-block-kind="bar-chart" data-nao-block-title="Revenue" data-nao-block-query="q1"><h3>Revenue</h3></section>
			<section data-nao-block-kind="bar-chart" data-nao-block-title="Orders" data-nao-block-query="q2"><h3>Orders</h3></section>
			<div><p id="passage">Sales dropped
				sharply in March.</p></div>
			<div><h2 id="churn-title">Churn</h2><p>Customers left in May.</p></div>`;
		Element.prototype.scrollIntoView = vi.fn(function (this: Element) {
			scrolled.push(this);
		});
	});

	afterEach(() => {
		scrolled.length = 0;
	});

	it('brings the cited kit block into view', () => {
		highlightStoryElement({ block: { kind: 'bar-chart', title: 'Orders', queryId: 'q2' }, text: 'Orders' });

		expect(scrolled.map((element) => element.getAttribute('data-nao-block-title'))).toEqual(['Orders']);
	});

	it('finds the smallest element quoting a passage, whatever its line breaks', () => {
		highlightStoryElement({ block: { kind: 'text' }, text: 'Sales dropped sharply in March.' });

		expect(scrolled.map((element) => element.id)).toEqual(['passage']);
	});

	it('finds where a quote spanning two blocks starts', () => {
		highlightStoryElement({ block: { kind: 'text' }, text: 'Churn Customers left in May.' });

		expect(scrolled.map((element) => element.id)).toEqual(['churn-title']);
	});

	it('waits for a cited passage rather than outlining an element sharing its first word', async () => {
		highlightStoryElement({ block: { kind: 'text' }, text: 'Sales grew in June across regions.' });
		expect(scrolled).toEqual([]);

		document.body.insertAdjacentHTML('beforeend', '<p id="growth">Sales grew in June across regions.</p>');

		await vi.waitFor(() => expect(scrolled.map((element) => element.id)).toEqual(['growth']));
	});

	it('outlines the selectable element whose detail was cited, outside any kit block', () => {
		document.body.insertAdjacentHTML(
			'beforeend',
			`<div id="six" data-nao-part="element" data-nao-part-label="Card" data-nao-part-value="6 of hearts">6♥</div>
			<div id="seven" data-nao-part="element" data-nao-part-label="Card" data-nao-part-value="7 of hearts">7♥</div>`,
		);

		highlightStoryElement({
			block: { kind: 'element', part: { kind: 'element', label: 'Card', value: '7 of hearts' } },
			text: 'Card · 7 of hearts',
		});

		expect(scrolled.map((element) => element.id)).toEqual(['seven']);
	});

	it('waits for a cited block the story has not rendered yet', async () => {
		highlightStoryElement({ block: { kind: 'kpi', title: 'Margin', queryId: 'q3' }, text: 'Margin' });
		expect(scrolled).toEqual([]);

		document.body.insertAdjacentHTML(
			'beforeend',
			'<section data-nao-block-kind="kpi" data-nao-block-title="Margin" data-nao-block-query="q3"></section>',
		);

		await vi.waitFor(() =>
			expect(scrolled.map((element) => element.getAttribute('data-nao-block-title'))).toEqual(['Margin']),
		);
	});

	describe('a cited part', () => {
		const block = { kind: 'bar-chart', title: 'Revenue', queryId: 'q1' };

		beforeEach(() => {
			document.body.innerHTML = `
				<section data-nao-block-kind="bar-chart" data-nao-block-title="Revenue" data-nao-block-query="q1">
					<svg><rect data-nao-part="data-point" data-nao-part-series="revenue" data-nao-part-category="2018-02" data-nao-part-value="26"></rect></svg>
				</section>`;
		});

		it('outlines the cited part', () => {
			const rect = document.querySelector('rect')!;
			rect.getBoundingClientRect = () => ({ top: 50, left: 30, width: 10, height: 20 }) as DOMRect;

			highlightStoryElement({
				block: { ...block, part: { kind: 'data-point', series: 'revenue', category: '2018-02' } },
				text: 'Revenue',
			});

			expect(scrolled).toEqual([rect]);
			const box = document.body.lastElementChild as HTMLElement;
			expect([box.style.top, box.style.left, box.style.width, box.style.height]).toEqual([
				'46px',
				'26px',
				'18px',
				'28px',
			]);
		});

		describe('not rendered yet', () => {
			const laterPart = { kind: 'data-point' as const, series: 'revenue', category: '2019-01' };

			beforeEach(() => {
				vi.useFakeTimers({
					toFake: [
						'setTimeout',
						'clearTimeout',
						'requestAnimationFrame',
						'cancelAnimationFrame',
						'performance',
					],
				});
			});

			afterEach(() => {
				vi.useRealTimers();
			});

			it('waits for the cited part rather than settling on its block', async () => {
				highlightStoryElement({ block: { ...block, part: laterPart }, text: 'Revenue' });
				expect(scrolled).toEqual([]);

				document
					.querySelector('svg')!
					.insertAdjacentHTML(
						'beforeend',
						'<rect id="later" data-nao-part="data-point" data-nao-part-series="revenue" data-nao-part-category="2019-01"></rect>',
					);
				await vi.advanceTimersByTimeAsync(50);

				expect(scrolled.map((element) => element.id)).toEqual(['later']);
			});

			it('falls back to the block once the part is still missing after a grace period', async () => {
				highlightStoryElement({ block: { ...block, part: laterPart }, text: 'Revenue' });

				await vi.advanceTimersByTimeAsync(999);
				expect(scrolled).toEqual([]);

				await vi.advanceTimersByTimeAsync(1);
				expect(scrolled).toEqual([document.querySelector('section')]);
			});

			it('starts the grace period once the block appears', async () => {
				const section = document.querySelector('section')!;
				section.remove();
				highlightStoryElement({ block: { ...block, part: laterPart }, text: 'Revenue' });

				await vi.advanceTimersByTimeAsync(500);
				document.body.append(section);
				await vi.advanceTimersByTimeAsync(999);
				expect(scrolled).toEqual([]);

				await vi.advanceTimersByTimeAsync(20);
				expect(scrolled).toEqual([section]);
			});

			it('settles on the block when the wait ends during its grace period', async () => {
				const section = document.querySelector('section')!;
				section.remove();
				highlightStoryElement({ block: { ...block, part: laterPart }, text: 'Revenue' });

				await vi.advanceTimersByTimeAsync(7800);
				document.body.append(section);
				await vi.advanceTimersByTimeAsync(220);

				expect(scrolled).toEqual([section]);
			});
		});

		it('still finds a cited cell whose value changed after a refresh', () => {
			document.body.innerHTML = `
				<section data-nao-block-kind="data-table" data-nao-block-title="Orders">
					<table><tr>
						<td id="first" data-nao-part="cell" data-nao-part-series="amount" data-nao-part-category="Alice" data-nao-part-value="10">10</td>
						<td id="second" data-nao-part="cell" data-nao-part-series="amount" data-nao-part-category="Bob" data-nao-part-value="35">35</td>
					</tr></table>
				</section>`;

			highlightStoryElement({
				block: {
					kind: 'data-table',
					title: 'Orders',
					part: { kind: 'cell', series: 'amount', category: 'Bob', value: '30' },
				},
				text: '30',
			});

			expect(scrolled.map((element) => element.id)).toEqual(['second']);
		});
	});
});
