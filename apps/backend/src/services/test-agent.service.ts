import { generateText, ModelMessage, Output } from 'ai';
import { z } from 'zod/v4';

import type { UIMessage } from '../types/chat';
import { AgentRunResult, AgentService, ModelSelection } from './agent.service';

type VerificationData = Record<string, string | number | boolean | null>[] | null;

export interface ToolCallResult {
	toolName: string;
	toolCallId: string;
	args: Record<string, unknown>;
	result?: unknown;
}

export class TestAgentService extends AgentService {
	/**
	 * Run a single prompt without persisting to a chat.
	 * Used for testing/evaluation purposes.
	 */
	async runTest(projectId: string, prompt: string, modelSelection?: ModelSelection): Promise<AgentRunResult> {
		const userMessage = TestAgentService._buildUserMessage(prompt);

		const tempChat = {
			id: crypto.randomUUID(),
			title: 'Test',
			createdAt: Date.now(),
			updatedAt: Date.now(),
			messages: [userMessage],
			userId: 'test',
			projectId,
		};

		const agent = await this.create(tempChat, new AbortController(), modelSelection);
		return agent.generate([userMessage]);
	}

	/**
	 * Run a verification prompt to extract structured data from the agent's response.
	 * Uses the responseMessages directly from the agent result to avoid double transformation.
	 */
	async runVerification(
		projectId: string,
		agentResult: AgentRunResult,
		expectedColumns: string[],
		modelSelection?: ModelSelection,
	): Promise<{ data: VerificationData }> {
		const resolvedModelSelection = await this._getResolvedModelSelection(projectId, modelSelection);
		const modelConfig = await this._getModelConfig(projectId, resolvedModelSelection);

		// Use responseMessages directly and append verification request
		const messages: ModelMessage[] = [
			...agentResult.responseMessages,
			{ role: 'user', content: TestAgentService._buildVerificationPrompt(expectedColumns) },
		];

		const schema = TestAgentService._buildVerificationSchema(expectedColumns);
		const result = await generateText({
			...modelConfig,
			output: Output.object({ schema }),
			messages,
		});

		return { data: result.output.data ?? null };
	}

	private static _buildUserMessage(text: string): UIMessage {
		return {
			id: crypto.randomUUID(),
			role: 'user',
			parts: [{ type: 'text', text }],
		};
	}

	private static _buildVerificationPrompt(columns: string[]): string {
		return `Based on your previous analysis, provide the final answer to the original question.

Format the data with these columns: ${columns.join(', ')}

Return the data as an array of rows, where each row is an object with the column names as keys.

If you cannot answer, set data to null.`;
	}

	private static _buildVerificationSchema(columns: string[]) {
		const valueSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);
		const rowSchema = z.object(
			Object.fromEntries(columns.map((col) => [col, valueSchema.describe(`Value for column ${col}`)])),
		);

		return z.object({
			data: z
				.nullable(z.array(rowSchema))
				.describe('Array of rows with the data. Return null if unable to answer.'),
		});
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
