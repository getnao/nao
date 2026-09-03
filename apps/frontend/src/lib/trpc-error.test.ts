import { describe, expect, it } from 'vitest';

import { isDefinitiveChatError, isRetryableTrpcError } from './trpc-error';

const trpcError = (code: string): { data: { code: string } } => ({ data: { code } });

describe('chat errors', () => {
	it.each(['INTERNAL_SERVER_ERROR', 'BAD_GATEWAY', 'SERVICE_UNAVAILABLE', 'GATEWAY_TIMEOUT', 'TIMEOUT'])(
		'retries the transient %s error',
		(code) => {
			expect(isRetryableTrpcError(trpcError(code))).toBe(true);
		},
	);

	it.each(['BAD_REQUEST', 'UNAUTHORIZED', 'FORBIDDEN', 'NOT_FOUND', 'CONFLICT', 'TOO_MANY_REQUESTS'])(
		'does not retry the %s error',
		(code) => {
			expect(isRetryableTrpcError(trpcError(code))).toBe(false);
		},
	);

	it('retries transport errors', () => {
		expect(isRetryableTrpcError(new Error('Failed to fetch'))).toBe(true);
	});

	it('treats access and missing-chat failures as definitive', () => {
		expect(isDefinitiveChatError(trpcError('NOT_FOUND'))).toBe(true);
		expect(isDefinitiveChatError(trpcError('UNAUTHORIZED'))).toBe(true);
		expect(isDefinitiveChatError(trpcError('FORBIDDEN'))).toBe(true);
		expect(isDefinitiveChatError(trpcError('INTERNAL_SERVER_ERROR'))).toBe(false);
	});
});
