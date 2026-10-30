import { codemode } from '@nao/shared/tools';

import { createMcpFunctions, MCP_NAMESPACE } from '../../services/codemode/mcp-functions';
import {
	type CodemodeFunction,
	type CodemodeLimits,
	type CodemodeResult,
	runCodemode,
} from '../../services/codemode/sandbox';
import type { ToolContext } from '../../types/tools';
import { createTool } from '../../utils/tools';
import { truncateMiddle } from '../../utils/utils';
import { authRequiredText } from './mcp-call';

const MAX_RESULT_CHARS = 12_000;
const MAX_LOGS_CHARS = 8_000;

const LIMITS: CodemodeLimits = {
	timeoutMs: 120_000,
	memoryLimitBytes: 128 * 1024 * 1024,
	maxLogChars: 100_000,
	maxCalls: 500,
	maxCallArgsChars: 10_000_000,
	maxConcurrentCalls: 10,
};

export interface CodemodeToolOptions {
	/** MCP servers scripts may call (null for every enabled server), or false when MCP is off for the run. */
	mcpServers: string[] | null | false;
}

export const createCodemodeTool = (options: CodemodeToolOptions) =>
	createTool<codemode.Input, codemode.Output>({
		description: buildDescription(options.mcpServers !== false),
		inputSchema: codemode.InputSchema,
		outputSchema: codemode.OutputSchema,
		execute: async ({ code }, context, { abortSignal }) => {
			const startedAt = performance.now();
			let authRequiredServer: string | undefined;
			const functions = await createFunctions(options, context, (server) => {
				authRequiredServer ??= server;
			});
			const result = await runCodemode({ code, functions, limits: LIMITS, signal: abortSignal });
			return toOutput(result, performance.now() - startedAt, authRequiredServer);
		},
		toModelOutput: ({ output }) => ({ type: 'text', value: formatForModel(output) }),
	});

function buildDescription(mcpEnabled: boolean): string {
	const lines = [
		'Run a JavaScript script in an isolated QuickJS sandbox, to combine several calls in a single step:',
		'chain calls, loop over results, run independent calls in parallel with `Promise.all`, and filter',
		'or aggregate large results down to what you need. Only what the script logs or returns comes back',
		'to you, not the intermediate results. Also useful for plain computation on data you already have.',
		'',
		'- `code` is the body of an async function, run as-is: write the statements directly with',
		'  top-level `await`, and `return` a JSON-serializable value. Nothing calls a function the script',
		'  declares: do not wrap the script in `async function main() { ... }`.',
		'- The sandbox has no network, file system, Node APIs, modules or timers: it only reaches the',
		'  outside world through the functions listed below.',
		'- `console.log(...)` output and the returned value come back to you. They are truncated past',
		`  ~${(MAX_RESULT_CHARS + MAX_LOGS_CHARS) / 1000}k characters: aggregate or filter before returning.`,
		`- Scripts are stopped after ${LIMITS.timeoutMs / 1000} seconds.`,
	];
	if (mcpEnabled) {
		lines.push(
			'',
			`MCP tools are available as \`await ${MCP_NAMESPACE}.<server>.<tool>(args)\`, e.g. a whole script:`,
			`\`const ticket = await ${MCP_NAMESPACE}.linear.get_ticket({ id: "ENG-1" }); return ticket.title;\``,
			'- <server> is a folder under /agent/mcps/ and <tool> the operationId of one of its OpenAPI files.',
			'  Discover tools as usual (list, then read or grep the spec) before using them in a script.',
			'- `args` is one object matching the request body schema of the spec.',
			'- Names that are not valid identifiers work with every other character replaced by `_`',
			`  (\`${MCP_NAMESPACE}.my_server\`) or with brackets (\`${MCP_NAMESPACE}["my-server"]\`).`,
			'- A call resolves to the structured content of the result, else to its text parsed as JSON when',
			'  possible, else to the text. A failing call rejects with an Error: catch it to carry on.',
			'- Calls are real and their side effects are not undone when the script fails afterwards.',
			`- A script makes at most ${LIMITS.maxCalls} calls, ${LIMITS.maxConcurrentCalls} at a time: the others wait.`,
			'- An AUTH_REQUIRED error means the user must connect their account: stop and ask them to.',
			'- A server with an empty folder has no tools yet: run `mcp_connect` on it first.',
		);
	}
	return lines.join('\n');
}

async function createFunctions(
	options: CodemodeToolOptions,
	context: ToolContext,
	onAuthRequired: (server: string) => void,
): Promise<CodemodeFunction[]> {
	if (options.mcpServers === false) {
		return [];
	}
	return createMcpFunctions({
		projectId: context.projectId,
		userId: context.userId,
		allowedServers: options.mcpServers,
		access: context.mcpAccess,
		onAuthRequired,
	});
}

function toOutput(result: CodemodeResult, durationMs: number, authRequiredServer?: string): codemode.Output {
	return {
		ok: result.ok,
		logs: truncateLogs(result.logs),
		...(result.ok ? serializeValue(result.value) : { error: result.error }),
		calls: result.calls,
		durationMs: Math.round(durationMs),
		...(authRequiredServer && { mcpAuthRequired: true, server: authRequiredServer }),
	};
}

function serializeValue(value: unknown): Pick<codemode.Output, 'result'> {
	if (value === undefined) {
		return {};
	}
	return { result: truncateMiddle(JSON.stringify(value), MAX_RESULT_CHARS, '\n... [truncated] ...\n') };
}

function truncateLogs(logs: string[]): string[] {
	const joined = logs.join('\n');
	if (joined.length <= MAX_LOGS_CHARS) {
		return logs;
	}
	return [truncateMiddle(joined, MAX_LOGS_CHARS, '\n... [truncated] ...\n')];
}

function formatForModel(output: codemode.Output): string {
	const sections: string[] = [];
	if (output.mcpAuthRequired && output.server) {
		sections.push(authRequiredText(output.server));
	}
	if (output.logs.length > 0) {
		sections.push(`Logs:\n${output.logs.join('\n')}`);
	}
	if (output.ok) {
		sections.push(output.result === undefined ? emptyResultText(output) : `Result:\n${output.result}`);
	} else if (output.error) {
		sections.push(formatError(output.error, output.calls));
	}
	return sections.join('\n\n');
}

function emptyResultText(output: codemode.Output): string {
	if (output.logs.length > 0 || output.calls.length > 0) {
		return 'The script returned nothing.';
	}
	return [
		'The script returned nothing, logged nothing and made no call.',
		'`code` runs as the body of an async function: a function it declares (e.g. `main`) never runs unless',
		'the script calls it. Write the statements directly and `return` the value at the top level.',
	].join(' ');
}

function formatError(error: NonNullable<codemode.Output['error']>, calls: codemode.Call[]): string {
	const lines = [`${error.kind.toUpperCase()}_ERROR: ${error.message}`];
	if (error.stack) {
		lines.push(error.stack);
	}
	if (calls.length > 0) {
		lines.push(describeCallsBeforeFailure(calls));
	}
	return lines.join('\n');
}

function describeCallsBeforeFailure(calls: codemode.Call[]): string {
	const interruptedCount = calls.filter((call) => call.status === 'cancelled').length;
	const completedCount = calls.length - interruptedCount;
	const sentences = [];
	if (completedCount > 0) {
		sentences.push(`${completedCount} call(s) completed before the failure; their side effects are kept.`);
	}
	if (interruptedCount > 0) {
		sentences.push(
			`${interruptedCount} call(s) were interrupted while running and may or may not have taken effect.`,
		);
	}
	sentences.push('No other call started.');
	return sentences.join(' ');
}
