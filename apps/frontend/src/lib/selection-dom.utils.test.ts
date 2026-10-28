// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';

import { findQuotedRange, isRangeInIgnoredRegion } from './selection-dom.utils';

describe('findQuotedRange', () => {
	const container = document.createElement('div');
	container.innerHTML = '<p>Is it today?</p><aside>Side panel text</aside><p>Data ends before today, not now.</p>';
	const secondToday = container.textContent!.lastIndexOf('today');

	it('takes the occurrence nearest to offsets that drifted with the layout', () => {
		const drifted = secondToday - 'Side panel text'.length + 3;

		const range = findQuotedRange(container, drifted, drifted + 5, 'today')!;

		expect(range.toString()).toBe('today');
		expect(range.startContainer.parentElement!.textContent).toContain('Data ends');
	});
});

describe('isRangeInIgnoredRegion', () => {
	it('leaves out an ignored region, unless the selection scope is nested in it', () => {
		document.body.innerHTML = `
			<div id="page">
				<p id="story">Revenue dipped in May</p>
				<aside data-selection-ignore>
					<div id="panel"><p id="answer">Because of the price change</p></div>
				</aside>
			</div>`;
		const page = document.getElementById('page')!;
		const panel = document.getElementById('panel')!;

		expect(isRangeInIgnoredRegion(rangeOver('answer'), page)).toBe(true);
		expect(isRangeInIgnoredRegion(rangeOver('story'), page)).toBe(false);
		expect(isRangeInIgnoredRegion(rangeOver('answer'), panel)).toBe(false);
	});
});

function rangeOver(id: string): Range {
	const range = document.createRange();
	range.selectNodeContents(document.getElementById(id)!.firstChild!);
	return range;
}
