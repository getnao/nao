import { anthropic, AnthropicProviderOptions } from '@ai-sdk/anthropic';
import { openai, OpenAIResponsesProviderOptions } from '@ai-sdk/openai';
import {
	convertToModelMessages,
	createUIMessageStream,
	StreamTextResult,
	ToolLoopAgent,
	ToolLoopAgentSettings,
} from 'ai';

import { getInstructions } from '../agents/prompt';
import { tools } from '../agents/tools';
import * as chatQueries from '../queries/chat.queries';
import { UIChat, UIMessage } from '../types/chat';
import { convertToTokenUsage } from '../utils/chat';

type AgentChat = UIChat & {
	userId: string;
};

class AgentService {
	private _agents = new Map<string, AgentManager>();

	create(chat: AgentChat, abortController: AbortController): AgentManager {
		this._disposeAgent(chat.id);
		const agent = new AgentManager(chat, () => this._agents.delete(chat.id), abortController);
		this._agents.set(chat.id, agent);
		return agent;
	}

	private _disposeAgent(chatId: string): void {
		const agent = this._agents.get(chatId);
		if (!agent) {
			return;
		}
		agent.stop();
		this._agents.delete(chatId);
	}

	get(chatId: string): AgentManager | undefined {
		return this._agents.get(chatId);
	}
}

class AgentManager {
	private readonly _agent: ToolLoopAgent<never, typeof tools, never>;

	constructor(
		readonly chat: AgentChat,
		private readonly _onDispose: () => void,
		private readonly _abortController: AbortController,
	) {
		this._agent = new ToolLoopAgent({
			...this._chooseModelConfigBasedOnEnv(),
			tools,
			instructions: getInstructions(),
		});
	}

	private _chooseModelConfigBasedOnEnv(): Pick<ToolLoopAgentSettings, 'model' | 'providerOptions'> {
		if (process.env.ANTHROPIC_API_KEY) {
			return {
				model: anthropic.chat('claude-opus-4-5'),
				providerOptions: {
					anthropic: {
						disableParallelToolUse: false,
						thinking: {
							type: 'enabled',
							budgetTokens: 12_000,
						},
					} satisfies AnthropicProviderOptions,
				},
			};
		}

		if (process.env.OPENAI_API_KEY) {
			return {
				model: openai.chat('gpt-5.1'),
				providerOptions: {
					openai: {
						// TODO: Add config for openai
					} satisfies OpenAIResponsesProviderOptions,
				},
			};
		}

		throw new Error(
			'No LLM API key found. You must set the ANTHROPIC_API_KEY or OPENAI_API_KEY environment variable to use the agent.',
		);
	}

	stream(
		messages: UIMessage[],
		opts: {
			sendNewChatData: boolean;
		},
	): ReadableStream {
		let error: unknown = undefined;
		let result: StreamTextResult<typeof tools, never>;
		return createUIMessageStream<UIMessage>({
			generateId: () => crypto.randomUUID(),
			execute: async ({ writer }) => {
				if (opts.sendNewChatData) {
					writer.write({
						type: 'data-newChat',
						data: {
							id: this.chat.id,
							title: this.chat.title,
							createdAt: this.chat.createdAt,
							updatedAt: this.chat.updatedAt,
						},
					});
				}

				result = await this._agent.stream({
					messages: await convertToModelMessages(messages),
					abortSignal: this._abortController.signal,
				});

				writer.merge(result.toUIMessageStream({}));
			},
			onError: (err) => {
				error = err;
				return String(err);
			},
			onFinish: async (e) => {
				const stopReason = e.isAborted ? 'interrupted' : e.finishReason;
				const tokenUsage = convertToTokenUsage(await result.totalUsage);
				await chatQueries.upsertMessage(e.responseMessage, {
					chatId: this.chat.id,
					stopReason,
					error,
					tokenUsage,
				});
				this._onDispose();
			},
		});
	}

	checkIsUserOwner(userId: string): boolean {
		return this.chat.userId === userId;
	}

	stop(): void {
		this._abortController.abort();
	}
}

// Singleton instance of the agent service
export const agentService = new AgentService();
