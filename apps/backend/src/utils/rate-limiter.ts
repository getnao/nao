import { env } from '../env';
import { HandlerError } from './error';
import { reportSecuritySignal } from './security-signal';

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const PRUNE_EVERY_CALLS = 1_000;

/** Generous on purpose: they stop floods and scripted loops, not people. Probing is scored by the backoffice. */
export const RATE_LIMITS = {
	trpc: { max: 600, windowMs: MINUTE_MS },
	agent: { max: 30, windowMs: MINUTE_MS },
	'outbound-fetch': { max: 30, windowMs: MINUTE_MS },
	deploy: { max: 20, windowMs: HOUR_MS },
	'api-key-create': { max: 10, windowMs: HOUR_MS },
	'llm-config-write': { max: 60, windowMs: HOUR_MS },
} as const satisfies Record<string, { max: number; windowMs: number }>;
export type RateLimitBucket = keyof typeof RATE_LIMITS;

export type RateLimitMode = 'off' | 'shadow' | 'enforce';

export class RateLimitExceededError extends HandlerError {
	constructor(readonly retryAfterSeconds: number) {
		super('TOO_MANY_REQUESTS', `Too many requests. Try again in ${retryAfterSeconds} seconds.`);
		this.name = 'RateLimitExceededError';
	}
}

interface Window {
	startedAt: number;
	count: number;
}

const windows = new Map<string, Window>();
let callsSincePrune = 0;

/**
 * Counts one call of `key` (a user, an organization, a project or an IP) in a fixed window. Over the limit, the first
 * excess call of the window is reported as a `rate-limited` security signal, and in `enforce` mode every excess call
 * throws. Counters live in memory, so they restart with the process.
 */
export function consumeRateLimit(bucket: RateLimitBucket, key: string, userId?: string): void {
	const mode = getRateLimitMode();
	if (mode === 'off') {
		return;
	}
	const { max, windowMs } = RATE_LIMITS[bucket];
	const now = Date.now();
	const window = countCall(`${bucket}:${key}`, now, windowMs);
	if (window.count <= max) {
		return;
	}
	if (window.count === max + 1) {
		reportSecuritySignal('rate-limited', mode === 'shadow' ? `${bucket} (shadow)` : bucket, { userId });
	}
	if (mode === 'enforce') {
		throw new RateLimitExceededError(Math.ceil((window.startedAt + windowMs - now) / 1000));
	}
}

/** Shadow mode by default on nao Cloud, so limits are tuned on real traffic before they block anyone. */
export function getRateLimitMode(): RateLimitMode {
	return env.NAO_RATE_LIMIT_MODE ?? (env.NAO_MODE === 'cloud' ? 'shadow' : 'off');
}

export function resetRateLimits(): void {
	windows.clear();
	callsSincePrune = 0;
}

function countCall(windowKey: string, now: number, windowMs: number): Window {
	pruneExpiredWindows(now);
	const current = windows.get(windowKey);
	if (current && now - current.startedAt < windowMs) {
		current.count++;
		return current;
	}
	const fresh = { startedAt: now, count: 1 };
	windows.set(windowKey, fresh);
	return fresh;
}

/** The longest window is the oldest a counter can still matter, so anything older is dropped. */
function pruneExpiredWindows(now: number): void {
	callsSincePrune++;
	if (callsSincePrune < PRUNE_EVERY_CALLS) {
		return;
	}
	callsSincePrune = 0;
	for (const [key, window] of windows) {
		if (now - window.startedAt >= HOUR_MS) {
			windows.delete(key);
		}
	}
}
