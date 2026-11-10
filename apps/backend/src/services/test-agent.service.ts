import { generateText, Output } from 'ai';
import { z } from 'zod/v4';

import { testRunAgent } from '../agents/profiles/test-run';
import { llmTelemetry } from '../agents/telemetry';
import type { UIMessage } from '../types/chat';
import type { ModelCosts } from '../types/llm';
import type { TestModel, TestSourceQuery } from '../types/test-run';
import type { QueryResult } from '../types/tools';
import { getErrorMessage } from '../utils/utils';
import { AgentChat, AgentRunResult, AgentService } from './agent';
import { runSqlOverQueryResults } from './duckdb.service';
import { buildVerificationMessages } from './test-agent-verification';

export interface VerificationResult {
	/** Rows the verification query returned, or null when no answer could be produced */
	data: Record<string, unknown>[] | null;
	/** The DuckDB query the agent wrote over its own query results */
	sql: string | null;
	/** The agent's queries that the DuckDB query reads from */
	sourceQueries: TestSourceQuery[];
	error: string | null;
}

export interface ToolCallResult {
	toolName: string;
	toolCallId: string;
	args: Record<string, unknown>;
	result?: unknown;
	error?: string;
}

/** Attempts allowed for the verification query, so a broken one can be repaired once. */
const MAX_VERIFICATION_ATTEMPTS = 2;

const verificationSchema = z.object({
	sql: z
		.nullable(z.string())
		.describe('DuckDB query over the query result tables. Null if the question cannot be answered from them.'),
});

export class TestAgentService extends AgentService {
	/**
	 * Run a single prompt without persisting to a chat.
	 * Used for testing/evaluation purposes.
	 */
	async runTest(
		projectId: string,
		userId: string,
		prompt: string,
		model: TestModel,
		costs?: ModelCosts,
	): Promise<AgentRunResult> {
		const userMessage = TestAgentService._buildUserMessage(prompt);

		const tempChat = {
			id: crypto.randomUUID(),
			title: 'Test',
			createdAt: Date.now(),
			updatedAt: Date.now(),
			messages: [userMessage],
			userId,
			projectId,
		};

		const { reasoningEffort, ...modelSelection } = model;
		const agent = await this.create(tempChat, modelSelection, testRunAgent, {
			attributeUsageToChat: false,
			...(reasoningEffort && { inferenceOverrides: { reasoningEffort } }),
		});
		return agent.generate([userMessage], { costs });
	}

	/**
	 * Run a test prompt in a persisted chat, so the attempt can be replayed like any conversation.
	 * The chat must already hold the user message.
	 */
	async runTestInChat(
		chat: AgentChat,
		messages: UIMessage[],
		model: TestModel,
		options: { billingAccessVerifiedProjectId?: string; abortSignal?: AbortSignal; contextFolder?: string } = {},
	): Promise<AgentRunResult> {
		const { reasoningEffort, ...modelSelection } = model;
		const agent = await this.create(chat, modelSelection, testRunAgent, {
			billingAccessVerifiedProjectId: options.billingAccessVerifiedProjectId,
			contextFolder: options.contextFolder,
			...(reasoningEffort && { inferenceOverrides: { reasoningEffort } }),
		});
		const stopAgent = () => agent.stop();
		options.abortSignal?.addEventListener('abort', stopAgent, { once: true });
		try {
			if (options.abortSignal?.aborted) {
				agent.stop();
			}
			return await agent.streamToCompletion(messages);
		} finally {
			options.abortSignal?.removeEventListener('abort', stopAgent);
		}
	}

