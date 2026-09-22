import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/db/db', () => ({ db: {} }));

import { isSlackNotInChannelError } from '../src/services/slack';

describe('isSlackNotInChannelError', () => {
	it('recognizes the Slack SDK error code', () => {
		const error = Object.assign(new Error('Slack API request failed'), {
			data: { error: 'not_in_channel' },
		});

		expect(isSlackNotInChannelError(error)).toBe(true);
	});

	it('recognizes the error code in a message', () => {
		expect(isSlackNotInChannelError(new Error('Slack upload failed: NOT_IN_CHANNEL'))).toBe(true);
	});

	it('rejects an unrelated error', () => {
		expect(isSlackNotInChannelError(new Error('rate_limited'))).toBe(false);
	});

	it('rejects null and undefined', () => {
		expect(isSlackNotInChannelError(null)).toBe(false);
		expect(isSlackNotInChannelError(undefined)).toBe(false);
	});

	it('rejects non-error values', () => {
		expect(isSlackNotInChannelError('not_in_channel')).toBe(false);
	});
});
