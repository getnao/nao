import { AISDKError, APICallError, NoObjectGeneratedError, NoOutputGeneratedError, RetryError } from 'ai';

/**
 * Turns an error thrown by the live-story refresh into a message that is safe to
 * surface in a notification email or the activity feed. Recognized Vercel AI SDK
 * errors get a short explanation; the raw message is appended so no debugging
 * detail is lost.
 */
export function humanizeStoryRefreshError(err: unknown): string {
	const raw = extractRawMessage(err);

	if (NoObjectGeneratedError.isInstance(err)) {
		return withDetail(
			'The model returned a response that could not be parsed into the expected format. This usually resolves on retry; if it keeps happening, the model may be returning malformed output.',
			raw,
		);
	}

	if (NoOutputGeneratedError.isInstance(err)) {
		return withDetail('The model finished without producing any output. This usually resolves on retry.', raw);
	}

	if (APICallError.isInstance(err)) {
		const prefix = err.isRetryable
			? 'The model provider is temporarily unavailable.'
			: 'The model provider rejected the request.';
		return withDetail(prefix, raw);
	}

	if (RetryError.isInstance(err)) {
		return withDetail('The model provider failed every retry attempt.', raw);
	}

	if (AISDKError.isInstance(err)) {
		return withDetail('The model provider reported an error.', raw);
	}

	return raw;
}

function extractRawMessage(err: unknown): string {
	if (err instanceof Error) {
		return err.message;
	}
	return String(err);
}

function withDetail(explanation: string, raw: string): string {
	const trimmed = raw.trim();
	if (!trimmed) {
		return explanation;
	}
	return `${explanation} (${trimmed})`;
}
