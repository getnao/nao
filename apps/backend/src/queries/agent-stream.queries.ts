import { and, asc, eq, gt, lt } from 'drizzle-orm';

import s from '../db/abstractSchema';
import { db } from '../db/db';
import { databaseNow, databaseTimeIn } from './database-time';

export type StreamRunState = 'live' | 'stale' | 'gone';

export interface StreamChunkRow {
	seq: number;
	chunks: unknown[];
	isFinal: boolean;
}

export async function upsertStreamRun(chatId: string, streamId: string): Promise<void> {
	await db
		.insert(s.agentStreamRun)
		.values({ chatId, streamId, heartbeatAt: databaseNow })
		.onConflictDoUpdate({ target: s.agentStreamRun.chatId, set: { streamId, heartbeatAt: databaseNow } });
}

export async function touchStreamRun(streamId: string): Promise<void> {
	await db.update(s.agentStreamRun).set({ heartbeatAt: databaseNow }).where(eq(s.agentStreamRun.streamId, streamId));
}

export async function deleteStreamRun(streamId: string): Promise<void> {
	await db.delete(s.agentStreamRun).where(eq(s.agentStreamRun.streamId, streamId));
}

/** The stream of the chat's run, unless the instance running it stopped beating. */
export async function getLiveStreamId(chatId: string, heartbeatTtlMs: number): Promise<string | undefined> {
	const [run] = await db
		.select({ streamId: s.agentStreamRun.streamId })
		.from(s.agentStreamRun)
		.where(
			and(eq(s.agentStreamRun.chatId, chatId), gt(s.agentStreamRun.heartbeatAt, databaseTimeIn(-heartbeatTtlMs))),
		);
	return run?.streamId;
}

export async function listLiveStreamChatIds(userId: string, heartbeatTtlMs: number): Promise<string[]> {
	const runs = await db
		.select({ chatId: s.agentStreamRun.chatId })
		.from(s.agentStreamRun)
		.innerJoin(s.chat, eq(s.chat.id, s.agentStreamRun.chatId))
		.where(and(eq(s.chat.userId, userId), gt(s.agentStreamRun.heartbeatAt, databaseTimeIn(-heartbeatTtlMs))));
	return runs.map((run) => run.chatId);
}

export async function getStreamRunState(streamId: string, heartbeatTtlMs: number): Promise<StreamRunState> {
	const [run] = await db
		.select({ isLive: gt(s.agentStreamRun.heartbeatAt, databaseTimeIn(-heartbeatTtlMs)) })
		.from(s.agentStreamRun)
		.where(eq(s.agentStreamRun.streamId, streamId));
	if (!run) {
		return 'gone';
	}
	return run.isLive ? 'live' : 'stale';
}

export async function insertStreamChunks(streamId: string, row: StreamChunkRow): Promise<void> {
	await db.insert(s.agentStreamChunk).values({ streamId, ...row });
}

export async function getStreamChunksAfter(streamId: string, afterSeq: number): Promise<StreamChunkRow[]> {
	return db
		.select({ seq: s.agentStreamChunk.seq, chunks: s.agentStreamChunk.chunks, isFinal: s.agentStreamChunk.isFinal })
		.from(s.agentStreamChunk)
		.where(and(eq(s.agentStreamChunk.streamId, streamId), gt(s.agentStreamChunk.seq, afterSeq)))
		.orderBy(asc(s.agentStreamChunk.seq));
}

export async function deleteStreamChunks(streamId: string): Promise<void> {
	await db.delete(s.agentStreamChunk).where(eq(s.agentStreamChunk.streamId, streamId));
}

/** Clears what instances that died mid-run left behind. */
export async function deleteExpiredStreams(olderThanMs: number): Promise<void> {
	const cutoff = databaseTimeIn(-olderThanMs);
	await db.delete(s.agentStreamChunk).where(lt(s.agentStreamChunk.createdAt, cutoff));
	await db.delete(s.agentStreamRun).where(lt(s.agentStreamRun.heartbeatAt, cutoff));
}
