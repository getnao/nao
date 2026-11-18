import type { InferUIMessageChunk } from 'ai';

import type { DatabaseNotifications } from '../db/postgres-notifications';
import * as agentStreamQueries from '../queries/agent-stream.queries';
import type { UIMessage } from '../types/chat';
import type { ChunkBuffer } from '../utils/chunk-buffer';
import { logger } from '../utils/logger';

export type UIMessageChunk = InferUIMessageChunk<UIMessage>;

export interface AgentStreamRelayTimings {
	flushIntervalMs: number;
	heartbeatIntervalMs: number;
	heartbeatTtlMs: number;
	readPollMs: number;
	chunkRetentionMs: number;
	sweepIntervalMs: number;
}

export interface PublishedAgentStream {
	end(): Promise<void>;
}

interface PublishedStream {
	buffer: ChunkBuffer<UIMessageChunk>;
	relayed: RelayProgress;
	relaying?: Promise<void>;
}

interface RelayProgress {
	seq: number;
	index: number;
	isComplete: boolean;
}

interface NextRows {
	rows: agentStreamQueries.StreamChunkRow[];
	runState: agentStreamQueries.StreamRunState;
}

export const INTERRUPTED_RUN_MESSAGE = 'The agent run was interrupted because the server running it stopped.';
export const INCOMPLETE_RELAY_MESSAGE = 'The rest of the answer could not be loaded. Reload the page to see it.';

const CHANNELS = {
	relayRequest: 'agent_stream_relay_request',
	chunks: 'agent_stream_chunks',
	stop: 'agent_stream_stop',
} as const;

const DEFAULT_TIMINGS: AgentStreamRelayTimings = {
	flushIntervalMs: 150,
	heartbeatIntervalMs: 10_000,
	heartbeatTtlMs: 30_000,
	readPollMs: 1_000,
	chunkRetentionMs: 60_000,
	sweepIntervalMs: 5 * 60_000,
};

const STALE_STREAM_MAX_AGE_MS = 60 * 60_000;
const END_POLL_MS = 250;

/**
 * Lets a reader on another instance follow an agent run through the database. The instance running it
 * only writes the chunks once such a reader asks for them, so a run nobody reconnects to costs one row.
 */
export class AgentStreamRelay {
	private readonly _published = new Map<string, PublishedStream>();
	private readonly _chunkWaiters = new Map<string, Set<() => void>>();
	private _listening: Promise<void> | undefined;

	constructor(
		private readonly _notifications: DatabaseNotifications,
		private readonly _onStopRequested: (chatId: string) => void,
		private readonly _timings: AgentStreamRelayTimings = DEFAULT_TIMINGS,
	) {}

	async publish(
		chatId: string,
		streamId: string,
		buffer: ChunkBuffer<UIMessageChunk>,
	): Promise<PublishedAgentStream> {
		await this._listen();
		await agentStreamQueries.upsertStreamRun(chatId, streamId);
		const published: PublishedStream = { buffer, relayed: { seq: 0, index: 0, isComplete: false } };
		this._published.set(streamId, published);
		const heartbeat = setInterval(
			() => void agentStreamQueries.touchStreamRun(streamId).catch(logRelayError),
			this._timings.heartbeatIntervalMs,
		);
		heartbeat.unref();

		return {
			end: async () => {
				clearInterval(heartbeat);
				await published.relaying;
				if (published.relayed.seq > 0 && !published.relayed.isComplete) {
					this._startRelay(streamId);
					await published.relaying;
				}
				this._published.delete(streamId);
				await agentStreamQueries.deleteStreamRun(streamId);
				if (published.relayed.seq > 0) {
					this._deleteChunksLater(streamId);
				}
			},
		};
	}

	async read(chatId: string): Promise<ReadableStream<UIMessageChunk> | null> {
		const streamId = await agentStreamQueries.getLiveStreamId(chatId, this._timings.heartbeatTtlMs);
		if (!streamId) {
			return null;
		}
		await this._listen();
		await this._notifications.notify(CHANNELS.relayRequest, streamId);
		return this._follow(streamId);
	}

	async listLiveChatIds(userId: string): Promise<string[]> {
		return agentStreamQueries.listLiveStreamChatIds(userId, this._timings.heartbeatTtlMs);
	}

	/** Returns whether a live run of the chat was there to stop. */
	async requestStop(chatId: string): Promise<boolean> {
		const streamId = await agentStreamQueries.getLiveStreamId(chatId, this._timings.heartbeatTtlMs);
		if (!streamId) {
			return false;
		}
		await this._notifications.notify(CHANNELS.stop, chatId);
		return true;
	}

	async waitUntilEnded(chatId: string, timeoutMs: number): Promise<void> {
		const deadline = Date.now() + timeoutMs;
		while (Date.now() < deadline) {
			if (!(await agentStreamQueries.getLiveStreamId(chatId, this._timings.heartbeatTtlMs))) {
				return;
			}
			await delay(END_POLL_MS);
		}
	}

