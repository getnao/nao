import type { App } from '../app';

const DRAIN_POLL_INTERVAL_MS = 200;

const inFlightRequestIds = new Set<string>();
let draining = false;

export function trackInFlightRequests(app: App): void {
	app.addHook('onRequest', async (request) => {
		inFlightRequestIds.add(request.id);
	});
	app.addHook('onResponse', async (request) => {
		inFlightRequestIds.delete(request.id);
	});
	app.addHook('onRequestAbort', async (request) => {
		inFlightRequestIds.delete(request.id);
	});
}

export function isDraining(): boolean {
	return draining;
}

/**
 * Keeps serving while `isDraining()` is true, then resolves once every in-flight request
 * (including streamed responses) has finished. Fastify's `close()` does not wait for them under Bun.
 */
export async function drainInFlightRequests(delayMs: number): Promise<void> {
	draining = true;
	await sleep(delayMs);
	while (inFlightRequestIds.size > 0) {
		await sleep(DRAIN_POLL_INTERVAL_MS);
	}
}

function sleep(durationMs: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, durationMs));
}
