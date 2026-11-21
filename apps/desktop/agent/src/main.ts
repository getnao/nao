import { createInterface } from 'node:readline';

import { readRateLimits } from './claude-rate-limits';
import { getClaudeStatus } from './claude-status';
import type { SidecarMessage, SidecarRequest } from './protocol';
import { runTurn } from './turn-runner';
import { summarizeUsage } from './usage-ledger';

const runningTurns = new Map<string, AbortController>();

function main(): void {
	const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
	lines.on('line', (line) => {
		const request = parseRequest(line);
		if (request) {
			void handleRequest(request);
		}
	});
	lines.on('close', shutdown);
}

async function handleRequest(request: SidecarRequest): Promise<void> {
	switch (request.type) {
		case 'status':
			send({ type: 'status', requestId: request.requestId, status: await getClaudeStatus(request.refresh) });
			return;
		case 'overview':
			send({
				type: 'overview',
				requestId: request.requestId,
				overview: await readOverview(request.serverOrigin),
			});
			return;
		case 'turn':
			await startTurn(request.turnId, request.turn);
			return;
		case 'stop':
			runningTurns.get(request.turnId)?.abort();
			return;
	}
}

async function startTurn(turnId: string, turn: Extract<SidecarRequest, { type: 'turn' }>['turn']): Promise<void> {
	const abortController = new AbortController();
	runningTurns.set(turnId, abortController);
	try {
		await runTurn(turn, (event) => send({ type: 'turn-event', turnId, event }), abortController.signal);
	} finally {
		runningTurns.delete(turnId);
	}
}

async function readOverview(serverOrigin: string) {
	const [rateLimits, usage] = await Promise.all([readRateLimits(), summarizeUsage(serverOrigin)]);
	return { rateLimits, usage };
}

/** The desktop app closes stdin when it quits: running turns stop with it. */
function shutdown(): void {
	for (const abortController of runningTurns.values()) {
		abortController.abort();
	}
	setTimeout(() => process.exit(0), 1_000).unref();
}

function parseRequest(line: string): SidecarRequest | null {
	try {
		return JSON.parse(line) as SidecarRequest;
	} catch {
		process.stderr.write(`Ignored a request that is not JSON: ${line.slice(0, 200)}\n`);
		return null;
	}
}

function send(message: SidecarMessage): void {
	process.stdout.write(`${JSON.stringify(message)}\n`);
}

main();
