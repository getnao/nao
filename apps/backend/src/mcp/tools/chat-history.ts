import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { normalizeCitationMarkers } from '@nao/shared';
import type { ProjectChatListItem, UpdatedAtFilter } from '@nao/shared/types';
import { getToolName, isToolUIPart } from 'ai';
import { z } from 'zod';

import * as chatQueries from '../../queries/chat.queries';
import * as projectQueries from '../../queries/project.queries';
import * as userQueries from '../../queries/user.queries';
import { MESSAGE_SOURCES, type UIMessage, type UIMessagePart } from '../../types/chat';
import type { ProjectChatsFacetKey } from '../../types/project';
import { isValidIsoDateString } from '../../utils/date';
import { withQueryResultPreviewsInChat } from '../../utils/query-result-preview';
import { truncateMiddle } from '../../utils/utils';
import type { McpContext } from '../logging';
import { chatReplayUrl } from '../urls';
import { jsonToolResult, registerMcpTool } from './register-mcp-tool';

const SEARCH_CHATS_DESCRIPTION =
	'Search the chat history of every member of this nao project (admins and context admins only).\n\n' +
	'USE WHEN: you need to audit how people use nao — find chats by author, source (web, slack, mcp…), ' +
	'tool errors, feedback, number of messages, last activity date, or a search term matched against ' +
	'titles, message text and author names.\n' +
	'Returns one page of chat summaries, newest activity first by default. Pass a returned `id` to `get_chat` ' +
	'to read the full conversation.';

const GET_CHAT_DESCRIPTION =
	"Read a chat of this nao project as a transcript: every message's text, the tools the agent called " +
	'(with their input and error), and the feedback users left (admins and context admins only).\n\n' +
	'USE WHEN: you have a chat id (from `search_chats`, a replay link, or the user) and need to understand ' +
	'what was asked, what nao answered, and where it failed.\n' +
	'Tool outputs are omitted unless `include_tool_outputs` is true, as they can be large.';

const SORTABLE_CHAT_FIELDS = [
	'updatedAt',
	'numberOfMessages',
	'totalTokens',
	'totalCost',
	'feedback',
	'toolState',
] as const;
const FEEDBACK_STATES = ['upvotes', 'downvotes', 'noVotes'] as const;
const EARLIEST_DATE = '1970-01-01';
const LATEST_DATE = '9999-12-31';
const MAX_TOOL_INPUT_CHARS = 2_000;
const MAX_TOOL_OUTPUT_CHARS = 2_000;

const ISO_DATE_INPUT = z.string().refine(isValidIsoDateString, { message: 'Must be a valid YYYY-MM-DD date' });

const CHAT_SUMMARY_SCHEMA = z.object({
	id: z.string().describe('Chat UUID. Pass it to `get_chat` to read the conversation.'),
	title: z.string(),
	author: z.object({
		id: z.string(),
		name: z.string(),
		role: z.string().describe('Project role of the author, or `Former member` when they left the project.'),
	}),
	source: z.string().nullable().describe('Where the chat started (web, slack, mcp…). Null for web chats.'),
	updatedAt: z.string().describe('ISO timestamp of the last activity.'),
	messageCount: z.number(),
	toolCallCount: z.number(),
	toolErrorCount: z.number(),
	upvotes: z.number(),
	downvotes: z.number(),
	downvoteExplanations: z.string().describe('Concatenated explanations left with downvotes; empty when none.'),
	totalTokens: z.number(),
	totalCost: z.number().describe('Estimated LLM cost in USD.'),
	replayUrl: z.url().describe('Link to replay the chat in the nao admin settings.'),
});

const TOOL_CALL_SCHEMA = z.object({
	toolName: z.string(),
	state: z.string().describe('`output-available` on success, `output-error` on failure.'),
	input: z.string().optional().describe('JSON input of the call, truncated when large.'),
	output: z.string().optional().describe('JSON output, truncated; only with `include_tool_outputs`.'),
	error: z.string().optional(),
});

const CHAT_MESSAGE_SCHEMA = z.object({
	id: z.string(),
	role: z.string(),
	createdAt: z.string().nullable(),
	source: z.string().nullable(),
	text: z.string(),
	toolCalls: z.array(TOOL_CALL_SCHEMA),
	feedback: z.object({ vote: z.enum(['up', 'down']), explanation: z.string().nullable() }).nullable(),
});

