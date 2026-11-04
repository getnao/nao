import { beforeEach, describe, expect, it, vi } from 'vitest';

import { shouldReload } from './stale-chunk-reload';

const stored = new Map<string, string>();

beforeEach(() => {
	stored.clear();
	vi.stubGlobal('sessionStorage', {
		getItem: (key: string) => stored.get(key) ?? null,
		setItem: (key: string, value: string) => {
			stored.set(key, value);
		},
	});
});

describe('shouldReload', () => {
	it('reloads on the first stale chunk error', () => {
		expect(shouldReload(1_000)).toBe(true);
	});

	it('does not reload again right after a reload', () => {
		shouldReload(1_000);
		expect(shouldReload(5_000)).toBe(false);
	});

	it('reloads again once the interval has passed', () => {
		shouldReload(1_000);
		expect(shouldReload(12_000)).toBe(true);
	});

	it('reloads when session storage is unavailable', () => {
		vi.stubGlobal('sessionStorage', {
			getItem: () => {
				throw new Error('denied');
			},
			setItem: () => {
				throw new Error('denied');
			},
		});
		expect(shouldReload(1_000)).toBe(true);
	});
});
