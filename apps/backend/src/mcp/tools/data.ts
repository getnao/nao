import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import executeSqlTool from '../../agents/tools/execute-sql';
import type { McpContext } from '../logging';
import { registerAgentToolAsMcp } from './wrap-agent-tool';

const EXECUTE_SQL_DESCRIPTION =
	'Run a SQL query against the connected data warehouse. Returns rows as JSON, including an `id` ' +
	'(e.g. "query_a1b2c3d4"). To embed the result in a story, pass that `id` as the `query_id` attribute ' +
	'of a `<chart query_id="..." />` or `<table query_id="..." />` block inside `create_story` / `update_story`. ' +
	'Add a `LIMIT` clause to your SQL if you want to cap the number of rows returned. ' +
	'Use `ask_nao` instead if you want Nao to write the SQL for you.';

export function registerDataTools(server: McpServer, ctx: McpContext): void {
	registerAgentToolAsMcp(server, ctx, {
		name: 'execute_sql',
		agentTool: executeSqlTool,
		title: 'Execute SQL',
		description: EXECUTE_SQL_DESCRIPTION,
	});
}