type ChatSummary = z.infer<typeof CHAT_SUMMARY_SCHEMA>;
type ToolCall = z.infer<typeof TOOL_CALL_SCHEMA>;
type ChatMessage = z.infer<typeof CHAT_MESSAGE_SCHEMA>;

export function registerChatHistoryTools(server: McpServer, ctx: McpContext): void {
	registerSearchChats(server, ctx);
	registerGetChat(server, ctx);
}

function registerSearchChats(server: McpServer, ctx: McpContext): void {
	registerMcpTool(server, ctx, {
		name: 'search_chats',
		title: 'Search Chats',
		description: SEARCH_CHATS_DESCRIPTION,
		inputSchema: {
			search: z
				.string()
				.optional()
				.describe('Case-insensitive term matched against chat titles, message text and author names.'),
			author: z.string().optional().describe("Case-insensitive part of the author's name or email."),
			sources: z.array(z.enum(MESSAGE_SOURCES)).optional().describe('Only chats started from these sources.'),
			has_tool_errors: z
				.boolean()
				.optional()
				.describe('true: only chats with at least one failed tool call. false: only chats without any.'),
			feedback: z
				.array(z.enum(FEEDBACK_STATES))
				.optional()
				.describe('Only chats with upvotes, downvotes, or no votes at all.'),
			min_messages: z.number().int().min(0).optional().describe('Only chats with at least this many messages.'),
			max_messages: z.number().int().min(0).optional().describe('Only chats with at most this many messages.'),
			updated_after: ISO_DATE_INPUT.optional().describe(
				'Only chats active on or after this date (YYYY-MM-DD, UTC).',
			),
			updated_before: ISO_DATE_INPUT.optional().describe(
				'Only chats active on or before this date (YYYY-MM-DD, UTC).',
			),
			sort_by: z
				.enum(SORTABLE_CHAT_FIELDS)
				.optional()
				.default('updatedAt')
				.describe('`feedback` ranks downvoted chats first, `toolState` ranks chats with tool errors first.'),
			descending: z.boolean().optional().default(true),
			limit: z.number().int().positive().max(100).optional().default(20).describe('Page size (max 100).'),
			page: z.number().int().min(0).optional().default(0).describe('Zero-based page index.'),
		},
		outputSchema: {
			chats: z.array(CHAT_SUMMARY_SCHEMA),
			total: z.number().describe('Number of chats matching the criteria across all pages.'),
			hasMore: z.boolean().describe('True when another page is available.'),
		},
		handler: async (input) => {
			const { chats, total } = await projectQueries.listProjectChats(ctx.projectId, {
				page: input.page,
				pageSize: input.limit,
				search: input.search,
				author: input.author,
				messageCount: { min: input.min_messages, max: input.max_messages },
				filters: buildChatFilters(input),
				updatedAtFilter: toUpdatedAtFilter(input.updated_after, input.updated_before),
				sorting: [{ id: input.sort_by, desc: input.descending }],
			});
			const output = {
				chats: chats.map(toChatSummary),
				total,
				hasMore: (input.page + 1) * input.limit < total,
			};
			return jsonToolResult(output);
		},
	});
}

function registerGetChat(server: McpServer, ctx: McpContext): void {
	registerMcpTool(server, ctx, {
		name: 'get_chat',
		title: 'Get Chat',
		description: GET_CHAT_DESCRIPTION,
		inputSchema: {
			chat_id: z.string().describe('Chat UUID, e.g. an `id` returned by `search_chats`.'),
			include_tool_outputs: z
				.boolean()
				.optional()
				.default(false)
				.describe('Include the (truncated) output of every tool call. Query results are capped to a preview.'),
		},
		outputSchema: {
			id: z.string(),
			title: z.string(),
			author: z.object({ id: z.string(), name: z.string().nullable() }).nullable(),
			createdAt: z.string(),
			updatedAt: z.string(),
			replayUrl: z.url(),
			messages: z.array(CHAT_MESSAGE_SCHEMA),
		},
		errorMessage: (error) => (error instanceof Error ? error.message : 'get_chat failed. Please try again.'),
		handler: async ({ chat_id, include_tool_outputs }) => {
			const chatProjectId = await chatQueries.getChatProjectId(chat_id);
			const [chat, ownerId] =
				chatProjectId === ctx.projectId ? await chatQueries.getChat(chat_id, { includeFeedback: true }) : [];
			if (!chat) {
				throw new Error(`Chat ${chat_id} not found in this project.`);
			}

			const ownerName = ownerId ? await userQueries.getUserName(ownerId) : null;
			const output = {
				id: chat.id,
				title: chat.title,
				author: ownerId ? { id: ownerId, name: ownerName } : null,
				createdAt: new Date(chat.createdAt).toISOString(),
				updatedAt: new Date(chat.updatedAt).toISOString(),
				replayUrl: chatReplayUrl(chat.id),
				messages: withQueryResultPreviewsInChat(chat).messages.map((message) =>
					toChatMessage(message, include_tool_outputs),
				),
			};
			return jsonToolResult(output);
		},
	});
}

