import { describe, expect, it } from 'vitest';

import { getChatQueryRetryDelay, shouldRetryChatQuery } from './chat-query-retry';

const trpcError = (code: string): { data: { code: string } } => ({ data: { code } });

describe('chat query retry policy', () => {
	it('retries a transient failure three times', () => {
		expect(shouldRetryChatQuery(0, new Error('Failed to fetch'))).toBe(true);
		expect(shouldRetryChatQuery(1, new Error('Failed to fetch'))).toBe(true);
		expect(shouldRetryChatQuery(2, new Error('Failed to fetch'))).toBe(true);
		expect(shouldRetryChatQuery(3, new Error('Failed to fetch'))).toBe(false);
	});

	it('does not retry definitive failures', () => {
		expect(shouldRetryChatQuery(0, trpcError('NOT_FOUND'))).toBe(false);
		expect(shouldRetryChatQuery(0, trpcError('UNAUTHORIZED'))).toBe(false);
		expect(shouldRetryChatQuery(0, trpcError('FORBIDDEN'))).toBe(false);
	});

	it('uses short bounded retry delays', () => {
		expect([0, 1, 2, 3].map(getChatQueryRetryDelay)).toEqual([150, 400, 1_000, 1_000]);
	});
});
