import { afterEach, describe, expect, it, vi } from 'vitest';

import { randomUUID } from '../src/utils';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('randomUUID', () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('builds unique v4 UUIDs when crypto.randomUUID is missing, as on plain HTTP', () => {
		const getRandomValues = crypto.getRandomValues.bind(crypto);
		vi.stubGlobal('crypto', { getRandomValues });

		const uuids = Array.from({ length: 100 }, () => randomUUID());

		expect(uuids.every((uuid) => UUID_V4.test(uuid))).toBe(true);
		expect(new Set(uuids).size).toBe(uuids.length);
	});
});
