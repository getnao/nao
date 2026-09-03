function getTrpcErrorCode(error: unknown): string | undefined {
	if (typeof error !== 'object' || error === null || !('data' in error)) {
		return undefined;
	}
	const { data } = error as { data?: { code?: string } | null };
	return data?.code ?? undefined;
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
