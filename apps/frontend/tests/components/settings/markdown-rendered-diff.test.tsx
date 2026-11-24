// @vitest-environment jsdom

import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { MarkdownRenderedDiff } from '@/components/settings/markdown-rendered-diff';

describe('MarkdownRenderedDiff', () => {
	afterEach(cleanup);

	it('highlights the added words and shows the removed ones where they were', () => {
		render(
			<MarkdownRenderedDiff
				oldMarkdown={'Net revenue excludes refunds.\n\n- one\n- two\n\nOld paragraph.\n'}
				newMarkdown={'Net revenue excludes refunds and taxes.\n\n- one\n- three\n'}
			/>,
		);

		expect(getTexts('.markdown-diff-added')).toEqual([' and taxes', 'three']);
		expect(getTexts('.markdown-diff-removed:not(.markdown-diff-removed-block)')).toEqual(['two']);
		expect(getTexts('.markdown-diff-removed-block')).toEqual(['Old paragraph.']);
	});

	it('highlights a whole added block as a block', () => {
		render(<MarkdownRenderedDiff oldMarkdown={'# Orders\n'} newMarkdown={'# Orders\n\nOne row per order.\n'} />);

		expect(getTexts('.markdown-diff-added-block')).toEqual(['One row per order.']);
	});
});

function getTexts(selector: string): string[] {
	return [...document.querySelectorAll(selector)].map((element) => element.textContent ?? '');
}
