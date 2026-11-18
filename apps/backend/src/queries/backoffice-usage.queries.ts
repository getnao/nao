/* @license Enterprise */

import { and, count, eq, gte, isNotNull, sql } from 'drizzle-orm';

import s from '../db/abstractSchema';
import { db } from '../db/db';

export async function getModelsUsage(cutoff: Date) {
	const [messages, inferences] = await Promise.all([
		getModelRows(s.chatMessage, s.chatMessage.createdAt, cutoff),
		getModelRows(s.llmInference, s.llmInference.createdAt, cutoff),
	]);
	const combined = new Map<string, (typeof messages)[number]>();
	for (const row of [...messages, ...inferences]) {
		const key = `${row.llmProvider}\u0000${row.llmModelId}`;
		const current = combined.get(key);
		combined.set(key, {
			llmProvider: row.llmProvider,
			llmModelId: row.llmModelId,
			inferences: Number(row.inferences) + Number(current?.inferences ?? 0),
			inputTokens: Number(row.inputTokens) + Number(current?.inputTokens ?? 0),
			outputTokens: Number(row.outputTokens) + Number(current?.outputTokens ?? 0),
		});
	}
	return [...combined.values()].sort((a, b) => b.inferences - a.inferences).slice(0, 20);
}

export async function getProjectTokens(projectId: string, cutoff: Date) {
	const [messages, inferences] = await Promise.all([
		sumProjectMessageTokens(projectId, cutoff),
		sumTokens(s.llmInference, and(eq(s.llmInference.projectId, projectId), gte(s.llmInference.createdAt, cutoff))),
	]);
	return {
		inputTokens: messages.inputTokens + inferences.inputTokens,
		outputTokens: messages.outputTokens + inferences.outputTokens,
	};
}

export async function getInferenceTokens(cutoff: Date) {
	return sumTokens(s.llmInference, gte(s.llmInference.createdAt, cutoff));
}

async function getModelRows(
	table: typeof s.chatMessage | typeof s.llmInference,
	createdAt: typeof s.chatMessage.createdAt | typeof s.llmInference.createdAt,
	cutoff: Date,
) {
	return db
		.select({
			llmProvider: table.llmProvider,
			llmModelId: table.llmModelId,
			inferences: count(),
			inputTokens: sql<number>`coalesce(sum(${table.inputTotalTokens}), 0)`,
			outputTokens: sql<number>`coalesce(sum(${table.outputTotalTokens}), 0)`,
		})
		.from(table)
		.where(and(gte(createdAt, cutoff), isNotNull(table.llmProvider), isNotNull(table.llmModelId)))
		.groupBy(table.llmProvider, table.llmModelId)
		.execute() as Promise<
		Array<{
			llmProvider: string;
			llmModelId: string;
			inferences: number;
			inputTokens: number;
			outputTokens: number;
		}>
	>;
}

async function sumProjectMessageTokens(projectId: string, cutoff: Date) {
	const [row] = await db
		.select({
			inputTokens: sql<number>`coalesce(sum(${s.chatMessage.inputTotalTokens}), 0)`,
			outputTokens: sql<number>`coalesce(sum(${s.chatMessage.outputTotalTokens}), 0)`,
		})
		.from(s.chatMessage)
		.innerJoin(s.chat, eq(s.chat.id, s.chatMessage.chatId))
		.where(and(eq(s.chat.projectId, projectId), gte(s.chatMessage.createdAt, cutoff)))
		.execute();
	return {
		inputTokens: Number(row?.inputTokens ?? 0),
		outputTokens: Number(row?.outputTokens ?? 0),
	};
}

async function sumTokens(
	table: typeof s.chatMessage | typeof s.llmInference,
	filter: ReturnType<typeof and> | ReturnType<typeof gte>,
) {
	const [row] = await db
		.select({
			inputTokens: sql<number>`coalesce(sum(${table.inputTotalTokens}), 0)`,
			outputTokens: sql<number>`coalesce(sum(${table.outputTotalTokens}), 0)`,
		})
		.from(table)
		.where(filter)
		.execute();
	return {
		inputTokens: Number(row?.inputTokens ?? 0),
		outputTokens: Number(row?.outputTokens ?? 0),
	};
}
