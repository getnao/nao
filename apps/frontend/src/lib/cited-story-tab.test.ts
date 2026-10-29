import { describe, expect, it } from 'vitest';
import type { StoryTab } from '@nao/shared/story-tabs';

import { findCitedTabIndex } from '@/lib/cited-story-tab';

const TABS: StoryTab[] = [
	{ title: 'Overview', innerCode: 'Revenue is up this quarter.\n\n<table query_id="orders" title="Orders" />' },
	{
		title: 'Details',
		innerCode:
			'Sales in **May** grew by [a fifth](https://example.com) overall.\n\n<chart query_id="sales" chart_type="bar" x_axis_key="month" title="Sales" />',
	},
];

describe('findCitedTabIndex', () => {
	it('finds the tab holding a cited block', () => {
		const block = { kind: 'bar-chart', title: 'Sales', queryId: 'sales' };

		expect(findCitedTabIndex(TABS, { block, text: 'Sales' }, 0)).toBe(1);
	});

	it('finds the tab quoting a passage whose emphasis and links the quote lost', () => {
		const block = { kind: 'text' };

		expect(findCitedTabIndex(TABS, { block, text: 'Sales in May grew by a fifth overall.' }, 0)).toBe(1);
	});

	it('keeps the active tab when it quotes the passage as well as another tab', () => {
		const tabs = [TABS[0], { title: 'Copy', innerCode: TABS[0].innerCode }];

		expect(findCitedTabIndex(tabs, { block: { kind: 'text' }, text: 'Revenue is up' }, 1)).toBe(1);
	});

	it('finds no tab for an element no tab shows', () => {
		expect(findCitedTabIndex(TABS, { block: { kind: 'text' }, text: 'Nowhere to be found' }, 0)).toBeNull();
	});
});
