import { describe, expect, it } from 'vitest';

import { getTabShownAfterClosing, moveTabOnto } from '@/hooks/use-opened-tabs';

describe('getTabShownAfterClosing', () => {
	const tabs = ['/a.md', '/b.md', '/c.md', '/d.md'];

	it.each([
		{ case: 'keeps the shown tab when it stays open', closed: ['/a.md'], shown: '/b.md', expected: '/b.md' },
		{ case: 'shows the next tab when the shown one closes', closed: ['/b.md'], shown: '/b.md', expected: '/c.md' },
		{
			case: 'skips the next tabs that close with it',
			closed: ['/b.md', '/c.md'],
			shown: '/b.md',
			expected: '/d.md',
		},
		{
			case: 'shows the previous tab when no tab after it stays open',
			closed: ['/c.md', '/d.md'],
			shown: '/c.md',
			expected: '/b.md',
		},
		{ case: 'shows nothing when every tab closes', closed: tabs, shown: '/a.md', expected: null },
		{ case: 'shows nothing for a tab that is not open', closed: ['/e.md'], shown: '/e.md', expected: null },
	])('$case', ({ closed, shown, expected }) => {
		expect(getTabShownAfterClosing(tabs, closed, shown)).toBe(expected);
	});
});

describe('moveTabOnto', () => {
	const tabs = ['/tests/a.yml', '/tests/b.yml', '/tests/c.yml'];

	it('moves a tab forward or backward to the place of the tab it is dropped on', () => {
		expect(moveTabOnto(tabs, '/tests/a.yml', '/tests/c.yml')).toEqual([
			'/tests/b.yml',
			'/tests/c.yml',
			'/tests/a.yml',
		]);
		expect(moveTabOnto(tabs, '/tests/c.yml', '/tests/a.yml')).toEqual([
			'/tests/c.yml',
			'/tests/a.yml',
			'/tests/b.yml',
		]);
	});

	it('keeps the order when a tab is dropped on itself or on a tab that is not open', () => {
		expect(moveTabOnto(tabs, '/tests/b.yml', '/tests/b.yml')).toBe(tabs);
		expect(moveTabOnto(tabs, '/tests/b.yml', '/tests/d.yml')).toBe(tabs);
	});
});
