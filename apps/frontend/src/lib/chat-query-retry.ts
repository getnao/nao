import { isRetryableTrpcError } from './trpc-error';

const RETRY_DELAYS = [150, 400, 1_000];

export function shouldRetryChatQuery(failureCount: number, error: unknown): boolean {
	return failureCount < RETRY_DELAYS.length && isRetryableTrpcError(error);
}

export function getChatQueryRetryDelay(attemptIndex: number): number {
	return RETRY_DELAYS[Math.min(attemptIndex, RETRY_DELAYS.length - 1)];
}
