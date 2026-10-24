import { desc, eq } from 'drizzle-orm';

import type { NewMcpCallLog } from '../db/abstractSchema';
import s from '../db/abstractSchema';
import { db } from '../db/db';
import { lockForUpdate } from '../db/lock-for-update';
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

/** Merges under a row lock: a lost "off" would leave the endpoint answering MCP clients. */
export async function updateMcpEndpointSettings(
	projectId: string,
	settings: Partial<McpEndpointSettings>,
): Promise<McpEndpointSettings> {
	return db.transaction(async (tx) => {
		const [row] = await lockForUpdate(
			tx
				.select({ mcpEndpointSettings: s.project.mcpEndpointSettings })
				.from(s.project)
				.where(eq(s.project.id, projectId)),
		).execute();
		const merged = { ...(row?.mcpEndpointSettings ?? defaultMcpEndpointSettings()), ...settings };

		await tx.update(s.project).set({ mcpEndpointSettings: merged }).where(eq(s.project.id, projectId)).execute();

		return merged;
	});
}

export async function insertMcpCallLog(entry: Omit<NewMcpCallLog, 'calledAt'>): Promise<void> {
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
