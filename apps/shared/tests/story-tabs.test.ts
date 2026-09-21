import { describe, expect, it } from 'vitest';

import {
	addStoryTab,
	appendBlockToStoryCode,
	deleteStoryTab,
	flattenStoryTabs,
	moveStoryTab,
	parseStoryTabs,
	renameStoryTab,
	replaceStoryTabInner,
	stripStoryTabsMarkup,
} from '../src/story-tabs';
import { validateStoryCode } from '../src/story-validation';

const storyCode = [
	'<tab title="Overview">',
	'# Overview',
	'</tab>',
	'',
	'<tab title="Details">',
	'<table query_id="details" title="Details" />',
	'</tab>',
	'',
	'<tab title="Notes">',
	'Some notes.',
	'</tab>',
].join('\n');

describe('story tabs', () => {
	it('returns null for non-tabbed code', () => {
		expect(parseStoryTabs('# Story\n\nContent')).toBeNull();
		expect(parseStoryTabs('<table query_id="details" />')).toBeNull();
	});

	it('returns an empty array while the first tab is streaming', () => {
		expect(parseStoryTabs('<tab title="Overview">\n# Overview')).toEqual([]);
	});

	it('parses titles and inner code', () => {
		expect(parseStoryTabs(storyCode)).toEqual([
			{ title: 'Overview', innerCode: '\n# Overview\n' },
			{ title: 'Details', innerCode: '\n<table query_id="details" title="Details" />\n' },
			{ title: 'Notes', innerCode: '\nSome notes.\n' },
		]);
	});

	it('strips complete and partial tab markup', () => {
		expect(stripStoryTabsMarkup(storyCode)).not.toMatch(/<\/?tab\b/);
		expect(stripStoryTabsMarkup(storyCode)).toContain('<table query_id="details" title="Details" />');
		expect(stripStoryTabsMarkup('<tab title="Overview">\n## Overview\nhi')).toBe('\n## Overview\nhi');
		expect(stripStoryTabsMarkup('# Story\n\nContent')).toBe('# Story\n\nContent');
	});

	it('renames only the target tab and round-trips escaped attributes', () => {
		const renamed = renameStoryTab(storyCode, 1, 'Revenue "North" \\ FY26');

		expect(parseStoryTabs(renamed)?.map((tab) => tab.title)).toEqual([
			'Overview',
			'Revenue "North" \\ FY26',
			'Notes',
		]);
		expect(parseStoryTabs(renamed)?.[1].innerCode).toBe(parseStoryTabs(storyCode)?.[1].innerCode);
		expect(validateStoryCode(renamed)).toEqual([]);
	});

	it('replaces only the target tab inner content', () => {
		const replacement = '## Updated details\n\n<chart query_id="updated" title="Updated" />';
		const replaced = replaceStoryTabInner(storyCode, 1, replacement);
		const tabs = parseStoryTabs(replaced);

		expect(tabs?.map((tab) => tab.title)).toEqual(['Overview', 'Details', 'Notes']);
		expect(tabs?.[0].innerCode).toBe(parseStoryTabs(storyCode)?.[0].innerCode);
		expect(tabs?.[1].innerCode.trim()).toBe(replacement.trim());
		expect(tabs?.[2].innerCode).toBe(parseStoryTabs(storyCode)?.[2].innerCode);
		expect(replaced).toContain('<tab title="Details">');
	});

	describe('appendBlockToStoryCode', () => {
		const block = '<table query_id="appended" />';

		it('appends to non-tabbed code', () => {
			const result = appendBlockToStoryCode('# Story\n\nContent', '<chart query_id="q" />', {
				usingVisibleStory: true,
				activeTabIndex: 0,
			});

			expect(result).toEqual({
				code: '# Story\n\nContent\n\n<chart query_id="q" />',
				tabIndex: 0,
			});
		});

		it('appends to the active visible tab only', () => {
			const originalTabs = parseStoryTabs(storyCode);
			const result = appendBlockToStoryCode(storyCode, block, {
				usingVisibleStory: true,
				activeTabIndex: 1,
			});
			const tabs = parseStoryTabs(result.code);

			expect(result.tabIndex).toBe(1);
			expect(tabs?.[0].innerCode).toBe(originalTabs?.[0].innerCode);
			expect(tabs?.[1].innerCode.trim()).toBe(`${originalTabs?.[1].innerCode.trim()}\n\n${block}`);
			expect(tabs?.[2].innerCode).toBe(originalTabs?.[2].innerCode);
			expect(validateStoryCode(result.code)).toEqual([]);
		});

		it('clamps an out-of-range visible tab index to the last tab', () => {
			const result = appendBlockToStoryCode(storyCode, block, {
				usingVisibleStory: true,
				activeTabIndex: 99,
			});
			const tabs = parseStoryTabs(result.code);

			expect(result.tabIndex).toBe(2);
			expect(tabs?.[2].innerCode).toContain(block);
			expect(validateStoryCode(result.code)).toEqual([]);
		});

		it('targets the last tab when the story is not visible', () => {
			const result = appendBlockToStoryCode(storyCode, block, {
				usingVisibleStory: false,
				activeTabIndex: 0,
			});
			const tabs = parseStoryTabs(result.code);

			expect(result.tabIndex).toBe(2);
			expect(tabs?.[2].innerCode).toContain(block);
			expect(validateStoryCode(result.code)).toEqual([]);
		});

		it('appends to an empty tab without a leading blank line', () => {
			const emptyTabCode = '<tab title="A">\n\n</tab>';
			const result = appendBlockToStoryCode(emptyTabCode, block, {
				usingVisibleStory: true,
				activeTabIndex: 0,
			});
			const tabs = parseStoryTabs(result.code);

			expect(result.tabIndex).toBe(0);
			expect(tabs?.[0].innerCode.trim()).toBe(block);
			expect(validateStoryCode(result.code)).toEqual([]);
		});
	});

	it('deletes the selected tab', () => {
		const deleted = deleteStoryTab(storyCode, 1);

		expect(parseStoryTabs(deleted)?.map((tab) => tab.title)).toEqual(['Overview', 'Notes']);
		expect(deleted).not.toContain('query_id="details"');
		expect(validateStoryCode(deleted)).toEqual([]);
	});

	it('moves tabs using array order', () => {
		const moved = moveStoryTab(storyCode, 0, 2);

		expect(parseStoryTabs(moved)?.map((tab) => tab.title)).toEqual(['Details', 'Notes', 'Overview']);
		expect(validateStoryCode(moved)).toEqual([]);
	});

	it('appends a titled empty tab', () => {
		const added = addStoryTab(storyCode);
		const tabs = parseStoryTabs(added);

		expect(tabs?.at(-1)).toEqual({ title: 'New tab', innerCode: '\n\n' });
		expect(validateStoryCode(added)).toEqual([]);
	});

	it('flattens tabs into titled markdown sections', () => {
		expect(flattenStoryTabs(storyCode)).toBe(
			[
				'## Overview',
				'',
				'# Overview',
				'',
				'## Details',
				'',
				'<table query_id="details" title="Details" />',
				'',
				'## Notes',
				'',
				'Some notes.',
			].join('\n'),
		);
		expect(flattenStoryTabs('# Story\n\nContent')).toBe('# Story\n\nContent');
		expect(flattenStoryTabs('<tab title="Overview">\nStreaming')).toBe('<tab title="Overview">\nStreaming');
	});

	it('leaves code unchanged for out-of-range indices', () => {
		expect(renameStoryTab(storyCode, 9, 'Missing')).toBe(storyCode);
		expect(deleteStoryTab(storyCode, -1)).toBe(storyCode);
		expect(moveStoryTab(storyCode, 9, 0)).toBe(storyCode);
		expect(replaceStoryTabInner(storyCode, 9, 'Missing')).toBe(storyCode);
	});
});
