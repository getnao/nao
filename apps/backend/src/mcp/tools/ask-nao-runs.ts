export interface AskNaoQuery {
	id: string;
	columns: string[];
	row_count: number;
	preview: Record<string, unknown>[];
}

export interface AskNaoClarification {
	question: string;
	options?: string[];
}

export interface AskNaoResult {
	chatId: string;
	chatUrl: string;
	text: string;
	clarification?: AskNaoClarification;
	queries: AskNaoQuery[];
	story_ids: string[];
}

export type AskNaoRunState =
	| { status: 'running'; startedAt: number }
	| { status: 'complete'; result: AskNaoResult; finishedAt: number }
	| { status: 'error'; error: string; finishedAt: number };

const runs = new Map<string, AskNaoRunState>();

// Completed/errored runs are kept briefly in case the MCP client polls
// `get_nao_answer` right after the run ends. `reconstructAnswerFromDb`
// covers misses, so a short TTL is enough.
const FINISHED_RUN_TTL_MS = 5 * 60 * 1000;

// A run that is still 'running' this long after it started is hung (the sync
// budget is 45s, so healthy runs settle far sooner). Evict it instead of
// leaking the entry until the process is restarted.
const MAX_RUN_MS = 15 * 60 * 1000;

// Backstop: never hold more than this many runs in memory. Oldest entries
// (insertion order) are evicted first. Protects the process even if the
// sweep logic above misses a future state shape.
const MAX_RUNS = 1000;

/**
 * Tracks `ask_nao` agent runs that outlive their originating MCP request.
 *
 * MCP clients with a fixed request timeout (e.g. Cowork's ~60s cap) cannot keep a
 * long agent run open. `ask_nao` therefore returns early with a `chatId` and the run
 * keeps going in the background; `get_nao_answer` reads its outcome from this registry.
 */
export const askNaoRuns = {
	start(chatId: string): void {
		runs.set(chatId, { status: 'running', startedAt: Date.now() });
	},
	complete(chatId: string, result: AskNaoResult): void {
		runs.set(chatId, { status: 'complete', result, finishedAt: Date.now() });
	},
	fail(chatId: string, error: string): void {
		runs.set(chatId, { status: 'error', error, finishedAt: Date.now() });
	},
	get(chatId: string): AskNaoRunState | undefined {
		return runs.get(chatId);
	},
};

/**
 * Removes expired or over-cap entries from the run registry.
 *
 * - Finished runs are evicted after `FINISHED_RUN_TTL_MS`.
 * - Runs stuck in 'running' past `MAX_RUN_MS` are evicted (they would
 *   otherwise never leave the map, leaking memory until restart).
 * - A hard cap (`MAX_RUNS`) evicts the oldest entries as a backstop.
 *
 * Exposed for tests; production calls it from the sweep interval below.
 */
export function sweepExpiredRuns(now: number = Date.now()): void {
	for (const [chatId, state] of runs) {
		const isExpired = state.status !== 'running' && now - state.finishedAt > FINISHED_RUN_TTL_MS;
		const isStuck = state.status === 'running' && now - state.startedAt > MAX_RUN_MS;
		if (isExpired || isStuck) {
			runs.delete(chatId);
		}
	}
	while (runs.size > MAX_RUNS) {
		const oldest = runs.keys().next().value;
		if (oldest === undefined) {
			break;
		}
		runs.delete(oldest);
	}
}

setInterval(
	() => {
		sweepExpiredRuns();
	},
	5 * 60 * 1000,
).unref();
