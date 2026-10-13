import { TRPCError } from '@trpc/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod/v4';

const mocks = vi.hoisted(() => ({
	assertOrganizationCloudBillingAccess: vi.fn(),
	assertProjectCloudBillingAccess: vi.fn(),
}));

vi.mock('../src/services/cloud-billing-access.service', () => ({
	assertOrganizationCloudBillingAccess: mocks.assertOrganizationCloudBillingAccess,
	assertProjectCloudBillingAccess: mocks.assertProjectCloudBillingAccess,
}));

import { cloudBillingMiddleware, publicProcedure, router } from '../src/trpc/trpc';

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
});

describe('cloud billing tRPC middleware', () => {
	beforeEach(() => {
		vi.clearAllMocks();
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
});

function caller() {
	return testRouter.createCaller({
		session: null,
		selectedProjectId: null,
		selectedOrganizationId: null,
	} as never);
}
