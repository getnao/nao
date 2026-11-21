import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { Options } from '@anthropic-ai/claude-agent-sdk';

import type { ClaudeExecutable } from './claude-executable';

/**
 * The web page that drives a turn comes from a server, so Claude is locked down to nao: no built-in
 * tool (shell, files, web), none of the user's settings, hooks, memory or MCP servers, and an empty
 * working directory.
 */
export function lockedDownOptions(claude: ClaudeExecutable): Options {
	return {
		cwd: workspaceDirectory(),
		pathToClaudeCodeExecutable: claude.path,
		tools: [],
		settingSources: [],
		strictMcpConfig: true,
		mcpServers: {},
		persistSession: false,
		permissionMode: 'dontAsk',
		env: {
			...claude.env,
			ENABLE_CLAUDEAI_MCP_SERVERS: 'false',
			ENABLE_TOOL_SEARCH: 'false',
			MCP_CONNECTION_NONBLOCKING: '0',
			CLAUDE_AGENT_SDK_CLIENT_APP: 'nao-desktop',
		},
	};
}

function workspaceDirectory(): string {
	const directory = process.env.NAO_AGENT_WORKSPACE || join(tmpdir(), 'nao-desktop-agent');
	mkdirSync(directory, { recursive: true });
	return directory;
}