function buildChatFilters(input: {
	sources?: string[];
	has_tool_errors?: boolean;
	feedback?: string[];
}): { id: ProjectChatsFacetKey; values: string[] }[] {
	const filters: { id: ProjectChatsFacetKey; values: string[] }[] = [];
	if (input.sources?.length) {
		filters.push({ id: 'source', values: input.sources });
	}
	if (input.has_tool_errors !== undefined) {
		const values = input.has_tool_errors ? ['toolsWithErrors'] : ['noToolsUsed', 'toolsNoErrors'];
		filters.push({ id: 'toolState', values });
	}
	if (input.feedback?.length) {
		filters.push({ id: 'feedback', values: input.feedback });
	}
	return filters;
}

function toUpdatedAtFilter(after: string | undefined, before: string | undefined): UpdatedAtFilter | undefined {
	if (!after && !before) {
		return undefined;
	}
	return { mode: 'range', start: after ?? EARLIEST_DATE, end: before ?? LATEST_DATE };
}

function toChatSummary(chat: ProjectChatListItem): ChatSummary {
	return {
		id: chat.id,
		title: chat.title,
		author: { id: chat.userId, name: chat.userName, role: chat.userRole ?? 'Former member' },
		source: chat.source,
		updatedAt: new Date(chat.updatedAt).toISOString(),
		messageCount: chat.numberOfMessages,
		toolCallCount: chat.toolAvailableCount + chat.toolErrorCount,
		toolErrorCount: chat.toolErrorCount,
		upvotes: chat.upvotes,
		downvotes: chat.downvotes,
		downvoteExplanations: chat.feedbackText,
		totalTokens: chat.totalTokens,
		totalCost: chat.totalCost,
		replayUrl: chatReplayUrl(chat.id),
	};
}

function toChatMessage(message: UIMessage, includeToolOutputs: boolean): ChatMessage {
	return {
		id: message.id,
		role: message.role,
		createdAt: message.createdAt ? new Date(message.createdAt).toISOString() : null,
		source: message.source ?? null,
		text: extractText(message.parts),
		toolCalls: message.parts.filter(isToolUIPart).map((part) => toToolCall(part, includeToolOutputs)),
		feedback: message.feedback
			? { vote: message.feedback.vote, explanation: message.feedback.explanation ?? null }
			: null,
	};
}

function extractText(parts: UIMessagePart[]): string {
	return parts
		.filter((part): part is Extract<UIMessagePart, { type: 'text' }> => part.type === 'text')
		.map((part) => normalizeCitationMarkers(part.text))
		.join('\n\n');
}

function toToolCall(part: Parameters<typeof getToolName>[0], includeToolOutputs: boolean): ToolCall {
	const call: ToolCall = {
		toolName: getToolName(part),
		state: part.state,
		input: serializeTruncated(part.input, MAX_TOOL_INPUT_CHARS),
	};
	if (part.state === 'output-error') {
		call.error = part.errorText;
	}
	if (includeToolOutputs && part.state === 'output-available') {
		call.output = serializeTruncated(part.output, MAX_TOOL_OUTPUT_CHARS);
	}
	return call;
}

function serializeTruncated(value: unknown, maxChars: number): string | undefined {
	if (value === undefined) {
		return undefined;
	}
	const serialized = typeof value === 'string' ? value : JSON.stringify(value);
	return truncateMiddle(serialized, maxChars, ' … [truncated] … ');
}
