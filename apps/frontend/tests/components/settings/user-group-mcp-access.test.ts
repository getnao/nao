import { describe, expect, it, vi } from 'vitest';

import type { McpAccess } from '@nao/shared';
import {
	getUnconfiguredMcpGrantServers,
	toggleMcpServerGrant,
	toggleMcpToolGrant,
} from '@/components/settings/user-group-mcp-access';

vi.mock('@/main', () => ({ trpc: {} }));

const githubTools = ['create_issue', 'list_issues', 'search'];

describe('user group MCP access toggles', () => {
	it('replaces tool grants with a whole-server grant and removes everything on uncheck', () => {
		const access: McpAccess = {
			mode: 'restricted',
			grants: [{ kind: 'tool', server: 'github', tool: 'search' }],
		};
		const granted = toggleMcpServerGrant(access, 'github', true);
		expect(granted).toEqual({ mode: 'restricted', grants: [{ kind: 'server', server: 'github' }] });
		expect(toggleMcpServerGrant(granted, 'github', false)).toEqual({ mode: 'restricted', grants: [] });
	});

	it('narrows a whole-server grant to the other known tools when one tool is unchecked', () => {
		const access: McpAccess = { mode: 'restricted', grants: [{ kind: 'server', server: 'github' }] };
		expect(toggleMcpToolGrant(access, 'github', 'create_issue', false, githubTools)).toEqual({
			mode: 'restricted',
			grants: [
				{ kind: 'tool', server: 'github', tool: 'list_issues' },
				{ kind: 'tool', server: 'github', tool: 'search' },
			],
		});
	});

	it('adds and removes single tool grants without touching other servers', () => {
		const access: McpAccess = { mode: 'restricted', grants: [{ kind: 'server', server: 'linear' }] };
		const granted = toggleMcpToolGrant(access, 'github', 'search', true, githubTools);
		expect(granted).toEqual({
			mode: 'restricted',
			grants: [
				{ kind: 'tool', server: 'github', tool: 'search' },
				{ kind: 'server', server: 'linear' },
			],
		});
		expect(toggleMcpToolGrant(granted, 'github', 'search', false, githubTools)).toEqual(access);
	});

	it('leaves all access untouched and lists grants for servers missing from mcp.json', () => {
		expect(toggleMcpServerGrant({ mode: 'all' }, 'github', false)).toEqual({ mode: 'all' });
		expect(
			getUnconfiguredMcpGrantServers(
				{
					mode: 'restricted',
					grants: [
						{ kind: 'server', server: 'github' },
						{ kind: 'tool', server: 'removed', tool: 'search' },
					],
				},
				[{ name: 'github' }],
			),
		).toEqual(['removed']);
	});
});
