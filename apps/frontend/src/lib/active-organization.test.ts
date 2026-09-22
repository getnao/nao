// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getActiveOrganizationId, setActiveOrganizationId } from './active-organization';

describe('active organization storage', () => {
	beforeEach(() => {
		const values = new Map<string, string>();
		vi.stubGlobal('localStorage', {
			clear: () => values.clear(),
			getItem: (key: string) => values.get(key) ?? null,
			setItem: (key: string, value: string) => values.set(key, value),
		});
	});

	afterEach(() => vi.unstubAllGlobals());

	it('stores and returns the selected organization', () => {
		setActiveOrganizationId('organization-id');

		expect(getActiveOrganizationId()).toBe('organization-id');
		expect(localStorage.getItem('nao.active-organization-id')).toBe('"organization-id"');
	});

	it('returns null when no organization is selected', () => {
		expect(getActiveOrganizationId()).toBeNull();
	});

	it('ignores invalid saved values', () => {
		localStorage.setItem('nao.active-organization-id', 'not-json');

		expect(getActiveOrganizationId()).toBeNull();
	});
});
