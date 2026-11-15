import { databaseNotifications } from '../db/postgres-notifications';
import { ChunkBuffer } from '../utils/chunk-buffer';
import { logger } from '../utils/logger';
import { agentService } from './agent';
import { AgentStreamRelay, type PublishedAgentStream, type UIMessageChunk } from './agent-stream-relay';

/** A run readable from the moment its question is saved, which the agent stream feeds once it is set up. */
export interface OpenAgentStream {
	start(stream: ReadableStream<UIMessageChunk>): ReadableStream<UIMessageChunk>;
	fail(): void;
}

interface LocalStream {
	streamId: string;
	userId: string;
	buffer: ChunkBuffer<UIMessageChunk>;
	published?: Promise<PublishedAgentStream | undefined>;
	replaced?: LocalStream;
	hasEnded: boolean;
}

export const FAILED_STREAM_MESSAGE = 'The agent stream failed.';

/**
 * Runs each web agent stream to its end on the server, so reloading the page or closing the tab never
 * cuts an answer short, and lets any reader replay the run from its start and then follow it live.
 * Readers on another instance go through the relay, which only exists on a database every instance shares.
 */
export class AgentStreamService {
	private readonly _streams = new Map<string, LocalStream>();

	constructor(private readonly _relay: AgentStreamRelay | null) {}

	/** Opens the chat's run. One it replaces, still running, comes back once this one ends. */
	open(chatId: string, userId: string): OpenAgentStream {
		const local: LocalStream = {
			streamId: crypto.randomUUID(),
			userId,
			buffer: new ChunkBuffer(),
			replaced: findRunning(this._streams.get(chatId)),
			hasEnded: false,
		};
		this._streams.set(chatId, local);
		local.published = this._publish(chatId, local);
		const end = () => this._end(chatId, local);
		return {
			start: (stream) => {
				void drainInto(stream, local.buffer).finally(end);
				return local.buffer.read();
			},
			fail: () => {
				local.buffer.push({ type: 'error', errorText: FAILED_STREAM_MESSAGE });
				local.buffer.close();
				void end();
			},
		};
	}

	async read(chatId: string): Promise<ReadableStream<UIMessageChunk> | null> {
		const local = this._streams.get(chatId);
		if (local) {
			return local.buffer.read();
		}
		return (await this._relay?.read(chatId)) ?? null;
	}

	/** The chats of the user with an agent run in progress, on this instance or another one. */
	async listRunningChatIds(userId: string): Promise<string[]> {
		const localChatIds = [...this._streams]
			.filter(([, local]) => local.userId === userId)
			.map(([chatId]) => chatId);
		const relayedChatIds = (await this._relay?.listLiveChatIds(userId)) ?? [];
		return [...new Set([...localChatIds, ...relayedChatIds])];
	}

	/** Asks the instance running the chat's agent to stop it, and returns whether one was running. */
	async requestStopElsewhere(chatId: string): Promise<boolean> {
		return (await this._relay?.requestStop(chatId)) ?? false;
	}

	async waitUntilEndedElsewhere(chatId: string, timeoutMs: number): Promise<void> {
		await this._relay?.waitUntilEnded(chatId, timeoutMs);
	}

	private async _publish(chatId: string, local: LocalStream): Promise<PublishedAgentStream | undefined> {
		try {
			return await this._relay?.publish(chatId, local.streamId, local.buffer);
		} catch (error) {
			logStreamError('Failed to publish an agent stream to other instances', chatId, error);
			return undefined;
		}
	}

	private async _end(chatId: string, local: LocalStream): Promise<void> {
		local.hasEnded = true;
		const isCurrent = this._streams.get(chatId) === local;
		const restored = isCurrent ? findRunning(local.replaced) : undefined;
		if (isCurrent) {
			this._setOrDelete(chatId, restored);
		}
		try {
			await (await local.published)?.end();
			await (await restored?.published)?.reclaim();
		} catch (error) {
			logStreamError('Failed to end a published agent stream', chatId, error);
		}
	}

	private _setOrDelete(chatId: string, local: LocalStream | undefined): void {
		if (local) {
			this._streams.set(chatId, local);
		} else {
			this._streams.delete(chatId);
		}
	}
}

async function drainInto(stream: ReadableStream<UIMessageChunk>, buffer: ChunkBuffer<UIMessageChunk>): Promise<void> {
	const reader = stream.getReader();
	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) {
				return;
			}
			buffer.push(value);
		}
	} catch (error) {
		buffer.push({ type: 'error', errorText: FAILED_STREAM_MESSAGE });
		logger.error(`Agent stream failed: ${String(error)}`, { source: 'agent' });
	} finally {
		buffer.close();
	}
}

function findRunning(local: LocalStream | undefined): LocalStream | undefined {
	let candidate = local;
	while (candidate?.hasEnded) {
		candidate = candidate.replaced;
	}
	return candidate;
}

function logStreamError(message: string, chatId: string, error: unknown): void {
	logger.error(`${message}: ${String(error)}`, { source: 'agent', context: { chatId } });
}

export const agentStreamService = new AgentStreamService(
	databaseNotifications
		? new AgentStreamRelay(databaseNotifications, (chatId) => agentService.get(chatId)?.stop())
		: null,
);
