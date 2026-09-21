const RETRYABLE_TRPC_ERROR_CODES = new Set([
	'INTERNAL_SERVER_ERROR',
	'BAD_GATEWAY',
	'SERVICE_UNAVAILABLE',
	'GATEWAY_TIMEOUT',
	'TIMEOUT',
]);

interface ChatErrorState {
	error: unknown;
	isError: boolean;
	isLoadingError: boolean;
}

export function isRetryableTrpcError(error: unknown): boolean {
	const code = getTrpcErrorCode(error);
	return code === undefined || RETRYABLE_TRPC_ERROR_CODES.has(code);
}

export function isDefinitiveChatError(error: unknown): boolean {
	const code = getTrpcErrorCode(error);
	return code === 'NOT_FOUND' || code === 'UNAUTHORIZED' || code === 'FORBIDDEN';
}

export function shouldShowChatAccessError(state: ChatErrorState): boolean {
	return state.isLoadingError || (state.isError && isDefinitiveChatError(state.error));
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

export function isInternalServerError(error: unknown): boolean {
	return getTrpcErrorCode(error) === 'INTERNAL_SERVER_ERROR';
}

function getTrpcErrorCode(error: unknown): string | undefined {
	if (typeof error !== 'object' || error === null || !('data' in error)) {
		return undefined;
	}
	const { data } = error as { data?: { code?: string } | null };
	return data?.code ?? undefined;
}
