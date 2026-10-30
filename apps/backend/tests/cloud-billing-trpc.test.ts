import { TRPCError } from '@trpc/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod/v4';

const mocks = vi.hoisted(() => ({
	assertOrganizationCloudBillingAccess: vi.fn(),
	assertProjectCloudBillingAccess: vi.fn(),
	assertUserCloudBillingAccess: vi.fn(),
	getOrganizationCloudEntitlement: vi.fn(),
	getProjectById: vi.fn(),
	getProjectByUserId: vi.fn(),
	getUserOrgMembership: vi.fn(),
	getUserRoleInProject: vi.fn(),
	isCloudFreeTierEnabled: vi.fn(() => true),
	isUserReadOnlyInOrganization: vi.fn(),
	organizationHasProjects: vi.fn(),
}));

vi.mock('../src/env', async (importOriginal) => ({
	...(await importOriginal<typeof import('../src/env')>()),
	isCloudFreeTierEnabled: mocks.isCloudFreeTierEnabled,
}));
vi.mock('../src/services/cloud-billing-access.service', () => ({
	assertOrganizationCloudBillingAccess: mocks.assertOrganizationCloudBillingAccess,
	assertProjectCloudBillingAccess: mocks.assertProjectCloudBillingAccess,
	assertUserCloudBillingAccess: mocks.assertUserCloudBillingAccess,
	getOrganizationCloudEntitlement: mocks.getOrganizationCloudEntitlement,
	isUserReadOnlyInOrganization: mocks.isUserReadOnlyInOrganization,
}));
vi.mock('../src/queries/organization.queries', () => ({
	getUserOrgMembership: mocks.getUserOrgMembership,
}));
vi.mock('../src/queries/project.queries', () => ({
	getProjectById: mocks.getProjectById,
	getProjectByUserId: mocks.getProjectByUserId,
	getUserRoleInProject: mocks.getUserRoleInProject,
	organizationHasProjects: mocks.organizationHasProjects,
}));

import {
	cloudBillingMiddleware,
	cloudBillingProjectImportProcedure,
	organizationProtectedProcedure,
	projectProtectedProcedure,
	publicProcedure,
	resourceProjectProcedure,
	router,
} from '../src/trpc/trpc';

const scopeInput = z.object({
	organizationId: z.string().nullable().optional(),
	projectId: z.string().optional(),
	skip: z.boolean().optional(),
});

const testRouter = router({
	run: publicProcedure
		.input(scopeInput)
		.use(
			cloudBillingMiddleware<Record<string, never>, z.infer<typeof scopeInput>>((_ctx, input) =>
				input.skip ? null : { organizationId: input.organizationId, projectId: input.projectId },
			),
		)
		.query(() => 'ok'),
	importProject: cloudBillingProjectImportProcedure.query(() => 'ok'),
	projectRole: projectProtectedProcedure.query(({ ctx }) => ctx.userRole),
	resourceRole: resourceProjectProcedure('resourceId', async () => ({ projectId: 'project-1' }), 'Resource')
		.input(z.object({ resourceId: z.string() }))
		.query(({ ctx }) => ctx.userRole),
	organizationRole: organizationProtectedProcedure.query(({ ctx }) => ctx.orgRole),
});

