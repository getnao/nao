import { z } from 'zod';

import { QueryAppDbOutput, renderToModelOutput } from '../../components/tool-outputs';
import { runScopedAppDbQuery } from '../../db/readonly-app-db';
import { ALLOWED_APP_DB_VIEWS, validateAppDbQuery } from '../../utils/app-db-allowlist';
import { explainAppDbError } from '../../utils/app-db-errors';
import { createTool } from '../../utils/tools';

const InputSchema = z.object({
	sql: z.string().describe('A read-only SELECT/WITH query over the allowlisted, project-scoped views.'),
});
type Input = z.infer<typeof InputSchema>;

export interface QueryAppDbResult {
	_version: '1';
	columns: string[];
	rows: Record<string, unknown>[];
	rowCount: number;
}

export async function queryAppDb(projectId: string, sql: string): Promise<QueryAppDbResult> {
	const verdict = await validateAppDbQuery(sql);
	if (!verdict.ok) {
		throw new Error(verdict.reason ?? 'Query rejected.');
	}
	try {
		const { columns, rows } = await runScopedAppDbQuery(projectId, sql);
		return { _version: '1', columns, rows, rowCount: rows.length };
	} catch (error) {
		throw new Error(explainAppDbError(error), { cause: error });
	}
}

export function createQueryAppDbTool(projectId: string) {
	return createTool<Input, QueryAppDbResult>({
		description: `Run a read-only SQL query over the nao app database to mine usage signal. Only SELECT/WITH over these project-scoped views is allowed: ${ALLOWED_APP_DB_VIEWS.join(', ')}.`,
		inputSchema: InputSchema,
		execute: async ({ sql }) => queryAppDb(projectId, sql),
		toModelOutput: ({ output }) => renderToModelOutput(QueryAppDbOutput({ output }), output),
	});
}
