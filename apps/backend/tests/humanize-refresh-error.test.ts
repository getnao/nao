import { APICallError, NoObjectGeneratedError, NoOutputGeneratedError, RetryError } from 'ai';
import { describe, expect, it } from 'vitest';

import { humanizeStoryRefreshError } from '../src/utils/humanize-refresh-error';

describe('humanizeStoryRefreshError', () => {
	it('returns a friendly explanation for NoObjectGeneratedError', () => {
		const err = new NoObjectGeneratedError({
			message: 'No object generated: could not parse the response.',
			response: { id: 'resp-1', timestamp: new Date(0), modelId: 'gpt-6' },
			usage: {
				inputTokens: 0,
				outputTokens: 0,
				totalTokens: 0,
				inputTokenDetails: { noCacheTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
				outputTokenDetails: { textTokens: 0, reasoningTokens: 0 },
			},
			finishReason: 'stop',
		});

		const message = humanizeStoryRefreshError(err);

		expect(message).toContain('could not be parsed into the expected format');
		expect(message).toContain('No object generated: could not parse the response.');
	});

	it('returns a friendly explanation for NoOutputGeneratedError', () => {
		const err = new NoOutputGeneratedError({ message: 'empty output' });

		const message = humanizeStoryRefreshError(err);

		expect(message).toContain('finished without producing any output');
		expect(message).toContain('empty output');
	});

	it('marks APICallError as temporary when the SDK says it is retryable', () => {
		const err = new APICallError({
			message: 'rate limited',
			url: 'https://api.example/chat',
			requestBodyValues: {},
			isRetryable: true,
		});

		const message = humanizeStoryRefreshError(err);

		expect(message).toContain('temporarily unavailable');
		expect(message).toContain('rate limited');
	});

	it('marks APICallError as a rejection when the SDK says it is not retryable', () => {
		const err = new APICallError({
			message: 'invalid api key',
			url: 'https://api.example/chat',
			requestBodyValues: {},
			isRetryable: false,
		});

		const message = humanizeStoryRefreshError(err);

		expect(message).toContain('rejected the request');
		expect(message).toContain('invalid api key');
	});

	it('surfaces RetryError exhaustion', () => {
		const err = new RetryError({
			message: 'failed after 3 attempts',
			reason: 'maxRetriesExceeded',
			errors: [],
		});

		const message = humanizeStoryRefreshError(err);

		expect(message).toContain('failed every retry attempt');
		expect(message).toContain('failed after 3 attempts');
	});

	it('passes through unknown errors unchanged', () => {
		expect(humanizeStoryRefreshError(new Error('Access denied'))).toBe('Access denied');
	});

	it('coerces non-Error values to strings', () => {
		expect(humanizeStoryRefreshError('boom')).toBe('boom');
		expect(humanizeStoryRefreshError({ broken: true })).toBe('[object Object]');
	});

	it('does not double up when the raw message equals the explanation', () => {
		class StubNoObject extends Error {}
		Object.defineProperty(StubNoObject.prototype, 'name', { value: 'NoObjectGeneratedError' });
		const err = new StubNoObject(
			'The model returned a response that could not be parsed into the expected format. This usually resolves on retry; if it keeps happening, the model may be returning malformed output.',
		);
		expect(humanizeStoryRefreshError(err)).toBe(err.message);
	});
});
