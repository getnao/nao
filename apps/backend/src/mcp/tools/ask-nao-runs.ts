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

// `resolveAnswerPayload` falls back to `reconstructAnswerFromDb` on a miss, so finished
// runs don't need to stay in memory long.
const FINISHED_RUN_TTL_MS = 5 * 60 * 1000;

// A run stuck in `running` (hung stream, error outside the try/catch) has no `finishedAt`,
// so the sweep below would otherwise never evict it.
const MAX_RUN_AGE_MS = 15 * 60 * 1000;

const MAX_TRACKED_RUNS = 5_000;

/**
 * Tracks `ask_nao` agent runs that outlive their originating MCP request.
 *
 * MCP clients with a fixed request timeout (e.g. Cowork's ~60s cap) cannot keep a
 * long agent run open. `ask_nao` therefore returns early with a `chatId` and the run
 * keeps going in the background; `get_nao_answer` reads its outcome from this registry.
 */
export const askNaoRuns = {
	start(chatId: string): void {
		if (runs.size >= MAX_TRACKED_RUNS) {
			const oldestChatId = runs.keys().next().value;
			if (oldestChatId !== undefined) {
				runs.delete(oldestChatId);
			}
		}
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

setInterval(
	() => {
		const now = Date.now();
		for (const [chatId, state] of runs) {
			const isStale =
				state.status === 'running'
					? now - state.startedAt > MAX_RUN_AGE_MS
					: now - state.finishedAt > FINISHED_RUN_TTL_MS;
			if (isStale) {
				runs.delete(chatId);
			}
		}
	},
	5 * 60 * 1000,
).unref();
