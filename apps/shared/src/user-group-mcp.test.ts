import { describe, expect, it } from 'vitest';

import {
	ALL_MCP_ACCESS,
	EMPTY_MCP_ACCESS,
	isMcpServerFullyGranted,
	isMcpServerGranted,
	isMcpToolGranted,
	type McpAccess,
	normalizeMcpAccess,
	parseMcpAccess,
	unionMcpAccess,
} from './user-group-mcp';

describe('user group MCP access', () => {
	it('trims, deduplicates, sorts, and drops tool grants covered by a server grant', () => {
		expect(
			normalizeMcpAccess({
				mode: 'restricted',
				grants: [
					{ kind: 'tool', server: 'linear', tool: ' search ' },
					{ kind: 'tool', server: 'github', tool: 'list_issues' },
					{ kind: 'server', server: ' github ' },
					{ kind: 'tool', server: 'linear', tool: 'search' },
				],
			}),
		).toEqual({
			mode: 'restricted',
			grants: [
				{ kind: 'server', server: 'github' },
				{ kind: 'tool', server: 'linear', tool: 'search' },
			],
		});
	});

	it('parses stored grants and fails closed on anything malformed', () => {
		expect(parseMcpAccess({ mode: 'all' })).toEqual(ALL_MCP_ACCESS);
		expect(parseMcpAccess({ mode: 'all', grants: [] })).toEqual(EMPTY_MCP_ACCESS);
		expect(parseMcpAccess(undefined)).toEqual(EMPTY_MCP_ACCESS);
		expect(parseMcpAccess({ mode: 'restricted', grants: [{ kind: 'server', server: '  ' }] })).toEqual(
			EMPTY_MCP_ACCESS,
		);
		expect(
			parseMcpAccess({ mode: 'restricted', grants: [{ kind: 'server', server: 'github', tool: 'extra' }] }),
		).toEqual(EMPTY_MCP_ACCESS);
		expect(parseMcpAccess({ mode: 'restricted', grants: [{ kind: 'tool', server: 'github' }] })).toEqual(
			EMPTY_MCP_ACCESS,
		);
		expect(parseMcpAccess({ mode: 'restricted', grants: [{ kind: 'server', server: 'github' }] })).toEqual({
			mode: 'restricted',
			grants: [{ kind: 'server', server: 'github' }],
		});
	});

	it('unions grants with all dominance', () => {
		expect(
			unionMcpAccess([
				{ mode: 'restricted', grants: [{ kind: 'tool', server: 'github', tool: 'list_issues' }] },
				{ mode: 'restricted', grants: [{ kind: 'server', server: 'linear' }] },
			]),
		).toEqual({
			mode: 'restricted',
			grants: [
				{ kind: 'tool', server: 'github', tool: 'list_issues' },
				{ kind: 'server', server: 'linear' },
			],
		});
		expect(unionMcpAccess([EMPTY_MCP_ACCESS, ALL_MCP_ACCESS])).toEqual(ALL_MCP_ACCESS);
		expect(unionMcpAccess([])).toEqual(EMPTY_MCP_ACCESS);
	});

	it('grants a server through any of its tools but only the granted tools', () => {
		const access: McpAccess = {
			mode: 'restricted',
			grants: [
				{ kind: 'server', server: 'linear' },
				{ kind: 'tool', server: 'github', tool: 'list_issues' },
			],
		};
		expect(isMcpServerGranted(access, 'github')).toBe(true);
		expect(isMcpServerFullyGranted(access, 'github')).toBe(false);
		expect(isMcpToolGranted(access, 'github', 'list_issues')).toBe(true);
		expect(isMcpToolGranted(access, 'github', 'create_issue')).toBe(false);
		expect(isMcpToolGranted(access, 'linear', 'anything')).toBe(true);
		expect(isMcpServerGranted(access, 'notion')).toBe(false);
		expect(isMcpToolGranted(ALL_MCP_ACCESS, 'notion', 'search')).toBe(true);
	});
});
