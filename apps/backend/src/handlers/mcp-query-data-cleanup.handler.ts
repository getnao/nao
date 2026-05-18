import { lt } from 'drizzle-orm';

import s from '../db/abstractSchema';
import { db } from '../db/db';
import type { JobHandler } from '../services/scheduler.service';

export const MCP_QUERY_DATA_CLEANUP_JOB_NAME = 'mcp.queryData.cleanup';

export async function runMcpQueryDataCleanup(): Promise<void> {
	await db.delete(s.mcpQueryData).where(lt(s.mcpQueryData.expiresAt, new Date())).execute();
}

export const mcpQueryDataCleanupHandler: JobHandler = async () => {
	await runMcpQueryDataCleanup();
};
