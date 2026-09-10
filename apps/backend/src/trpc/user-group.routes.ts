import {
	DEFAULT_TOOL_CALL_DENSITY_POLICY,
	EMPTY_DATABASE_CONTEXT_ACCESS,
	EMPTY_DOCS_CONTEXT_ACCESS,
	normalizeDatabaseContextAccess,
	normalizeDocsContextAccess,
	normalizeDocsContextPath,
	TOOL_CALL_DENSITIES,
	USER_GROUP_FEATURES,
} from '@nao/shared';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { getDatabaseContextCatalog } from '../agents/user-rules';
import * as projectQueries from '../queries/project.queries';
import * as userGroupQueries from '../queries/user-group.queries';
import { getDocsContextCatalog } from '../services/docs-context-catalog.service';
import { hasFeature, LICENSE_FEATURES } from '../services/license.service';
import { getEffectiveUserGroupAccess } from '../services/user-group-feature-access.service';
import { adminProtectedProcedure, projectProtectedProcedure } from './trpc';

const groupNameSchema = z.string().trim().min(1, 'Group name is required.').max(80, 'Group name is too long.');
const featureGrantsSchema = z.array(z.enum(USER_GROUP_FEATURES)).max(USER_GROUP_FEATURES.length);
const toolCallDensityPolicySchema = z.object({
	defaultDensity: z.enum(TOOL_CALL_DENSITIES),
	canChange: z.boolean(),
});
const contextNameSchema = z.string().trim().min(1).max(255);
const databaseContextGrantSchema = z.discriminatedUnion('kind', [
	z
		.object({
			kind: z.literal('schema'),
			databaseType: contextNameSchema,
			database: contextNameSchema,
			schema: contextNameSchema,
		})
		.strict(),
	z
		.object({
			kind: z.literal('table'),
			databaseType: contextNameSchema,
			database: contextNameSchema,
			schema: contextNameSchema,
			table: contextNameSchema,
		})
		.strict(),
]);
const databaseAccessSchema = z.discriminatedUnion('mode', [
	z.object({ mode: z.literal('all'), strict: z.boolean().default(true) }).strict(),
	z
		.object({
			mode: z.literal('restricted'),
			strict: z.boolean().default(true),
			grants: z.array(databaseContextGrantSchema).max(10_000),
			patterns: z.array(z.string().max(255)).max(200).default([]),
		})
		.strict(),
]);
const docsPathSchema = z
	.string()
	.max(1_024)
	.refine((value) => normalizeDocsContextPath(value) !== null, 'Invalid docs path.')
	.transform((value) => normalizeDocsContextPath(value)!);
const docsContextGrantSchema = z.discriminatedUnion('kind', [
	z.object({ kind: z.literal('folder'), path: docsPathSchema }).strict(),
	z.object({ kind: z.literal('file'), path: docsPathSchema }).strict(),
]);
const docsAccessSchema = z.discriminatedUnion('mode', [
	z.object({ mode: z.literal('all') }).strict(),
	z.object({ mode: z.literal('restricted'), grants: z.array(docsContextGrantSchema).max(10_000) }).strict(),
]);

export const userGroupRoutes = {
	effectiveAccess: projectProtectedProcedure.query(async ({ ctx }) => {
		return getEffectiveUserGroupAccess(ctx.project.id, ctx.user.id);
	}),

	effectiveAccessForUser: adminProtectedProcedure
		.input(z.object({ userId: z.string().min(1) }))
		.query(async ({ ctx, input }) => {
			await assertUserGroupsLicensed();
			if (!(await projectQueries.getUserRoleInProject(ctx.project.id, input.userId))) {
				throw new TRPCError({
					code: 'NOT_FOUND',
					message: 'This user does not have access to the project.',
				});
			}
			return getEffectiveUserGroupAccess(ctx.project.id, input.userId);
		}),

	overview: adminProtectedProcedure.query(async ({ ctx }) => {
		await assertUserGroupsLicensed();
		return handleQuery(() => userGroupQueries.getUserGroupOverview(ctx.project.id));
	}),

	contextCatalog: adminProtectedProcedure.query(async ({ ctx }) => {
		await assertUserGroupsLicensed();
		if (!ctx.project.path) {
			throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'The project path is not configured.' });
		}
		return getDatabaseContextCatalog(ctx.project.path);
	}),

	docsContextCatalog: adminProtectedProcedure.query(async ({ ctx }) => {
		await assertUserGroupsLicensed();
		return getDocsContextCatalog(requireProjectPath(ctx.project.path));
	}),

	create: adminProtectedProcedure
		.input(
			z.object({
				name: groupNameSchema,
				featureGrants: featureGrantsSchema.default([]),
				toolCallDensityPolicy: toolCallDensityPolicySchema.default(DEFAULT_TOOL_CALL_DENSITY_POLICY),
				databaseAccess: databaseAccessSchema.default(EMPTY_DATABASE_CONTEXT_ACCESS),
				docsAccess: docsAccessSchema.default(EMPTY_DOCS_CONTEXT_ACCESS),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			await assertUserGroupsLicensed();
			const databaseAccess = normalizeDatabaseContextAccess(input.databaseAccess);
			const docsAccess = normalizeDocsContextAccess(input.docsAccess);
			return handleQuery(() =>
				userGroupQueries.createUserGroup(
					ctx.project.id,
					input.name,
					unique(input.featureGrants),
					input.toolCallDensityPolicy,
					databaseAccess,
					docsAccess,
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
				databaseAccess: databaseAccessSchema.optional(),
				docsAccess: docsAccessSchema.optional(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			await assertUserGroupsLicensed();
			const databaseAccess =
				input.databaseAccess === undefined ? undefined : normalizeDatabaseContextAccess(input.databaseAccess);
			const docsAccess =
				input.docsAccess === undefined ? undefined : normalizeDocsContextAccess(input.docsAccess);
			return handleQuery(() =>
				userGroupQueries.updateUserGroup(ctx.project.id, input.groupId, {
					name: input.name,
					featureGrants: unique(input.featureGrants),
					toolCallDensityPolicy: input.toolCallDensityPolicy,
					...(databaseAccess === undefined ? {} : { databaseAccess }),
					...(docsAccess === undefined ? {} : { docsAccess }),
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

function requireProjectPath(projectPath: string | null | undefined): string {
	if (!projectPath) {
		throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'The project path is not configured.' });
	}
	return projectPath;
}
