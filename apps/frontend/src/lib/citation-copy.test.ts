// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';
import { toCopiedText } from './citation-mention';
import type { CitationData } from '@nao/shared/types';

const CITATION: CitationData = { start: 0, end: 0, text: 'Sales dropped\nin March' };

describe('copying a prompt with citation pills', () => {
	it('reads each citation pill as its quote and keeps other mentions in prompt form', () => {
		const fragment = document
			.createRange()
			.createContextualFragment(
				'why <span data-mention-trigger="❝" data-mention-id="c1" data-mention="“Sales…”"><span>icon</span>“Sales…”</span>' +
					' with <span data-mention-trigger="@" data-mention-id="story:s1" data-mention="Orders">Orders</span>?',
			);

		const text = toCopiedText(fragment, (id) => (id === 'c1' ? CITATION : undefined));

		expect(text).toBe('why “Sales dropped in March” with @[story:s1]?');
	});
});
