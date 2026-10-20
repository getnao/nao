export type McpAccessGrant = McpServerGrant | McpToolGrant;

export interface McpServerGrant {
	kind: 'server';
	server: string;
}

export interface McpToolGrant {
	kind: 'tool';
	server: string;
	tool: string;
}

export type McpAccess = { mode: 'all' } | { mode: 'restricted'; grants: McpAccessGrant[] };

export const ALL_MCP_ACCESS: McpAccess = { mode: 'all' };
export const EMPTY_MCP_ACCESS: McpAccess = { mode: 'restricted', grants: [] };

const MAX_MCP_NAME_LENGTH = 255;
const MAX_MCP_GRANTS = 10_000;

export function normalizeMcpAccess(access: McpAccess): McpAccess {
	if (access.mode === 'all') {
		return ALL_MCP_ACCESS;
	}
	const grants = access.grants.map(normalizeMcpAccessGrant).filter((grant): grant is McpAccessGrant => !!grant);
	const grantedServers = new Set(grants.filter((grant) => grant.kind === 'server').map((grant) => grant.server));
	const uniqueGrants = new Map(
		grants
			.filter((grant) => grant.kind === 'server' || !grantedServers.has(grant.server))
			.map((grant) => [mcpAccessGrantKey(grant), grant]),
	);
	return { mode: 'restricted', grants: [...uniqueGrants.values()].sort(compareMcpAccessGrants) };
}

export function parseMcpAccess(value: unknown): McpAccess {
	if (!isRecord(value)) {
		return EMPTY_MCP_ACCESS;
	}
	if (value.mode === 'all') {
		return hasOnlyKeys(value, ['mode']) ? ALL_MCP_ACCESS : EMPTY_MCP_ACCESS;
	}
	if (
		value.mode !== 'restricted' ||
		!hasOnlyKeys(value, ['mode', 'grants']) ||
		!Array.isArray(value.grants) ||
		value.grants.length > MAX_MCP_GRANTS
	) {
		return EMPTY_MCP_ACCESS;
	}
	const grants = value.grants.map(normalizeMcpAccessGrant);
	if (grants.some((grant) => grant === null)) {
		return EMPTY_MCP_ACCESS;
	}
	return normalizeMcpAccess({ mode: 'restricted', grants: grants as McpAccessGrant[] });
}

export function unionMcpAccess(accesses: readonly McpAccess[]): McpAccess {
	if (accesses.some((access) => access.mode === 'all')) {
		return ALL_MCP_ACCESS;
	}
	return normalizeMcpAccess({
		mode: 'restricted',
		grants: accesses.flatMap((access) => (access.mode === 'restricted' ? access.grants : [])),
	});
}

/** A server is reachable as soon as the group grants it entirely or grants one of its tools. */
export function isMcpServerGranted(access: McpAccess, server: string): boolean {
	return access.mode === 'all' || access.grants.some((grant) => grant.server === server);
}

export function isMcpServerFullyGranted(access: McpAccess, server: string): boolean {
	return access.mode === 'all' || access.grants.some((grant) => grant.kind === 'server' && grant.server === server);
}

export function isMcpToolGranted(access: McpAccess, server: string, tool: string): boolean {
	return (
		isMcpServerFullyGranted(access, server) ||
		(access.mode === 'restricted' &&
			access.grants.some((grant) => grant.kind === 'tool' && grant.server === server && grant.tool === tool))
	);
}

export function normalizeMcpAccessGrant(value: unknown): McpAccessGrant | null {
	if (!isRecord(value) || typeof value.server !== 'string') {
		return null;
	}
	const server = normalizeMcpName(value.server);
	if (server === null) {
		return null;
	}
	if (value.kind === 'server' && hasOnlyKeys(value, ['kind', 'server'])) {
		return { kind: 'server', server };
	}
	if (value.kind !== 'tool' || !hasOnlyKeys(value, ['kind', 'server', 'tool']) || typeof value.tool !== 'string') {
		return null;
	}
	const tool = normalizeMcpName(value.tool);
	return tool === null ? null : { kind: 'tool', server, tool };
}

function normalizeMcpName(value: string): string | null {
	const normalized = value.trim();
	return normalized && normalized.length <= MAX_MCP_NAME_LENGTH ? normalized : null;
}

function mcpAccessGrantKey(grant: McpAccessGrant): string {
	return JSON.stringify([grant.kind, grant.server, grant.kind === 'tool' ? grant.tool : '']);
}

function compareMcpAccessGrants(left: McpAccessGrant, right: McpAccessGrant): number {
	return (
		left.server.localeCompare(right.server) ||
		left.kind.localeCompare(right.kind) ||
		(left.kind === 'tool' ? left.tool : '').localeCompare(right.kind === 'tool' ? right.tool : '')
	);
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
	const allowedKeys = new Set(keys);
	return Object.keys(value).every((key) => allowedKeys.has(key));
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}
