import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ isMemberBudgetLicensed: vi.fn() }));

vi.mock('../src/db/db', () => ({ db: {} }));
vi.mock('../src/utils/member-budget', () => ({ isMemberBudgetLicensed: mocks.isMemberBudgetLicensed }));
vi.mock('../src/services/user-group-feature-access.service', () => ({
	hasUserGroupFeature: vi.fn().mockResolvedValue(true),
}));
vi.mock('../src/mcp/embed/ui-resources', async (importOriginal) => ({
	...(await importOriginal<typeof import('../src/mcp/embed/ui-resources')>()),
	registerNaoMcpApps: vi.fn(),
}));

import { createMcpServer } from '../src/mcp/server';

const SETTINGS_WITH_MODES_OFF = { enabled: true, subAgentModeEnabled: false, contextLayerModeEnabled: false } as never;

describe('MCP member budget tools', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.isMemberBudgetLicensed.mockResolvedValue(true);
	});

	it('exposes export_member_budgets to admins with the enterprise license', async () => {
		expect(await listToolNames('admin')).toContain('export_member_budgets');
	});

	it('hides export_member_budgets from non-admin users', async () => {
		expect(await listToolNames('user')).not.toContain('export_member_budgets');
		expect(mocks.isMemberBudgetLicensed).not.toHaveBeenCalled();
	});

	it('hides export_member_budgets without the enterprise license', async () => {
		mocks.isMemberBudgetLicensed.mockResolvedValue(false);

		expect(await listToolNames('admin')).not.toContain('export_member_budgets');
	});
});

async function listToolNames(role: 'admin' | 'user'): Promise<string[]> {
	const server = await createMcpServer('user-id', 'project-id', role, SETTINGS_WITH_MODES_OFF);
	return Object.keys((server as unknown as { _registeredTools: Record<string, unknown> })._registeredTools);
}
