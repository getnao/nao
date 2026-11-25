import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { NAO_INTERNAL_MCP_SERVER } from '@nao/shared';
import type { list } from '@nao/shared/tools';
import { minimatch } from 'minimatch';
import path from 'path';

import { personalSkillMcpTools } from '../mcp/tools/personal-skills';
import { registerInternalMcpTool, type RegisterMcpToolOptions } from '../mcp/tools/register-mcp-tool';
import { setStoryLiveMcpTool } from '../mcp/tools/story-live-settings';
import type { ToolContext } from '../types/tools';
import { buildMcpOpenApiDocument, type McpToolDefinition } from './mcp-openapi';

/**
 * nao's own MCP server: tools acting on nao itself, such as the user's personal skills or their stories' live settings. The agent finds them like the
 * tools of the project's servers, as specs under `/agent/mcps/nao__internal/` called through `mcp_call`, so they cost
 * nothing until it needs one. The specs depend on who asks, so they are served from memory, never written to disk.
 */

/** What the system prompt says the server is for, next to its name. */
export const NAO_INTERNAL_MCP_DESCRIPTION =
	'nao itself: the user’s own personal skills, to list them or create one when the user asks to save how a request should be answered; ' +
	'and the live settings of the user’s stories, to keep one up to date on a schedule.';

const MCPS_FOLDER = '/agent/mcps';
const SPECS_FOLDER = `${MCPS_FOLDER}/${NAO_INTERNAL_MCP_SERVER}`;

type InternalMcpContext = Pick<ToolContext, 'projectId' | 'userId' | 'canManagePersonalSkills' | 'userGroupFeatures'>;

export interface NaoInternalMcpSpecFile {
	virtualPath: string;
	content: string;
}

export function hasNaoInternalMcpTools(context: InternalMcpContext): boolean {
	return internalMcpTools(context).length > 0;
}

/** True for `/agent/mcps/nao__internal` and anything below it. */
export function isNaoInternalMcpPath(virtualPath: string | undefined | null): boolean {
	if (typeof virtualPath !== 'string') {
		return false;
	}
	const normalized = normalizeVirtualPath(virtualPath);
	return normalized === SPECS_FOLDER || normalized.startsWith(`${SPECS_FOLDER}/`);
}

/** The folder holding the specs of every MCP server, where nao's own server shows up next to the project's. */
export function isMcpSpecsFolder(virtualPath: string): boolean {
	return normalizeVirtualPath(virtualPath) === MCPS_FOLDER;
}

export function naoInternalMcpFolderEntry(): list.Entry {
	return { path: SPECS_FOLDER, name: NAO_INTERNAL_MCP_SERVER, type: 'directory' };
}

export async function listNaoInternalMcpFolder(
	context: InternalMcpContext,
	virtualPath: string,
): Promise<list.Entry[]> {
	if (normalizeVirtualPath(virtualPath) !== SPECS_FOLDER) {
		throw new Error(`Directory not found: ${virtualPath}`);
	}
	const files = await listNaoInternalMcpSpecFiles(context);
	return files.map((file) => ({
		path: file.virtualPath,
		name: path.posix.basename(file.virtualPath),
		type: 'file',
		size: Buffer.byteLength(file.content).toString(),
	}));
}

export async function readNaoInternalMcpFile(context: InternalMcpContext, virtualPath: string): Promise<string> {
	const requested = normalizeVirtualPath(virtualPath);
	const file = (await listNaoInternalMcpSpecFiles(context)).find((spec) => spec.virtualPath === requested);
	if (!file) {
		throw new Error(`File not found: ${virtualPath}`);
	}
	return file.content;
}

/** The specs a search under this path covers: all of them from the MCP folder, or the folder and file asked for. */
export async function listNaoInternalMcpSpecFilesUnder(
	context: InternalMcpContext,
	virtualPath: string,
	glob?: string,
): Promise<NaoInternalMcpSpecFile[]> {
	const root = normalizeVirtualPath(virtualPath);
	const files = await listNaoInternalMcpSpecFiles(context);
	return files.filter(
		(file) =>
			(file.virtualPath === root || file.virtualPath.startsWith(`${root}/`)) &&
			(!glob || minimatch(file.virtualPath, glob, { matchBase: true, dot: true })),
	);
}

/** One OpenAPI spec per tool, like the specs written for the project's servers. */
export async function listNaoInternalMcpSpecFiles(context: InternalMcpContext): Promise<NaoInternalMcpSpecFile[]> {
	const tools = await listNaoInternalMcpTools(context);
	return tools.map((tool) => ({
		virtualPath: `${SPECS_FOLDER}/${tool.name}.json`,
		content: JSON.stringify(
			buildMcpOpenApiDocument({ serverName: NAO_INTERNAL_MCP_SERVER, transport: 'in-process', tools: [tool] }),
			null,
			2,
		),
	}));
}

export async function listNaoInternalMcpTools(context: InternalMcpContext): Promise<McpToolDefinition[]> {
	if (!hasNaoInternalMcpTools(context)) {
		return [];
	}
	const { tools } = await withNaoInternalMcpClient(context, (client) => client.listTools());
	return tools;
}

export async function callNaoInternalMcpTool(
	context: InternalMcpContext,
	tool: string,
	args: Record<string, unknown>,
): Promise<unknown> {
	if (!hasNaoInternalMcpTools(context)) {
		throw new Error(`MCP server "${NAO_INTERNAL_MCP_SERVER}" has no tool for this user.`);
	}
	return withNaoInternalMcpClient(context, (client) => client.callTool({ name: tool, arguments: args }));
}

/** The server is built for the user on each use: it holds no state, and its tools depend on who asks. */
async function withNaoInternalMcpClient<T>(
	context: InternalMcpContext,
	use: (client: Client) => Promise<T>,
): Promise<T> {
	const server = createNaoInternalMcpServer(context);
	const client = new Client({ name: 'nao-agent', version: '1.0.0' });
	const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
	await server.connect(serverTransport);
	await client.connect(clientTransport);
	try {
		return await use(client);
	} finally {
		await client.close();
		await server.close();
	}
}

function createNaoInternalMcpServer(context: InternalMcpContext): McpServer {
	const server = new McpServer({ name: NAO_INTERNAL_MCP_SERVER, version: '1.0.0' });
	for (const tool of internalMcpTools(context)) {
		registerInternalMcpTool(server, context, tool);
	}
	return server;
}

/** Each tool follows the app: personal skills for users who may write them, live settings for story creators. */
function internalMcpTools(context: InternalMcpContext): RegisterMcpToolOptions[] {
	return [
		...(context.canManagePersonalSkills === true ? personalSkillMcpTools(context) : []),
		...(context.userGroupFeatures.includes('storyCreation') ? [setStoryLiveMcpTool(context)] : []),
	];
}

function normalizeVirtualPath(virtualPath: string): string {
	const normalized = path.posix.normalize(`/${virtualPath}`).replace(/\/+$/, '');
	return normalized || '/';
}