describe('cloud billing tRPC middleware', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.getUserOrgMembership.mockResolvedValue({
			organization: { id: 'organization-1' },
			role: 'admin',
		});
		mocks.getOrganizationCloudEntitlement.mockResolvedValue({
			tier: 'free',
			hasAccess: true,
			overCapacity: true,
			seatLimit: 3,
		});
		mocks.getProjectByUserId.mockResolvedValue({ id: 'project-1', orgId: 'organization-1' });
		mocks.getProjectById.mockResolvedValue({ id: 'project-1', orgId: 'organization-1' });
		mocks.getUserRoleInProject.mockResolvedValue('user');
		mocks.isUserReadOnlyInOrganization.mockResolvedValue(false);
	});

	it('checks organization access once when an organization is resolved', async () => {
		await expect(caller().run({ organizationId: 'organization-1', projectId: 'project-1' })).resolves.toBe('ok');

		expect(mocks.assertOrganizationCloudBillingAccess).toHaveBeenCalledOnce();
		expect(mocks.assertOrganizationCloudBillingAccess).toHaveBeenCalledWith('organization-1');
		expect(mocks.assertProjectCloudBillingAccess).not.toHaveBeenCalled();
	});

	it('checks project access once when only a project is resolved', async () => {
		await expect(caller().run({ projectId: 'project-1' })).resolves.toBe('ok');

		expect(mocks.assertProjectCloudBillingAccess).toHaveBeenCalledOnce();
		expect(mocks.assertProjectCloudBillingAccess).toHaveBeenCalledWith('project-1');
		expect(mocks.assertOrganizationCloudBillingAccess).not.toHaveBeenCalled();
	});

	it('asserts the acting user when a cloud billing session exists', async () => {
		await expect(authenticatedCaller().run({ organizationId: 'organization-1' })).resolves.toBe('ok');

		expect(mocks.assertUserCloudBillingAccess).toHaveBeenCalledWith(
			'organization-1',
			'user-1',
			expect.objectContaining({ tier: 'free' }),
		);
	});

	it('fails closed when a required scope has no organization or project', async () => {
		await expect(caller().run({})).rejects.toEqual(
			new TRPCError({ code: 'NOT_FOUND', message: 'Cloud billing organization was not found' }),
		);

		expect(mocks.assertOrganizationCloudBillingAccess).not.toHaveBeenCalled();
		expect(mocks.assertProjectCloudBillingAccess).not.toHaveBeenCalled();
	});

	it('allows procedures that explicitly resolve no billing scope', async () => {
		await expect(caller().run({ skip: true })).resolves.toBe('ok');

		expect(mocks.assertOrganizationCloudBillingAccess).not.toHaveBeenCalled();
		expect(mocks.assertProjectCloudBillingAccess).not.toHaveBeenCalled();
	});

	it('allows the first project import to start organization billing', async () => {
		mocks.organizationHasProjects.mockResolvedValue(false);

		await expect(authenticatedCaller().importProject()).resolves.toBe('ok');
		expect(mocks.assertOrganizationCloudBillingAccess).not.toHaveBeenCalled();
	});

	it('requires organization billing access for later project imports', async () => {
		mocks.organizationHasProjects.mockResolvedValue(true);
		mocks.assertUserCloudBillingAccess.mockRejectedValue(new Error('Cloud billing seat access is restricted'));

		await expect(authenticatedCaller().importProject()).rejects.toThrow('Cloud billing seat access is restricted');
		expect(mocks.assertOrganizationCloudBillingAccess).toHaveBeenCalledWith(
			'organization-1',
			expect.objectContaining({ tier: 'free' }),
		);
		expect(mocks.assertUserCloudBillingAccess).toHaveBeenCalledWith(
			'organization-1',
			'user-1',
			expect.objectContaining({ tier: 'free' }),
		);
	});

	it.each(['admin', 'user'] as const)('downgrades a stored %s to an effective viewer', async (storedRole) => {
		mocks.getUserRoleInProject.mockResolvedValue(storedRole);
		mocks.isUserReadOnlyInOrganization.mockResolvedValue(true);

		await expect(authenticatedCaller().projectRole()).resolves.toBe('viewer');
		await expect(authenticatedCaller().resourceRole({ resourceId: 'resource-1' })).resolves.toBe('viewer');
		expect(mocks.getUserRoleInProject).toHaveBeenCalledWith('project-1', 'user-1');
	});

	it('keeps a stored viewer as a viewer', async () => {
		mocks.getUserRoleInProject.mockResolvedValue('viewer');

		await expect(authenticatedCaller().projectRole()).resolves.toBe('viewer');
		expect(mocks.isUserReadOnlyInOrganization).toHaveBeenCalled();
	});

	it('keeps organization billing and member management reachable', async () => {
		mocks.getUserOrgMembership.mockResolvedValue({
			organization: { id: 'organization-1' },
			role: 'admin',
		});
		mocks.isUserReadOnlyInOrganization.mockResolvedValue(true);

		await expect(authenticatedCaller().organizationRole()).resolves.toBe('admin');
		expect(mocks.isUserReadOnlyInOrganization).not.toHaveBeenCalled();
	});
});

function caller() {
	return testRouter.createCaller({
		session: null,
		selectedProjectId: null,
		selectedOrganizationId: null,
	} as never);
}

function authenticatedCaller() {
	return testRouter.createCaller({
		session: { user: { id: 'user-1' } },
		selectedProjectId: null,
		selectedOrganizationId: 'organization-1',
	} as never);
}
