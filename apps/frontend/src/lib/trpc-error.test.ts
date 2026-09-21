import { describe, expect, it } from 'vitest';

import { isRetryableTrpcError, shouldShowChatAccessError } from './trpc-error';

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

	it('shows an error when the initial chat load fails', () => {
		expect(
			shouldShowChatAccessError({
				error: new Error('Failed to fetch'),
				isError: true,
				isLoadingError: true,
			}),
		).toBe(true);
	});

	it('keeps cached chat data visible when a background refresh fails', () => {
		expect(
			shouldShowChatAccessError({
				error: new Error('Failed to fetch'),
				isError: true,
				isLoadingError: false,
			}),
		).toBe(false);
	});

	it.each(['NOT_FOUND', 'UNAUTHORIZED', 'FORBIDDEN'])('shows the definitive %s error over cached data', (code) => {
		expect(
			shouldShowChatAccessError({
				error: trpcError(code),
				isError: true,
				isLoadingError: false,
			}),
		).toBe(true);
	});
});