	private _listen(): Promise<void> {
		this._listening ??= Promise.all([
			this._notifications.listen(CHANNELS.relayRequest, (streamId) => this._startRelay(streamId)),
			this._notifications.listen(CHANNELS.chunks, (streamId) => this._wakeChunkWaiters(streamId)),
			this._notifications.listen(CHANNELS.stop, (chatId) => this._onStopRequested(chatId)),
		])
			.then(() => this._sweepRegularly())
			.catch((error) => {
				this._listening = undefined;
				throw error;
			});
		return this._listening;
	}

	/** Starts relaying the stream, or picks it up where a failed write left it, since waiting readers keep asking. */
	private _startRelay(streamId: string): void {
		const published = this._published.get(streamId);
		if (!published || published.relaying || published.relayed.isComplete) {
			return;
		}
		published.relaying = this._relay(streamId, published)
			.catch(logRelayError)
			.finally(() => {
				published.relaying = undefined;
			});
	}

	/** Writes what the run produced so far in one row, then what follows in batches until it ends. */
	private async _relay(streamId: string, { buffer, relayed }: PublishedStream): Promise<void> {
		while (!relayed.isComplete) {
			const { chunks, isClosed } = await buffer.next(relayed.index);
			await agentStreamQueries.insertStreamChunks(streamId, { seq: relayed.seq, chunks, isFinal: isClosed });
			relayed.seq++;
			relayed.index += chunks.length;
			relayed.isComplete = isClosed;
			await this._notifications.notify(CHANNELS.chunks, streamId);
			if (!isClosed) {
				await delay(this._timings.flushIntervalMs);
			}
		}
	}

	private _follow(streamId: string): ReadableStream<UIMessageChunk> {
		const abortController = new AbortController();
		let afterSeq = -1;
		return new ReadableStream<UIMessageChunk>({
			pull: async (controller) => {
				const { rows, runState } = await this._nextRows(streamId, afterSeq, abortController.signal);
				if (abortController.signal.aborted) {
					return;
				}
				for (const row of rows) {
					row.chunks.forEach((chunk) => controller.enqueue(chunk as UIMessageChunk));
					afterSeq = row.seq;
					if (row.isFinal) {
						controller.close();
						return;
					}
				}
				if (runState === 'stale') {
					controller.enqueue({ type: 'error', errorText: INTERRUPTED_RUN_MESSAGE });
				}
				if (runState === 'gone' && afterSeq >= 0) {
					controller.enqueue({ type: 'error', errorText: INCOMPLETE_RELAY_MESSAGE });
				}
				if (runState !== 'live') {
					controller.close();
				}
			},
			cancel: () => abortController.abort(),
		});
	}

	/** Waits for the rows after `afterSeq`, or for the run to end without writing them. */
	private async _nextRows(streamId: string, afterSeq: number, signal: AbortSignal): Promise<NextRows> {
		while (!signal.aborted) {
			const rows = await agentStreamQueries.getStreamChunksAfter(streamId, afterSeq);
			if (rows.length > 0) {
				return { rows, runState: 'live' };
			}
			if (await this._waitForChunks(streamId, signal)) {
				continue;
			}
			const runState = await agentStreamQueries.getStreamRunState(streamId, this._timings.heartbeatTtlMs);
			if (runState !== 'live') {
				return { rows: await agentStreamQueries.getStreamChunksAfter(streamId, afterSeq), runState };
			}
			await this._notifications.notify(CHANNELS.relayRequest, streamId);
		}
		return { rows: [], runState: 'gone' };
	}

	/** Resolves `true` when a notification announces new chunks, `false` when the poll interval passes first. */
	private _waitForChunks(streamId: string, signal: AbortSignal): Promise<boolean> {
		return new Promise((resolve) => {
			const waiters = this._chunkWaiters.get(streamId) ?? new Set();
			this._chunkWaiters.set(streamId, waiters);
			const settle = (notified: boolean) => {
				clearTimeout(timer);
				signal.removeEventListener('abort', onAbort);
				waiters.delete(onChunks);
				if (waiters.size === 0 && this._chunkWaiters.get(streamId) === waiters) {
					this._chunkWaiters.delete(streamId);
				}
				resolve(notified);
			};
			const onChunks = () => settle(true);
			const onAbort = () => settle(false);
			const timer = setTimeout(() => settle(false), this._timings.readPollMs);
			waiters.add(onChunks);
			signal.addEventListener('abort', onAbort);
		});
	}

	private _wakeChunkWaiters(streamId: string): void {
		[...(this._chunkWaiters.get(streamId) ?? [])].forEach((wake) => wake());
	}

	private _deleteChunksLater(streamId: string): void {
		const timer = setTimeout(
			() => void agentStreamQueries.deleteStreamChunks(streamId).catch(logRelayError),
			this._timings.chunkRetentionMs,
		);
		timer.unref();
	}

	private _sweepRegularly(): void {
		const timer = setInterval(
			() => void agentStreamQueries.deleteExpiredStreams(STALE_STREAM_MAX_AGE_MS).catch(logRelayError),
			this._timings.sweepIntervalMs,
		);
		timer.unref();
	}
}

function delay(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function logRelayError(error: unknown): void {
	logger.error(`Agent stream relay failed: ${String(error)}`, { source: 'agent' });
}
