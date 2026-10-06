import { describe, expect, it } from 'vitest';

import { getChatModeMismatchError } from '../src/routes/agent';

describe('agent chat modes', () => {
	it('allows only requests that match the existing chat mode', () => {
		expect(getChatModeMismatchError(false, false)).toBeNull();
		expect(getChatModeMismatchError(true, true)).toBeNull();
		expect(getChatModeMismatchError(true, false)).toBe(
			'Regular conversations cannot be continued through onboarding',
		);
		expect(getChatModeMismatchError(false, true)).toBe(
			'Onboarding conversations must be continued through onboarding',
		);
	});
});
