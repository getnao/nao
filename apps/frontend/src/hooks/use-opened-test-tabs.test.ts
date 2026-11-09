import { describe, expect, it } from 'vitest';

import { getNeighborTab, moveTabOnto } from './use-opened-test-tabs';

describe('getNeighborTab', () => {
	const tabs = ['/tests/a.yml', '/tests/b.yml', '/tests/c.yml'];

	it('opens the next tab when a tab closes', () => {
		expect(getNeighborTab(tabs, '/tests/b.yml')).toBe('/tests/c.yml');
	});

	it('opens the previous tab when the last one closes', () => {
		expect(getNeighborTab(tabs, '/tests/c.yml')).toBe('/tests/b.yml');
	});

	it('has no neighbor for the only tab or a tab that is not open', () => {
		expect(getNeighborTab(['/tests/a.yml'], '/tests/a.yml')).toBeNull();
		expect(getNeighborTab(tabs, '/tests/d.yml')).toBeNull();
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
