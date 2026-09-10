import { DEFAULT_TOOL_CALL_DENSITY_POLICY, TOOL_CALL_DENSITIES, USER_GROUP_FEATURES } from '@nao/shared';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import * as userGroupQueries from '../queries/user-group.queries';
import { hasFeature, LICENSE_FEATURES } from '../services/license.service';
import { getEffectiveUserGroupAccess } from '../services/user-group-feature-access.service';
import { adminProtectedProcedure, projectProtectedProcedure } from './trpc';

const groupNameSchema = z.string().trim().min(1, 'Group name is required.').max(80, 'Group name is too long.');
const featureGrantsSchema = z.array(z.enum(USER_GROUP_FEATURES)).max(USER_GROUP_FEATURES.length);
const toolCallDensityPolicySchema = z.object({
	defaultDensity: z.enum(TOOL_CALL_DENSITIES),
	canChange: z.boolean(),
});

export const userGroupRoutes = {
	effectiveAccess: projectProtectedProcedure.query(async ({ ctx }) => {
		return getEffectiveUserGroupAccess(ctx.project.id, ctx.user.id);
	}),

	overview: adminProtectedProcedure.query(async ({ ctx }) => {
		await assertUserGroupsLicensed();
		return handleQuery(() => userGroupQueries.getUserGroupOverview(ctx.project.id));
	}),

	create: adminProtectedProcedure
		.input(
			z.object({
				name: groupNameSchema,
				featureGrants: featureGrantsSchema.default([]),
				toolCallDensityPolicy: toolCallDensityPolicySchema.default(DEFAULT_TOOL_CALL_DENSITY_POLICY),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			await assertUserGroupsLicensed();
			return handleQuery(() =>
				userGroupQueries.createUserGroup(
					ctx.project.id,
					input.name,
					unique(input.featureGrants),
					input.toolCallDensityPolicy,
				),
			);
		}),

	update: adminProtectedProcedure
		.input(
			z.object({
				groupId: z.string().min(1),
				name: groupNameSchema.optional(),
				featureGrants: featureGrantsSchema,
				toolCallDensityPolicy: toolCallDensityPolicySchema,
			}),
		)
		.mutation(async ({ ctx, input }) => {
			await assertUserGroupsLicensed();
			return handleQuery(() =>
				userGroupQueries.updateUserGroup(ctx.project.id, input.groupId, {
					name: input.name,
					featureGrants: unique(input.featureGrants),
					toolCallDensityPolicy: input.toolCallDensityPolicy,
				}),
			);
		}),

	delete: adminProtectedProcedure.input(z.object({ groupId: z.string().min(1) })).mutation(async ({ ctx, input }) => {
		await assertUserGroupsLicensed();
		return handleQuery(() => userGroupQueries.deleteUserGroup(ctx.project.id, input.groupId));
	}),

	setMembership: adminProtectedProcedure
		.input(
			z.object({
				groupId: z.string().min(1),
				userId: z.string().min(1),
				isMember: z.boolean(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			await assertUserGroupsLicensed();
			return handleQuery(() =>
				userGroupQueries.setUserGroupMembership(ctx.project.id, input.groupId, input.userId, input.isMember),
			);
		}),
};

async function assertUserGroupsLicensed(): Promise<void> {
	if (!(await hasFeature(LICENSE_FEATURES.userGroups))) {
		throw new TRPCError({
			code: 'FORBIDDEN',
			message: 'User Groups requires the Enterprise user-groups feature.',
		});
	}
}

async function handleQuery<T>(operation: () => Promise<T>): Promise<T> {
	try {
		return await operation();
	} catch (error) {
		if (error instanceof userGroupQueries.UserGroupQueryError) {
			throw new TRPCError({ code: error.code, message: error.message });
		}
		throw error;
	}
}

function unique<T>(values: T[]): T[] {
	return [...new Set(values)];
}
