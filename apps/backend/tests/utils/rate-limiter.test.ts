import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ reportSecuritySignal: vi.fn() }));

vi.mock('../../src/utils/security-signal', () => ({ reportSecuritySignal: mocks.reportSecuritySignal }));

import { env } from '../../src/env';
import { consumeRateLimit, RATE_LIMITS, RateLimitExceededError, resetRateLimits } from '../../src/utils/rate-limiter';

const { max, windowMs } = RATE_LIMITS.agent;
const originalMode = env.NAO_RATE_LIMIT_MODE;

describe('consumeRateLimit', () => {
	beforeEach(() => {
		vi.useFakeTimers();
		resetRateLimits();
		mocks.reportSecuritySignal.mockClear();
	});

	afterEach(() => {
		vi.useRealTimers();
		env.NAO_RATE_LIMIT_MODE = originalMode;
	});

	it('refuses calls over the limit in enforce mode, and reports the first one', () => {
		env.NAO_RATE_LIMIT_MODE = 'enforce';
		callTimes(max, 'user-1');

		expect(() => consumeRateLimit('agent', 'user-1', 'user-1')).toThrow(RateLimitExceededError);
		expect(() => consumeRateLimit('agent', 'user-1', 'user-1')).toThrow(RateLimitExceededError);
		expect(mocks.reportSecuritySignal).toHaveBeenCalledOnce();
		expect(mocks.reportSecuritySignal).toHaveBeenCalledWith('rate-limited', 'agent', { userId: 'user-1' });
	});

	it('tells when the window reopens', () => {
		env.NAO_RATE_LIMIT_MODE = 'enforce';
		callTimes(max, 'user-1');
		vi.advanceTimersByTime(windowMs - 5_000);

		expect(() => consumeRateLimit('agent', 'user-1')).toThrow(expect.objectContaining({ retryAfterSeconds: 5 }));
	});

	it('only reports excess calls in shadow mode', () => {
		env.NAO_RATE_LIMIT_MODE = 'shadow';
		callTimes(max + 3, 'user-1');

		expect(mocks.reportSecuritySignal).toHaveBeenCalledOnce();
		expect(mocks.reportSecuritySignal).toHaveBeenCalledWith('rate-limited', 'agent (shadow)', {
			userId: undefined,
		});
	});

	it('does nothing when off', () => {
		env.NAO_RATE_LIMIT_MODE = 'off';
		callTimes(max + 3, 'user-1');

		expect(mocks.reportSecuritySignal).not.toHaveBeenCalled();
	});

	it('counts each key on its own and starts over once the window has passed', () => {
		env.NAO_RATE_LIMIT_MODE = 'enforce';
		callTimes(max, 'user-1');

		expect(() => consumeRateLimit('agent', 'user-2')).not.toThrow();
		vi.advanceTimersByTime(windowMs);
		expect(() => callTimes(max, 'user-1')).not.toThrow();
	});
});

function callTimes(count: number, key: string): void {
	for (let call = 0; call < count; call++) {
		consumeRateLimit('agent', key);
	}
}
