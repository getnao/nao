import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import executeSqlTool from '../../agents/tools/execute-sql';
import { CONTEXT_LAYER_GUIDANCE } from '../context-layer-guidance';
import type { McpContext } from '../logging';
import { registerAgentToolAsMcp } from './wrap-agent-tool';

const EXECUTE_SQL_DESCRIPTION =
	`${CONTEXT_LAYER_GUIDANCE}\n\n` +
	'Run a SQL query against the connected data warehouse. Returns rows as JSON, including an `id` ' +
	'(e.g. "query_a1b2c3d4"). Use that `id` with `build_chart`, or as the `query_id` in `<chart>` / `<table>` blocks ' +
	'inside `create_story` / `update_story`, with matching rows in `query_data`. ' +
	'Add a `LIMIT` clause to your SQL if you want to cap the number of rows returned.';

export function registerDataTools(server: McpServer, ctx: McpContext): void {
	registerAgentToolAsMcp(server, ctx, {
		name: 'execute_sql',
		agentTool: executeSqlTool,
		title: 'Execute SQL',
		description: EXECUTE_SQL_DESCRIPTION,
	});
}
