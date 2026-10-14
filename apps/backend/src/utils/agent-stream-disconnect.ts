import type { FastifyReply, FastifyRequest } from 'fastify';

import type { AgentManager } from '../services/agent';
import { logger } from './logger';

interface AgentStreamDisconnectContext {
	request: FastifyRequest;
	reply: FastifyReply;
	agent: Pick<AgentManager, 'isStopped' | 'waitUntilFinished'>;
	userId: string;
	projectId: string | undefined;
	chatId: string;
	modelId: string;
}

interface DisconnectTimings {
	startedAt: number;
	lastChunkAt: number;
	closedAt: number;
}

/**
 * Logs when the connection of an agent stream closes before the response is complete, e.g. a proxy
 * idle timeout or a network drop. The Stop button also closes the connection before the stop request
 * reaches the agent, so the decision waits for the run to end and skips runs the user stopped.
 */
export function trackAgentStreamDisconnect<T>(
	stream: ReadableStream<T>,
	context: AgentStreamDisconnectContext,
): ReadableStream<T> {
	const startedAt = Date.now();
	let lastChunkAt = startedAt;

	context.reply.raw.once('close', () => {
		if (!context.reply.raw.writableFinished) {
			void logUnlessStoppedByUser(context, { startedAt, lastChunkAt, closedAt: Date.now() });
		}
	});

	return stream.pipeThrough(
		new TransformStream<T, T>({
			transform(chunk, controller) {
				lastChunkAt = Date.now();
				controller.enqueue(chunk);
			},
		}),
	);
}

async function logUnlessStoppedByUser(context: AgentStreamDisconnectContext, timings: DisconnectTimings) {
	await context.agent.waitUntilFinished();
	if (context.agent.isStopped) {
		return;
	}

	const { request } = context;
	logger.error('Agent stream connection closed before the response was complete', {
		source: 'agent',
		projectId: context.projectId,
		context: {
			chatId: context.chatId,
			userId: context.userId,
			modelId: context.modelId,
			streamDurationSeconds: toSeconds(timings.closedAt - timings.startedAt),
			secondsSinceLastChunk: toSeconds(timings.closedAt - timings.lastChunkAt),
			runFinishedSecondsAfterDisconnect: toSeconds(Date.now() - timings.closedAt),
			userAgent: request.headers['user-agent'],
			host: request.headers['x-forwarded-host'] || request.headers.host,
		},
	});
}

function toSeconds(milliseconds: number): number {
	return Math.round(milliseconds / 100) / 10;
}
