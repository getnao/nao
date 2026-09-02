const RETRYABLE_TRPC_ERROR_CODES = new Set([
	'INTERNAL_SERVER_ERROR',
	'BAD_GATEWAY',
	'SERVICE_UNAVAILABLE',
	'GATEWAY_TIMEOUT',
	'TIMEOUT',
]);

export function getTrpcErrorCode(error: unknown): string | undefined {
	if (typeof error !== 'object' || error === null || !('data' in error)) {
		return undefined;
	}
	const { data } = error as { data?: { code?: string } | null };
	return data?.code ?? undefined;
}

export function isRetryableTrpcError(error: unknown): boolean {
	const code = getTrpcErrorCode(error);
	return code === undefined || RETRYABLE_TRPC_ERROR_CODES.has(code);
}

export function isNetworkError(error: unknown): boolean {
	if (getTrpcErrorCode(error) !== undefined || !(error instanceof Error)) {
		return false;
	}
	return /failed to fetch|fetch failed|network(?:error| request failed)|load failed/i.test(error.message);
}

export function isTimeoutError(error: unknown): boolean {
	const code = getTrpcErrorCode(error);
	return code === 'TIMEOUT' || code === 'GATEWAY_TIMEOUT';
}

export function isServiceUnavailableError(error: unknown): boolean {
	const code = getTrpcErrorCode(error);
	return code === 'INTERNAL_SERVER_ERROR' || code === 'BAD_GATEWAY' || code === 'SERVICE_UNAVAILABLE';
}

export function isTooManyRequestsError(error: unknown): boolean {
	return getTrpcErrorCode(error) === 'TOO_MANY_REQUESTS';
}

export function isDefinitiveChatError(error: unknown): boolean {
	const code = getTrpcErrorCode(error);
	return code === 'NOT_FOUND' || code === 'UNAUTHORIZED' || code === 'FORBIDDEN';
}

export function isForbiddenError(error: unknown): boolean {
	return getTrpcErrorCode(error) === 'FORBIDDEN';
}

export function isNotFoundError(error: unknown): boolean {
	return getTrpcErrorCode(error) === 'NOT_FOUND';
}

export function isUnauthorizedError(error: unknown): boolean {
	return getTrpcErrorCode(error) === 'UNAUTHORIZED';
}
