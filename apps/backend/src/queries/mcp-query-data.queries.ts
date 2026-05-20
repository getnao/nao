import { MCP_QUERY_DATA_RETENTION_MS } from '@nao/shared';
import { and, eq, gt } from 'drizzle-orm';

import s from '../db/abstractSchema';
import { db } from '../db/db';

export async function upsertMcpQueryData(
	queryId: string,
	callLogId: string,
	projectId: string,
	columns: string[],
	data: Record<string, unknown>[],
	options?: { sourceChatId?: string | null },
): Promise<void> {
	const expiresAt = new Date(Date.now() + MCP_QUERY_DATA_RETENTION_MS);
	const sourceChatId = options?.sourceChatId ?? null;
	await db
		.insert(s.mcpQueryData)
		.values({ queryId, callLogId, projectId, columns, data, expiresAt, sourceChatId })
		.onConflictDoUpdate({
			target: s.mcpQueryData.queryId,
			set: { callLogId, columns, data, expiresAt, sourceChatId },
		})
		.execute();
}

export async function getMcpQueryData(
	queryId: string,
	projectId: string,
): Promise<{ columns: string[]; data: Record<string, unknown>[]; sourceChatId: string | null } | null> {
	const [row] = await db
		.select({
			columns: s.mcpQueryData.columns,
			data: s.mcpQueryData.data,
			sourceChatId: s.mcpQueryData.sourceChatId,
		})
		.from(s.mcpQueryData)
		.where(
			and(
				eq(s.mcpQueryData.queryId, queryId),
				eq(s.mcpQueryData.projectId, projectId),
				gt(s.mcpQueryData.expiresAt, new Date()),
			),
		)
		.execute();

	if (!row) {
		return null;
	}
	return {
		columns: row.columns as string[],
		data: row.data as Record<string, unknown>[],
		sourceChatId: row.sourceChatId ?? null,
	};
}
