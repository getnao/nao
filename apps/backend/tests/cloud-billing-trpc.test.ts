import { TRPCError } from '@trpc/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod/v4';

const mocks = vi.hoisted(() => ({
	assertOrganizationCloudBillingAccess: vi.fn(),
	assertProjectCloudBillingAccess: vi.fn(),
	getOrganizationBilling: vi.fn(),
	getUserOrgMembership: vi.fn(),
	organizationHasProjects: vi.fn(),
}));

vi.mock('../src/services/cloud-billing-access.service', () => ({
	assertOrganizationCloudBillingAccess: mocks.assertOrganizationCloudBillingAccess,
	assertProjectCloudBillingAccess: mocks.assertProjectCloudBillingAccess,
}));
vi.mock('../src/queries/billing.queries', () => ({
	getOrganizationBilling: mocks.getOrganizationBilling,
}));
vi.mock('../src/queries/organization.queries', () => ({
	getUserOrgMembership: mocks.getUserOrgMembership,
}));
vi.mock('../src/queries/project.queries', () => ({
	organizationHasProjects: mocks.organizationHasProjects,
}));

import { cloudBillingMiddleware, cloudBillingProjectImportProcedure, publicProcedure, router } from '../src/trpc/trpc';

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
});

describe('cloud billing tRPC middleware', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.getUserOrgMembership.mockResolvedValue({
			organization: { id: 'organization-1' },
			role: 'admin',
		});
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

	it('allows an unfinished project to be replaced before the trial starts', async () => {
		mocks.organizationHasProjects.mockResolvedValue(true);
		mocks.getOrganizationBilling.mockResolvedValue(null);

		await expect(authenticatedCaller().importProject()).resolves.toBe('ok');
		expect(mocks.assertOrganizationCloudBillingAccess).not.toHaveBeenCalled();
	});

	it('requires organization billing access for later project imports', async () => {
		mocks.organizationHasProjects.mockResolvedValue(true);
		mocks.getOrganizationBilling.mockResolvedValue({
			billingStatus: 'canceled',
			trialStartedAt: new Date(),
			trialEndsAt: new Date(),
			stripeSubscriptionId: null,
		});
		mocks.assertOrganizationCloudBillingAccess.mockRejectedValue(new Error('Cloud billing access is restricted'));

		await expect(authenticatedCaller().importProject()).rejects.toThrow('Cloud billing access is restricted');
		expect(mocks.assertOrganizationCloudBillingAccess).toHaveBeenCalledWith('organization-1');
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
