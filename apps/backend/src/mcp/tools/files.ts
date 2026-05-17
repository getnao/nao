import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import grepTool from '../../agents/tools/grep';
import listTool from '../../agents/tools/list';
import { CONTEXT_LAYER_GUIDANCE } from '../context-layer-guidance';
import type { McpContext } from '../logging';
import { registerAgentToolAsMcp } from './wrap-agent-tool';

const LS_DESCRIPTION =
	'List files and directories in the nao project context (E.g. `RULES.md`, `databases/`, `docs/`, `semantics/`). ' +
	'Use this to discover schema and business context before writing SQL.';

const GREP_DESCRIPTION =
	`${CONTEXT_LAYER_GUIDANCE}\n\n` +
	'Search file contents with a regex pattern. Start with `RULES.md` and `databases/` to learn table names, columns, and business rules.';

export function registerFileTools(server: McpServer, ctx: McpContext): void {
	registerAgentToolAsMcp(server, ctx, {
		name: 'grep',
		agentTool: grepTool,
		title: 'Search Files',
		description: GREP_DESCRIPTION,
	});

	registerAgentToolAsMcp(server, ctx, {
		name: 'ls',
		agentTool: listTool,
		title: 'List Files',
		description: LS_DESCRIPTION,
	});
}
