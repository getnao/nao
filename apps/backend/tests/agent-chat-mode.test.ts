import { describe, expect, it } from 'vitest';

import { getChatModeMismatchError } from '../src/services/agent-run';
import { AgentRequestSchema } from '../src/types/chat';

describe('agent chat modes', () => {
	it('accepts explicit example chat requests', () => {
		const request = AgentRequestSchema.parse({ message: { text: 'Show me revenue' }, mode: 'example' });
		expect(request.mode).toBe('example');
	});

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
