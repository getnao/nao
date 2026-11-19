import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	registerContextLayerTools: vi.fn(),
	resolveSemanticLayerMode: vi.fn(),
	resolveAvailableUserGroupAccess: vi.fn(),
}));

vi.mock('../../src/db/db', () => ({ db: {} }));
vi.mock('../../src/queries/project.queries', () => ({
	getCustomBoundaries: vi.fn(async () => []),
	getProjectById: vi.fn(async () => ({
		path: '/project',
		agentSettings: { semanticLayer: { mode: 'disabled' } },
	})),
}));
vi.mock('../../src/services/semantic-layer.service', () => ({
	resolveSemanticLayerMode: mocks.resolveSemanticLayerMode,
}));
vi.mock('../../src/services/story-mount', () => ({ isCustomStoriesEnabled: () => true }));
vi.mock('../../src/services/user-group-availability.service', () => ({
	resolveAvailableUserGroupAccess: mocks.resolveAvailableUserGroupAccess,
}));
vi.mock('../../src/mcp/embed/ui-resources', () => ({ registerNaoMcpApps: vi.fn() }));
vi.mock('../../src/mcp/tools/asset-tools', () => ({ registerAssetTools: vi.fn() }));
vi.mock('../../src/mcp/tools/context-admin-tools', () => ({ registerContextAdminTools: vi.fn() }));
vi.mock('../../src/mcp/tools/context-layer', () => ({
	registerContextLayerTools: mocks.registerContextLayerTools,
}));
vi.mock('../../src/mcp/tools/member-budget', () => ({ registerMemberBudgetTools: vi.fn(async () => undefined) }));
vi.mock('../../src/mcp/tools/sub-agent', () => ({ registerSubAgentTools: vi.fn(async () => undefined) }));

import { createMcpServer } from '../../src/mcp/server';

describe('MCP server semantic layer mode', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.resolveAvailableUserGroupAccess.mockResolvedValue({
			features: [],
			semanticLayerModeOverride: 'exclusive',
		});
		mocks.resolveSemanticLayerMode.mockReturnValue('exclusive');
	});

	it("registers context-layer tools with the user's effective group override", async () => {
		const server = await createMcpServer('user-1', 'project-1', 'user', {
			enabled: true,
			subAgentModeEnabled: false,
			contextLayerModeEnabled: true,
		});

		expect(mocks.resolveAvailableUserGroupAccess).toHaveBeenCalledWith('project-1', 'user-1');
		expect(mocks.resolveSemanticLayerMode).toHaveBeenCalledWith(
			'/project',
			{ semanticLayer: { mode: 'disabled' } },
			'exclusive',
		);
		expect(mocks.registerContextLayerTools).toHaveBeenCalledWith(
			server,
			expect.objectContaining({ userId: 'user-1', projectId: 'project-1' }),
			[],
			'exclusive',
		);
	});
});
