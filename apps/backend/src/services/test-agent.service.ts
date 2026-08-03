import type { LlmSelectedModel } from '@nao/shared/types';
import { generateText, ModelMessage, Output } from 'ai';
import { z } from 'zod/v4';

import { llmTelemetry } from '../agents/telemetry';
import type { UIMessage } from '../types/chat';
import type { ModelCosts } from '../types/llm';
import type { QueryResult } from '../types/tools';
import { AgentRunResult, AgentService } from './agent';
import { runSqlOverQueryResults } from './duckdb.service';

export interface VerificationResult {
	/** Rows the verification query returned, or null when no answer could be produced */
	data: Record<string, unknown>[] | null;
	/** The DuckDB query the agent wrote over its own query results */
	sql: string | null;
	error: string | null;
}

export interface ToolCallResult {
	toolName: string;
	toolCallId: string;
	args: Record<string, unknown>;
	result?: unknown;
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
		prompt: string,
		modelSelection?: LlmSelectedModel,
		costs?: ModelCosts,
	): Promise<AgentRunResult> {
		const userMessage = TestAgentService._buildUserMessage(prompt);

		const tempChat = {
			id: crypto.randomUUID(),
			title: 'Test',
			createdAt: Date.now(),
			updatedAt: Date.now(),
			messages: [userMessage],
			userId: 'test',
			projectId,
			testMode: true,
		};

		const agent = await this.create(tempChat, modelSelection);
		return agent.generate([userMessage], { costs });
	}

	/**
	 * Ask the agent to express its final answer as a DuckDB query over the rows it
	 * already fetched, then run it. Reusing the stored rows keeps the answer exact
	 * and costs a few tokens of SQL instead of a full serialisation of the data.
	 */
	async runVerification(
		projectId: string,
		agentResult: AgentRunResult,
		expectedColumns: string[],
		modelSelection?: LlmSelectedModel,
	): Promise<VerificationResult> {
		const { queryResults } = agentResult;
		if (queryResults.size === 0) {
			return { data: null, sql: null, error: 'The agent did not run any SQL query.' };
		}

		const resolvedSelectedModel = await this._getResolvedLlmSelectedModel(projectId, modelSelection);
		const modelConfig = await this._getModelConfig(projectId, resolvedSelectedModel);

		const messages: ModelMessage[] = [
			...agentResult.responseMessages,
			{ role: 'user', content: TestAgentService._buildVerificationPrompt(expectedColumns, queryResults) },
		];

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
				return { data: null, sql: null, error: 'The agent could not answer from its query results.' };
			}

			try {
				const { data } = await runSqlOverQueryResults(queryResults, sql);
				return { data, sql, error: null };
			} catch (err) {
				error = err instanceof Error ? err.message : String(err);
				messages.push(
					{ role: 'assistant', content: sql },
					{ role: 'user', content: TestAgentService._buildRepairPrompt(error) },
				);
			}
		}

		return { data: null, sql, error };
	}

	private static _buildUserMessage(text: string): UIMessage {
		return {
			id: crypto.randomUUID(),
			role: 'user',
			parts: [{ type: 'text', text }],
		};
	}

	private static _buildVerificationPrompt(columns: string[], queryResults: Map<string, QueryResult>): string {
		const tables = [...queryResults.entries()]
			.map(([queryId, result]) => `- ${queryId} (${result.data.length} rows): ${result.columns.join(', ')}`)
			.join('\n');

		return `Based on your previous analysis, write a DuckDB query returning the final answer to the original question.

Every query you ran is loaded in DuckDB as a table named after its query id:
${tables}

Rules:
- Only read from the tables above, the warehouse is not reachable anymore.
- Return exactly these columns, with these names: ${columns.join(', ')}
- Read the values from the tables, never retype them as literals.
- Apply the same filters, aggregations and ordering as the answer you gave.
- Set sql to null if these tables cannot answer the question.`;
	}

	private static _buildRepairPrompt(error: string): string {
		return `That query failed with: ${error}

Return a corrected DuckDB query, or set sql to null if the tables cannot answer the question.`;
	}

	/**
	 * Extract tool calls from agent result steps.
	 * Collects all tool calls and their results from every step.
	 */
	static extractToolCalls(result: AgentRunResult): ToolCallResult[] {
		const resultByCallId = new Map<string, unknown>();
		const toolCalls: ToolCallResult[] = [];

		for (const step of result.steps) {
			for (const tr of step.toolResults) {
				resultByCallId.set(tr.toolCallId, tr.output);
			}
			for (const tc of step.toolCalls) {
				toolCalls.push({
					toolName: tc.toolName,
					toolCallId: tc.toolCallId,
					args: tc.input as Record<string, unknown>,
					result: resultByCallId.get(tc.toolCallId),
				});
			}
		}

		return toolCalls;
	}
}

// Singleton instance of the test agent service
export const testAgentService = new TestAgentService();