	/**
	 * Ask the agent to express its final answer as a DuckDB query over the rows it
	 * already fetched, then run it. Reusing the stored rows keeps the answer exact
	 * and costs a few tokens of SQL instead of a full serialisation of the data.
	 */
	async runVerification(
		projectId: string,
		userId: string,
		prompt: string,
		agentResult: AgentRunResult,
		expectedColumns: string[],
		model?: TestModel,
	): Promise<VerificationResult> {
		const { queryResults } = agentResult;
		if (queryResults.size === 0) {
			return { data: null, sql: null, sourceQueries: [], error: 'The agent did not run any SQL query.' };
		}

		const resolvedSelectedModel = await this._getResolvedLlmSelectedModel(projectId, model);
		const modelConfig = await this._getModelConfig(
			projectId,
			resolvedSelectedModel,
			{ userId, projectId, category: 'test' },
			model?.reasoningEffort ? { reasoningEffort: model.reasoningEffort } : undefined,
		);

		const messages = buildVerificationMessages(prompt, agentResult.responseMessages, expectedColumns, queryResults);

		let sql: string | null = null;
		let error: string | null = null;

		for (let attempt = 0; attempt < MAX_VERIFICATION_ATTEMPTS; attempt++) {
			const result = await generateText({
				...modelConfig,
				output: Output.object({ schema: verificationSchema }),
				messages,
				experimental_telemetry: llmTelemetry('nao-test-verification', { projectId }),
			});

			sql = result.output.sql?.trim() || null;
			if (!sql) {
				return {
					data: null,
					sql: null,
					sourceQueries: [],
					error: 'The agent could not answer from its query results.',
				};
			}

			try {
				return await runVerificationSql(sql, queryResults);
			} catch (err) {
				error = err instanceof Error ? err.message : String(err);
				messages.push(
					{ role: 'assistant', content: sql },
					{ role: 'user', content: TestAgentService._buildRepairPrompt(error) },
				);
			}
		}

		return { data: null, sql, sourceQueries: sql ? findSourceQueries(sql, queryResults) : [], error };
	}

	private static _buildUserMessage(text: string): UIMessage {
		return {
			id: crypto.randomUUID(),
			role: 'user',
			parts: [{ type: 'text', text }],
		};
	}

	private static _buildRepairPrompt(error: string): string {
		return `That query failed with: ${error}

Return a corrected DuckDB query, or set sql to null if the tables cannot answer the question.`;
	}

	/**
	 * Extract tool calls from agent result steps.
	 * Collects all tool calls and their results or errors from every step.
	 */
	static extractToolCalls(result: AgentRunResult): ToolCallResult[] {
		const resultByCallId = new Map<string, unknown>();
		const errorByCallId = new Map<string, string>();
		const toolCalls: ToolCallResult[] = [];

		for (const step of result.steps) {
			for (const tr of step.toolResults) {
				resultByCallId.set(tr.toolCallId, tr.output);
			}
			for (const part of step.content) {
				if (part.type === 'tool-error') {
					errorByCallId.set(part.toolCallId, getErrorMessage(part.error) ?? 'Unknown error');
				}
			}
			for (const tc of step.toolCalls) {
				toolCalls.push({
					toolName: tc.toolName,
					toolCallId: tc.toolCallId,
					args: tc.input as Record<string, unknown>,
					result: resultByCallId.get(tc.toolCallId),
					error: errorByCallId.get(tc.toolCallId),
				});
			}
		}

		return toolCalls;
	}
}

// Singleton instance of the test agent service
export const testAgentService = new TestAgentService();

/** Runs a verifier-authored DuckDB query over the rows captured from the agent. */
export async function runVerificationSql(
	sql: string,
	queryResults: Map<string, QueryResult>,
): Promise<VerificationResult> {
	const { data } = await runSqlOverQueryResults(queryResults, sql);
	return { data, sql, sourceQueries: findSourceQueries(sql, queryResults), error: null };
}

/** The queries of the chat whose result tables the verification SQL names, in the order they ran. */
export function findSourceQueries(sql: string, queryResults: ReadonlyMap<string, QueryResult>): TestSourceQuery[] {
	const sourceQueries: TestSourceQuery[] = [];
	for (const [queryId, result] of queryResults) {
		if (result.sqlQuery && new RegExp(`\\b${queryId}\\b`).test(sql)) {
			sourceQueries.push({ id: queryId, sql: result.sqlQuery });
		}
	}
	return sourceQueries;
}
