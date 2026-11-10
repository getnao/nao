import { and, asc, desc, eq, gt } from 'drizzle-orm';

import type { NewMcpCallLog } from '../db/abstractSchema';
import s from '../db/abstractSchema';
import { db } from '../db/db';
import { env } from '../env';
import { DEFAULT_MCP_ENDPOINT_SETTINGS, type McpEndpointSettings } from '../types/mcp-endpoint';

export async function getMcpEndpointSettings(projectId: string): Promise<McpEndpointSettings> {
	const [row] = await db
		.select({ mcpEndpointSettings: s.project.mcpEndpointSettings })
		.from(s.project)
		.where(eq(s.project.id, projectId))
		.limit(1)
		.execute();

	return row?.mcpEndpointSettings ?? defaultMcpEndpointSettings();
}

/** Built-in defaults, with MCP_ENDPOINT_ENABLED as the deployment's opinion on the toggle. */
function defaultMcpEndpointSettings(): McpEndpointSettings {
	if (env.MCP_ENDPOINT_ENABLED === undefined) {
		return DEFAULT_MCP_ENDPOINT_SETTINGS;
	}
	return { ...DEFAULT_MCP_ENDPOINT_SETTINGS, enabled: env.MCP_ENDPOINT_ENABLED };
}

export async function updateMcpEndpointSettings(
	projectId: string,
	settings: Partial<McpEndpointSettings>,
): Promise<McpEndpointSettings> {
	const current = await getMcpEndpointSettings(projectId);
	const merged = { ...current, ...settings };

	await db.update(s.project).set({ mcpEndpointSettings: merged }).where(eq(s.project.id, projectId)).execute();

	return merged;
}

export async function insertMcpCallLog(entry: NewMcpCallLog): Promise<void> {
	await db.insert(s.mcpCallLog).values(entry).execute();
}

export async function getRecentMcpCallLogs(projectId: string, limit = 50) {
	return db
		.select({
			id: s.mcpCallLog.id,
			userId: s.mcpCallLog.userId,
			userName: s.user.name,
			toolName: s.mcpCallLog.toolName,
			durationMs: s.mcpCallLog.durationMs,
			success: s.mcpCallLog.success,
			toolInput: s.mcpCallLog.toolInput,
			toolOutput: s.mcpCallLog.toolOutput,
			calledAt: s.mcpCallLog.calledAt,
		})
		.from(s.mcpCallLog)
		.leftJoin(s.user, eq(s.mcpCallLog.userId, s.user.id))
		.where(eq(s.mcpCallLog.projectId, projectId))
		.orderBy(desc(s.mcpCallLog.calledAt))
		.limit(limit)
		.execute();
}

export async function getTestAttemptMcpCallLogs(projectId: string, userId: string, testAttemptId: string) {
	return db
		.select({
			id: s.mcpCallLog.id,
			toolName: s.mcpCallLog.toolName,
			durationMs: s.mcpCallLog.durationMs,
			success: s.mcpCallLog.success,
			toolInput: s.mcpCallLog.toolInput,
			toolOutput: s.mcpCallLog.toolOutput,
			calledAt: s.mcpCallLog.calledAt,
			queryId: s.mcpQueryData.queryId,
			queryColumns: s.mcpQueryData.columns,
			queryData: s.mcpQueryData.data,
		})
		.from(s.mcpCallLog)
		.leftJoin(
			s.mcpQueryData,
			and(eq(s.mcpQueryData.callLogId, s.mcpCallLog.id), gt(s.mcpQueryData.expiresAt, new Date())),
		)
		.where(
			and(
				eq(s.mcpCallLog.projectId, projectId),
				eq(s.mcpCallLog.userId, userId),
				eq(s.mcpCallLog.testAttemptId, testAttemptId),
			),
		)
		.orderBy(asc(s.mcpCallLog.calledAt), asc(s.mcpCallLog.id))
		.execute();
}
