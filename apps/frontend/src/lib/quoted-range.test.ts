// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';

import { findQuotedRange } from './selection-dom.utils';

describe('findQuotedRange', () => {
	const container = document.createElement('div');
	container.innerHTML = '<p>Is it today?</p><aside>Side panel text</aside><p>Data ends before today, not now.</p>';
	const secondToday = container.textContent!.lastIndexOf('today');

	it('keeps the recorded offsets while they still quote the passage', () => {
		const range = findQuotedRange(container, secondToday, secondToday + 5, 'today')!;

		expect(range.startContainer.parentElement!.textContent).toContain('Data ends');
	});

	it('takes the occurrence nearest to offsets that drifted with the layout', () => {
		const drifted = secondToday - 'Side panel text'.length + 3;

		const range = findQuotedRange(container, drifted, drifted + 5, 'today')!;

		expect(range.toString()).toBe('today');
		expect(range.startContainer.parentElement!.textContent).toContain('Data ends');
	});
});
