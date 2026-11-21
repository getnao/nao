import { query, type SDKControlInitializeResponse, type SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';

import type { ClaudeExecutable } from './claude-executable';
import { lockedDownOptions } from './claude-options';

const PROBE_TIMEOUT_MS = 30_000;

type ProbeSession = ReturnType<typeof query>;

/**
 * Opens a locked-down Claude Code session whose prompt never yields: the initialize handshake and
 * control requests run, but no turn starts and nothing reaches the model.
 */
export async function withProbeSession<T>(
	claude: ClaudeExecutable,
	run: (session: ProbeSession, initialization: SDKControlInitializeResponse) => Promise<T> | T,
): Promise<T> {
	const abortController = new AbortController();
	const session = query({
		prompt: waitForAbort(abortController.signal),
		options: { ...lockedDownOptions(claude), abortController },
	});
	const timeout = setTimeout(() => abortController.abort(), PROBE_TIMEOUT_MS);
	try {
		return await run(session, await session.initializationResult());
	} finally {
		clearTimeout(timeout);
		abortController.abort();
		session.close();
	}
}

function waitForAbort(signal: AbortSignal): AsyncIterable<SDKUserMessage> {
	const ended = new Promise<IteratorResult<SDKUserMessage>>((resolve) =>
		signal.addEventListener('abort', () => resolve({ done: true, value: undefined }), { once: true }),
	);
	return { [Symbol.asyncIterator]: () => ({ next: () => ended }) };
}
