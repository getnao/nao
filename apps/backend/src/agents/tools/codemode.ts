import { codemode } from '@nao/shared/tools';

import { createMcpFunctions, MCP_NAMESPACE } from '../../services/codemode/mcp-functions';
import { type CodemodeFunction, type CodemodeResult, runCodemode } from '../../services/codemode/sandbox';
import type { ToolContext } from '../../types/tools';
import { createTool } from '../../utils/tools';
import { truncateMiddle } from '../../utils/utils';
import { authRequiredText } from './mcp-call';

const TIMEOUT_MS = 120_000;
const MEMORY_LIMIT_BYTES = 128 * 1024 * 1024;
const MAX_RESULT_CHARS = 12_000;
const MAX_LOGS_CHARS = 8_000;

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
			const result = await runCodemode({
				code,
				functions,
				timeoutMs: TIMEOUT_MS,
				memoryLimitBytes: MEMORY_LIMIT_BYTES,
				signal: abortSignal,
			});
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
		'- `code` is the body of an async function: top-level `await` and `return` work. Return a',
		'  JSON-serializable value.',
		'- The sandbox has no network, file system, Node APIs, modules or timers: it only reaches the',
		'  outside world through the functions listed below.',
		'- `console.log(...)` output and the returned value come back to you. They are truncated past',
		`  ~${(MAX_RESULT_CHARS + MAX_LOGS_CHARS) / 1000}k characters: aggregate or filter before returning.`,
		`- Scripts are stopped after ${TIMEOUT_MS / 1000} seconds.`,
	];
	if (mcpEnabled) {
		lines.push(
			'',
			`MCP tools are available as \`await ${MCP_NAMESPACE}.<server>.<tool>(args)\`:`,
			'- <server> is a folder under /agent/mcps/ and <tool> the operationId of one of its OpenAPI files.',
			'  Discover tools as usual (list, then read or grep the spec) before using them in a script.',
			'- `args` is one object matching the request body schema of the spec.',
			'- Names that are not valid identifiers work with every other character replaced by `_`',
			`  (\`${MCP_NAMESPACE}.my_server\`) or with brackets (\`${MCP_NAMESPACE}["my-server"]\`).`,
			'- A call resolves to the structured content of the result, else to its text parsed as JSON when',
			'  possible, else to the text. A failing call rejects with an Error: catch it to carry on.',
			'- Calls are real and their side effects are not undone when the script fails afterwards.',
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
		sections.push(output.result === undefined ? 'The script returned nothing.' : `Result:\n${output.result}`);
	} else if (output.error) {
		sections.push(formatError(output.error, output.calls.length));
	}
	return sections.join('\n\n');
}

function formatError(error: NonNullable<codemode.Output['error']>, callCount: number): string {
	const lines = [`${error.kind.toUpperCase()}_ERROR: ${error.message}`];
	if (error.stack) {
		lines.push(error.stack);
	}
	if (callCount > 0) {
		lines.push(`${callCount} call(s) ran before the failure; their side effects are kept.`);
	}
	return lines.join('\n');
}
