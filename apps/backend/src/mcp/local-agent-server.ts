import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
	CallToolRequestSchema,
	type CallToolResult,
	ListToolsRequestSchema,
	type Tool as McpTool,
} from '@modelcontextprotocol/sdk/types.js';
import { LOCAL_AGENT_OUTPUT_META_KEY } from '@nao/shared/local-agent';
import { asSchema, type Tool } from 'ai';

import { type LocalAgentSession, recordToolCall } from '../services/local-agent-session';
import { logger } from '../utils/logger';

const CLAUDE_TOOL_USE_ID_META_KEY = 'claudecode/toolUseId';

type McpContent = CallToolResult['content'][number];
type ToolResultOutput = Awaited<ReturnType<NonNullable<Tool['toModelOutput']>>>;

/** The analytics agent's own tools, run for one chat, for the user's Claude on the desktop app. */
export function createLocalAgentMcpServer(session: LocalAgentSession): Server {
	const server = new Server({ name: 'nao', version: '0.1.0' }, { capabilities: { tools: {} } });

	server.setRequestHandler(ListToolsRequestSchema, async () => ({
		tools: await Promise.all(Object.entries(session.tools).map(([name, tool]) => describeTool(name, tool))),
	}));

	server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
		const { name, arguments: input = {}, _meta } = request.params;
		const toolCallId = readToolUseId(_meta) ?? crypto.randomUUID();
		return callTool(session, { name, input, toolCallId, abortSignal: extra.signal });
	});

	return server;
}

async function describeTool(name: string, tool: Tool): Promise<McpTool> {
	const { $schema: _dialect, ...inputSchema } = (await asSchema(tool.inputSchema).jsonSchema) as Record<
		string,
		unknown
	>;
	return {
		name,
		description: tool.description ?? '',
		inputSchema: { ...inputSchema, type: 'object' } as McpTool['inputSchema'],
	};
}

async function callTool(
	session: LocalAgentSession,
	call: { name: string; input: unknown; toolCallId: string; abortSignal: AbortSignal },
): Promise<CallToolResult> {
	const tool = session.tools[call.name];
	if (!tool?.execute) {
		return errorResult(`Unknown tool: ${call.name}`);
	}
	const validation = await asSchema(tool.inputSchema).validate?.(call.input);
	if (validation && !validation.success) {
		return errorResult(`Invalid input for ${call.name}: ${validation.error.message}`);
	}
	const input = validation?.success ? validation.value : call.input;

	try {
		const output = await runTool(tool, input, session, call);
		recordToolCall(session, call.toolCallId, { toolName: call.name, input, output });
		return {
			content: await toModelContent(tool, { toolCallId: call.toolCallId, input, output }),
			_meta: { [LOCAL_AGENT_OUTPUT_META_KEY]: output },
		};
	} catch (error) {
		const errorText = error instanceof Error ? error.message : String(error);
		recordToolCall(session, call.toolCallId, { toolName: call.name, input, errorText });
		logger.error(`Local agent tool ${call.name} failed: ${errorText}`, {
			source: 'tool',
			context: { chatId: session.chat.id },
		});
		return errorResult(errorText);
	}
}

async function runTool(
	tool: Tool,
	input: unknown,
	session: LocalAgentSession,
	call: { toolCallId: string; abortSignal: AbortSignal },
): Promise<unknown> {
	const result = await tool.execute!(input, {
		toolCallId: call.toolCallId,
		messages: [],
		abortSignal: call.abortSignal,
		experimental_context: session.toolContext,
	});
	if (!isAsyncIterable(result)) {
		return result;
	}
	let lastOutput: unknown;
	for await (const output of result) {
		lastOutput = output;
	}
	return lastOutput;
}

async function toModelContent(
	tool: Tool,
	options: { toolCallId: string; input: unknown; output: unknown },
): Promise<McpContent[]> {
	if (!tool.toModelOutput) {
		return [textContent(JSON.stringify(options.output) ?? '')];
	}
	return fromToolResultOutput(await tool.toModelOutput(options));
}

function fromToolResultOutput(output: ToolResultOutput): McpContent[] {
	switch (output.type) {
		case 'text':
		case 'error-text':
			return [textContent(output.value)];
		case 'json':
		case 'error-json':
			return [textContent(JSON.stringify(output.value))];
		case 'execution-denied':
			return [textContent(output.reason ?? 'The tool call was denied.')];
		case 'content':
			return output.value.flatMap(fromContentPart);
		default:
			return [];
	}
}

function fromContentPart(part: Extract<ToolResultOutput, { type: 'content' }>['value'][number]): McpContent[] {
	if (part.type === 'text') {
		return [textContent(part.text)];
	}
	if ((part.type === 'media' || part.type === 'image-data') && part.mediaType.startsWith('image/')) {
		return [{ type: 'image', data: part.data, mimeType: part.mediaType }];
	}
	return [];
}

function textContent(text: string): McpContent {
	return { type: 'text', text };
}

function errorResult(text: string): CallToolResult {
	return { content: [textContent(text)], isError: true };
}

function readToolUseId(meta: Record<string, unknown> | undefined): string | undefined {
	const toolUseId = meta?.[CLAUDE_TOOL_USE_ID_META_KEY];
	return typeof toolUseId === 'string' && toolUseId.length > 0 ? toolUseId : undefined;
}

function isAsyncIterable(value: unknown): value is AsyncIterable<unknown> {
	return typeof value === 'object' && value !== null && Symbol.asyncIterator in value;
}
