export interface AskNaoQuery {
	id: string;
	columns: string[];
	row_count: number;
	preview: Record<string, unknown>[];
}

export interface AskNaoResult {
	chatId: string;
	chatUrl: string;
	text: string;
	queries: AskNaoQuery[];
	story_ids: string[];
}

export type AskNaoRunState =
	| { status: 'running'; startedAt: number }
	| { status: 'complete'; result: AskNaoResult; finishedAt: number }
	| { status: 'error'; error: string; finishedAt: number };

const runs = new Map<string, AskNaoRunState>();

const FINISHED_RUN_TTL_MS = 30 * 60 * 1000;

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

setInterval(
	() => {
		const now = Date.now();
		for (const [chatId, state] of runs) {
			if (state.status !== 'running' && now - state.finishedAt > FINISHED_RUN_TTL_MS) {
				runs.delete(chatId);
			}
		}
	},
	5 * 60 * 1000,
).unref();
