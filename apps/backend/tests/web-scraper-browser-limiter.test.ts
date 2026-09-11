import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { __reloadEnvForTesting } from '../src/env';
import { acquireWebRobotBrowserLoad } from '../src/services/web-scraper/browser-loader';

let originalEnv: typeof process.env;

beforeEach(() => {
	originalEnv = { ...process.env };
	process.env.WEB_ROBOT_BROWSER_MAX_CONCURRENCY = '1';
	__reloadEnvForTesting();
});

afterEach(() => {
	process.env = originalEnv;
	__reloadEnvForTesting();
});

describe('web robot browser load limiter', () => {
	it('queues page loads beyond the configured global concurrency', async () => {
		const releaseFirst = await acquireWebRobotBrowserLoad();
		let secondAcquired = false;
		const second = acquireWebRobotBrowserLoad().then((release) => {
			secondAcquired = true;
			return release;
		});

		await new Promise((resolve) => setImmediate(resolve));
		expect(secondAcquired).toBe(false);

		releaseFirst();
		const releaseSecond = await second;
		expect(secondAcquired).toBe(true);
		releaseSecond();
	});

	it('cancels a queued page load before it takes a browser slot', async () => {
		const releaseFirst = await acquireWebRobotBrowserLoad();
		const abort = new AbortController();
		const waiting = acquireWebRobotBrowserLoad(abort.signal);

		abort.abort();
		await expect(waiting).rejects.toThrow('Web robot run was cancelled');
		releaseFirst();
	});
});
