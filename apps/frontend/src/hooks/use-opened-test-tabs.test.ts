import { describe, expect, it } from 'vitest';

import { getNeighborTab } from './use-opened-test-tabs';

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
