import { describe, expect, it } from 'vitest';

import {
	getTrpcErrorCode,
	isDefinitiveChatError,
	isNetworkError,
	isRetryableTrpcError,
	isServiceUnavailableError,
	isTimeoutError,
	isTooManyRequestsError,
} from './trpc-error';

const trpcError = (code: string): { data: { code: string } } => ({ data: { code } });

describe('tRPC error classification', () => {
	it('reads a tRPC error code safely', () => {
		expect(getTrpcErrorCode(trpcError('FORBIDDEN'))).toBe('FORBIDDEN');
		expect(getTrpcErrorCode(new Error('Failed to fetch'))).toBeUndefined();
		expect(getTrpcErrorCode(null)).toBeUndefined();
	});

	it.each(['INTERNAL_SERVER_ERROR', 'BAD_GATEWAY', 'SERVICE_UNAVAILABLE', 'GATEWAY_TIMEOUT', 'TIMEOUT'])(
		'retries the transient %s error',
		(code) => {
			expect(isRetryableTrpcError(trpcError(code))).toBe(true);
		},
	);

	it.each(['BAD_REQUEST', 'UNAUTHORIZED', 'FORBIDDEN', 'NOT_FOUND', 'CONFLICT', 'TOO_MANY_REQUESTS'])(
		'does not retry the definitive %s error',
		(code) => {
			expect(isRetryableTrpcError(trpcError(code))).toBe(false);
		},
	);

	it('retries transport errors without assuming every unknown error is a network error', () => {
		expect(isRetryableTrpcError(new Error('Failed to fetch'))).toBe(true);
		expect(isNetworkError(new Error('Failed to fetch'))).toBe(true);
		expect(isNetworkError(new Error('Unexpected response shape'))).toBe(false);
	});

	it('classifies retryable errors for user-facing messages', () => {
		expect(isTimeoutError(trpcError('TIMEOUT'))).toBe(true);
		expect(isServiceUnavailableError(trpcError('BAD_GATEWAY'))).toBe(true);
		expect(isTooManyRequestsError(trpcError('TOO_MANY_REQUESTS'))).toBe(true);
	});

	it('treats access and missing-chat failures as definitive', () => {
		expect(isDefinitiveChatError(trpcError('NOT_FOUND'))).toBe(true);
		expect(isDefinitiveChatError(trpcError('UNAUTHORIZED'))).toBe(true);
		expect(isDefinitiveChatError(trpcError('FORBIDDEN'))).toBe(true);
		expect(isDefinitiveChatError(trpcError('INTERNAL_SERVER_ERROR'))).toBe(false);
	});
});
