import { openai } from '@ai-sdk/openai';
import { convertToModelMessages, createUIMessageStream, ToolLoopAgent } from 'ai';

import { tools } from '../agents/tools';
import * as chatQueries from '../queries/chatQueries';
import { UIChat, UIMessage } from '../types/chat';

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
			model: openai.chat('gpt-5.1'),
			tools,
		});
	}

	stream(
		messages: UIMessage[],
		opts: {
			sendNewChatData: boolean;
		},
	): ReadableStream {
		let error: unknown = undefined;
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

				const result = await this._agent.stream({
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
				console.log('[ON FINISH]', e.isAborted, e.finishReason);
				const stopReason = e.isAborted ? 'interrupted' : e.finishReason;
				await chatQueries.upsertMessage(e.responseMessage, {
					chatId: this.chat.id,
					stopReason,
					error,
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
