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
				sharply in March.</p></div>`;
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
});
