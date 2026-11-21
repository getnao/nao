import { type HookCallback, query, type SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import type { LocalAgentStopReason, LocalAgentTurnInput } from '@nao/shared/local-agent';

import { findClaudeExecutable } from './claude-executable';
import { lockedDownOptions } from './claude-options';
import type { TurnEvent } from './protocol';
import { TurnStopPolicy } from './turn-stop-policy';
import { type TurnOutcome, UIMessageTranslator } from './ui-message-translator';
import { recordTurnUsage } from './usage-ledger';

const MAX_TURNS = 60;
const MCP_TOOL_TIMEOUT_MS = 10 * 60 * 1000;
const NAO_MCP_SERVER = 'nao';

const NAO_ROLE = `# nao analytics agent
In this session Claude Code runs inside the nao desktop app as nao's analytics agent, for the user signed in to it. The nao instructions below take precedence over the software engineering guidance above.
You have no file, shell or web tool. Your only tools are the nao tools: their names start with mcp__nao__ (mcp__nao__execute_sql is the execute_sql tool, and so on). Use them to read the project context and query data.`;

/**
 * Runs one chat turn on the user's Claude and reports it as UI message chunks. The prompt is only
 * sent once the nao tools are connected, so a turn never runs without them.
 */
export async function runTurn(
	turn: LocalAgentTurnInput,
	emit: (event: TurnEvent) => void,
	signal: AbortSignal,
): Promise<void> {
	const translator = new UIMessageTranslator();
	try {
		await streamTurn(turn, translator, emit, signal);
		const outcome = translator.outcome;
		const modelId = outcome?.modelId || translator.modelId || turn.model || '';
		const stopReason = signal.aborted ? 'interrupted' : outcome?.errorMessage ? 'error' : 'stop';
		if (outcome) {
			await recordUsage(turn, outcome, modelId, stopReason);
		}
		emit({
			type: 'done',
			modelId,
			stopReason,
			...(outcome?.errorMessage && !signal.aborted && { errorMessage: outcome.errorMessage }),
			...(outcome?.usage && { usage: outcome.usage }),
		});
	} catch (error) {
		const errorMessage = signal.aborted ? undefined : describeError(error);
		for (const chunk of translator.close()) {
			emit({ type: 'chunk', chunk });
		}
		if (errorMessage) {
			emit({ type: 'chunk', chunk: { type: 'error', errorText: errorMessage } });
		}
		emit({
			type: 'done',
			modelId: translator.modelId || turn.model || '',
			stopReason: signal.aborted ? 'interrupted' : 'error',
			...(errorMessage && { errorMessage }),
		});
	}
}

async function streamTurn(
	turn: LocalAgentTurnInput,
	translator: UIMessageTranslator,
	emit: (event: TurnEvent) => void,
	signal: AbortSignal,
): Promise<void> {
	const claude = await findClaudeExecutable();
	if (!claude) {
		throw new Error('Claude Code is not installed on this computer. Install it and sign in with `claude`.');
	}
	const toolsReady = deferred();
	const stopPolicy = new TurnStopPolicy();
	const abortController = new AbortController();
	signal.addEventListener('abort', () => abortController.abort(), { once: true });
	const session = query({
		prompt: promptAfter(toolsReady.promise, buildPrompt(turn)),
		options: {
			...lockedDownOptions(claude),
			abortController,
			model: turn.model,
			systemPrompt: { type: 'preset', preset: 'claude_code', append: `${NAO_ROLE}\n\n${turn.systemPrompt}` },
			allowedTools: [`mcp__${NAO_MCP_SERVER}__*`],
			includePartialMessages: true,
			maxTurns: MAX_TURNS,
			hooks: { PostToolUse: [{ hooks: [endTurnWhen(stopPolicy)] }] },
		},
	});
	try {
		await connectNaoTools(session, turn.mcp);
		toolsReady.resolve();
		for await (const message of session) {
			stopPolicy.observe(message);
			for (const chunk of translator.translate(message)) {
				emit({ type: 'chunk', chunk });
			}
			if (message.type === 'result') {
				break;
			}
		}
	} finally {
		session.close();
	}
}

function endTurnWhen(stopPolicy: TurnStopPolicy): HookCallback {
	return async (input) => {
		if (input.hook_event_name === 'PostToolUse' && stopPolicy.endsTurn(input.tool_name, input.tool_use_id)) {
			return { continue: false, stopReason: 'The answer is complete.' };
		}
		return {};
	};
}

/** Sent over stdin once the session runs, so the token stays out of the process arguments. */
async function connectNaoTools(session: ReturnType<typeof query>, mcp: LocalAgentTurnInput['mcp']): Promise<void> {
	await session.initializationResult();
	const result = await session.setMcpServers({
		[NAO_MCP_SERVER]: {
			type: 'http',
			url: mcp.url,
			headers: { Authorization: `Bearer ${mcp.token}` },
			timeout: MCP_TOOL_TIMEOUT_MS,
			alwaysLoad: true,
		},
	});
	const error = result.errors[NAO_MCP_SERVER];
	if (error) {
		throw new Error(`Could not reach the nao tools: ${error}`);
	}
}

/** A turn that fails to be recorded still answers: the ledger only feeds the usage page. */
async function recordUsage(
	turn: LocalAgentTurnInput,
	outcome: TurnOutcome,
	modelId: string,
	stopReason: LocalAgentStopReason,
): Promise<void> {
	const usage = outcome.usage ?? {};
	await recordTurnUsage({
		at: new Date().toISOString(),
		serverOrigin: new URL(turn.mcp.url).origin,
		modelId,
		inputTokens:
			(usage.inputTokens ?? 0) + (usage.cacheReadInputTokens ?? 0) + (usage.cacheCreationInputTokens ?? 0),
		outputTokens: usage.outputTokens ?? 0,
		estimatedCostUsd: outcome.estimatedCostUsd,
		durationMs: outcome.durationMs,
		stopReason,
	}).catch((error) => process.stderr.write(`Could not record the turn usage: ${describeError(error)}\n`));
}

function buildPrompt(turn: LocalAgentTurnInput): string {
	if (!turn.history) {
		return turn.prompt;
	}
	return `Here is the conversation so far:\n<conversation_history>\n${turn.history}\n</conversation_history>\n\n${turn.prompt}`;
}

async function* promptAfter(ready: Promise<void>, text: string): AsyncGenerator<SDKUserMessage> {
	await ready;
	yield { type: 'user', message: { role: 'user', content: text }, parent_tool_use_id: null };
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
	let resolve: () => void = () => {};
	const promise = new Promise<void>((done) => {
		resolve = done;
	});
	return { promise, resolve };
}

function describeError(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
