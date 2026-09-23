import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type AskNaoRuns = (typeof import('../src/mcp/tools/ask-nao-runs'))['askNaoRuns'];

const RESULT = {
	chatId: 'chat-1',
	chatUrl: 'http://localhost:3000/chat/chat-1',
	text: 'answer',
	queries: [],
	story_ids: [],
};

let askNaoRuns: AskNaoRuns;

/**
 * Advances fake timers past the 5-minute sweep interval enough times for the
 * registry's own housekeeping to run, so the test exercises the real sweeper.
 */
async function runSweeps(totalMs: number): Promise<void> {
	const intervalMs = 5 * 60 * 1000;
	for (let advanced = 0; advanced < totalMs; advanced += intervalMs) {
		await vi.advanceTimersByTimeAsync(intervalMs);
	}
}

describe('askNaoRuns registry sweep', () => {
	beforeEach(async () => {
		// Fake timers must be active before the module import so its setInterval
		// is registered against the mocked clock. Fresh import = empty registry.
		vi.resetModules();
		vi.useFakeTimers();
		({ askNaoRuns } = await import('../src/mcp/tools/ask-nao-runs'));
	});

	afterEach(() => {
		vi.useRealTimers();
		vi.restoreAllMocks();
	});

	it('expires finished runs after the TTL', async () => {
		askNaoRuns.start('a');
		askNaoRuns.complete('a', RESULT);
		// 24 hours later the finished run must be gone.
		await runSweeps(24 * 60 * 60 * 1000);
		expect(askNaoRuns.get('a')).toBeUndefined();
	});

	it('keeps recent finished runs', () => {
		askNaoRuns.start('a');
		askNaoRuns.complete('a', RESULT);
		expect(askNaoRuns.get('a')).toBeDefined();
	});

	it('keeps an actively running run', async () => {
		askNaoRuns.start('a');
		await runSweeps(5 * 60 * 1000);
		expect(askNaoRuns.get('a')).toBeDefined();
	});

	it('expires a run stuck in running past the max run duration', async () => {
		askNaoRuns.start('a');
		// 20 minutes later the run is still 'running' - it must not be kept forever.
		await runSweeps(20 * 60 * 1000);
		expect(askNaoRuns.get('a')).toBeUndefined();
	});

	it('enforces a hard cap on registry size by evicting oldest entries', async () => {
		// One over the cap; the oldest entry must be evicted.
		for (let i = 0; i < 1001; i++) {
			askNaoRuns.start(`chat-${i}`);
		}
		await runSweeps(5 * 60 * 1000);
		expect(askNaoRuns.get('chat-0')).toBeUndefined();
		expect(askNaoRuns.get('chat-1')).toBeDefined();
		expect(askNaoRuns.get('chat-1000')).toBeDefined();
	});
});
