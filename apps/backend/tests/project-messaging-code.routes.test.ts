import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	listProjectMembersWithRoles: vi.fn(),
	regenerateMessagingProviderCode: vi.fn(),
	isUserConfinedToOrganization: vi.fn(),
}));

vi.mock('../src/queries/project.queries', () => ({
	getProjectByUserId: vi.fn(async () => ({ id: 'project-id', orgId: 'org-id', name: 'Project', path: null })),
	getUserRoleInProject: vi.fn(async () => 'admin'),
	listProjectMembersWithRoles: mocks.listProjectMembersWithRoles,
}));
vi.mock('../src/queries/user.queries', () => ({
	regenerateMessagingProviderCode: mocks.regenerateMessagingProviderCode,
	isUserConfinedToOrganization: mocks.isUserConfinedToOrganization,
}));
vi.mock('../src/queries/chat.queries', () => ({}));
vi.mock('../src/queries/project-llm-config.queries', () => ({}));
vi.mock('../src/queries/project-saved-prompt.queries', () => ({}));
vi.mock('../src/queries/project-slack-config.queries', () => ({}));
vi.mock('../src/queries/project-teams-config.queries', () => ({}));
vi.mock('../src/queries/project-telegram-config.queries', () => ({}));
vi.mock('../src/queries/project-whatsapp-config.queries', () => ({}));
vi.mock('../src/queries/project-whatsapp-link.queries', () => ({}));
vi.mock('../src/agents/user-rules', () => ({ getDatabaseObjects: vi.fn() }));
vi.mock('../src/auth', () => ({ getAuth: vi.fn() }));
vi.mock('../src/services/posthog', () => ({ posthog: {}, PostHogEvent: {} }));
vi.mock('../src/services/slack', () => ({ slackService: {} }));
vi.mock('../src/services/transcribe.service', () => ({ listAvailableTranscribeModels: vi.fn() }));
vi.mock('../src/utils/logger', () => ({
	logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

import { projectRoutes } from '../src/trpc/project.routes';
import { router } from '../src/trpc/trpc';

const testRouter = router(projectRoutes);
const CALLER_ID = 'admin-id';

describe('project.regenerateMessagingProviderCode', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.listProjectMembersWithRoles.mockResolvedValue([{ id: CALLER_ID }, { id: 'member-id' }]);
		mocks.regenerateMessagingProviderCode.mockResolvedValue('new-code');
	});

	it('refuses to reset the code of a member who also belongs to another organization', async () => {
		mocks.isUserConfinedToOrganization.mockResolvedValue(false);

		await expect(createCaller().regenerateMessagingProviderCode({ userId: 'member-id' })).rejects.toMatchObject({
			code: 'FORBIDDEN',
		});
		expect(mocks.isUserConfinedToOrganization).toHaveBeenCalledWith('member-id', 'org-id');
		expect(mocks.regenerateMessagingProviderCode).not.toHaveBeenCalled();
	});

	it('resets the code of a member who only belongs to this organization', async () => {
		mocks.isUserConfinedToOrganization.mockResolvedValue(true);

		await expect(createCaller().regenerateMessagingProviderCode({ userId: 'member-id' })).resolves.toBe('new-code');
		expect(mocks.regenerateMessagingProviderCode).toHaveBeenCalledWith('member-id');
	});

	it('lets an admin reset their own code whatever else they belong to', async () => {
		mocks.isUserConfinedToOrganization.mockResolvedValue(false);

		await expect(createCaller().regenerateMessagingProviderCode({ userId: CALLER_ID })).resolves.toBe('new-code');
		expect(mocks.regenerateMessagingProviderCode).toHaveBeenCalledWith(CALLER_ID);
	});
});

function createCaller() {
	return testRouter.createCaller({
		session: { user: { id: CALLER_ID, name: 'Admin', email: 'admin@example.com' } },
		selectedProjectId: 'project-id',
	} as never);
}
