import {
	columnSecurityTableKey,
	compileRowSecurityConditions,
	type DatabaseContextAccess,
	DEFAULT_GROUP_SHARE_TARGETS,
	DEFAULT_TOOL_CALL_DENSITY_POLICY,
	EMPTY_DATABASE_CONTEXT_ACCESS,
	EMPTY_DOCS_CONTEXT_ACCESS,
	EMPTY_FILES_CONTEXT_ACCESS,
	EMPTY_MCP_ACCESS,
	EMPTY_SKILLS_ACCESS,
	EMPTY_USER_GROUP_COLUMN_POLICIES,
	FREE_CUSTOM_USER_GROUP_LIMIT,
	type GroupShareTargets,
	isDatabaseContextTableGranted,
	isMicrosoftEntraGroupId,
	MAX_PRELOADED_SKILLS,
	type McpAccess,
	normalizeDatabaseContextAccess,
	normalizeFileTreeAccess,
	normalizeFileTreePath,
	normalizeMcpAccess,
	normalizeProjectColumnSecurity,
	normalizeProjectRowSecurity,
	normalizeSkillsAccess,
	normalizeUserGroupColumnPolicies,
	normalizeUserGroupRowPolicies,
	normalizeUserGroupSsoMappings,
	PROJECT_SHARING_PERMISSIONS,
	type ProjectColumnSecurity,
	type ProjectRowSecurity,
	ROW_SECURITY_COMBINATORS,
	ROW_SECURITY_MAX_CONDITIONS,
	ROW_SECURITY_MAX_VALUE_LENGTH,
	ROW_SECURITY_OPERATORS,
	rowSecurityTableKey,
	type SkillsAccess,
	stripRowSecurityWhereClause,
	TOOL_CALL_DENSITIES,
	USER_GROUP_FEATURES,
	USER_ROLES,
	type UserGroupColumnPolicies,
	type UserGroupRowPolicies,
} from '@nao/shared';
import type { LlmModelIdsByConfig } from '@nao/shared/types';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { getDatabaseContextCatalog } from '../agents/user-rules';
import type { ActivityType } from '../db/abstractSchema';
import { env, isCloud } from '../env';
import * as projectQueries from '../queries/project.queries';
import * as llmConfigQueries from '../queries/project-llm-config.queries';
import * as storyFolderQueries from '../queries/story-folder.queries';
import * as storyViewerDataCacheQueries from '../queries/story-viewer-data-cache.queries';
import * as userGroupQueries from '../queries/user-group.queries';
import * as impersonationQueries from '../queries/user-group-impersonation.queries';
import { logActivity } from '../services/activity';
import { getDocsContextCatalog, getFilesContextCatalog } from '../services/file-tree-catalog.service';
import { hasFeature, LICENSE_FEATURES } from '../services/license.service';
import { setGroupBudget, setGroupSharedBudget } from '../services/member-budget.service';
import {
	getShareAudience,
	previewProjectWideShareRevocation,
	revokeUnauthorizedProjectWideShares,
} from '../services/project-sharing.service';
import { assertShareableUserGroupIds } from '../services/shareable-user-groups.service';
import {
	listEffectiveEntraUserGroupMappings,
	listEffectiveOidcUserGroupMappings,
} from '../services/sso-user-group-mapping.service';
import {
	assertUserGroupManageable,
	getActiveGroupImpersonation,
	getAvailableUserGroupOverview,
	listActiveUserGroups,
	validateAssignableUserGroupIds,
} from '../services/user-group-availability.service';
import {
	getEffectiveUserGroupAccess,
	getEffectiveUserGroupAccessForUserDetail,
} from '../services/user-group-feature-access.service';
import { validateWarehouseRowPredicate } from '../services/warehouse-sql.service';
import { budgetLimitUsdSchema } from '../types/member-budget';
import { assertMemberBudgetLicensed } from '../utils/member-budget';
import { parseEntraGroupNaoGroupMapping, parseOidcGroupNaoGroupMapping } from '../utils/sso-group-mapping';
import { adminProtectedProcedure, projectProtectedProcedure } from './trpc';

const MAX_BULK_MEMBERSHIP_USERS = 1_000;
const groupNameSchema = z.string().trim().min(1, 'Group name is required.').max(80, 'Group name is too long.');
const featureGrantsSchema = z.array(z.enum(USER_GROUP_FEATURES)).max(USER_GROUP_FEATURES.length);
const toolCallDensityPolicySchema = z.object({
	defaultDensity: z.enum(TOOL_CALL_DENSITIES),
	canChange: z.boolean(),
});
const projectSharingSchema = z.enum(PROJECT_SHARING_PERMISSIONS);
const storyFolderIdsSchema = z.array(z.string().min(1)).max(1_000);
const shareTargetsSchema = z
	.object({
		includeOwnGroup: z.boolean(),
		groupIds: z.array(z.string().min(1)).max(10_000),
	})
	.strict();
const skillNameSchema = z.string().trim().min(1).max(200);
const preloadedSkillsSchema = z.array(skillNameSchema).max(MAX_PRELOADED_SKILLS);
const llmConfigIdsSchema = z.array(z.string().min(1)).max(200);
const llmModelIdsByConfigSchema = z.record(z.string().min(1), z.array(z.string().trim().min(1).max(500)).max(1_000));
const skillsAccessSchema = z.discriminatedUnion('mode', [
	z.object({ mode: z.literal('all') }).strict(),
	z.object({ mode: z.literal('restricted'), skills: z.array(skillNameSchema).max(10_000) }).strict(),
]);
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
const fileTreePathSchema = z
	.string()
	.max(1_024)
	.refine((value) => normalizeFileTreePath(value) !== null, 'Invalid path.')
	.transform((value) => normalizeFileTreePath(value)!);
const fileTreeGrantSchema = z.discriminatedUnion('kind', [
	z.object({ kind: z.literal('folder'), path: fileTreePathSchema }).strict(),
	z.object({ kind: z.literal('file'), path: fileTreePathSchema }).strict(),
]);
const fileTreeAccessSchema = z.discriminatedUnion('mode', [
	z.object({ mode: z.literal('all') }).strict(),
	z.object({ mode: z.literal('restricted'), grants: z.array(fileTreeGrantSchema).max(10_000) }).strict(),
]);
const mcpGrantSchema = z.discriminatedUnion('kind', [
	z.object({ kind: z.literal('server'), server: contextNameSchema }).strict(),
	z.object({ kind: z.literal('tool'), server: contextNameSchema, tool: contextNameSchema }).strict(),
]);
const mcpAccessSchema = z.discriminatedUnion('mode', [
	z.object({ mode: z.literal('all') }).strict(),
	z.object({ mode: z.literal('restricted'), grants: z.array(mcpGrantSchema).max(10_000) }).strict(),
]);
const ssoIdentifierSchema = z.string().trim().min(1).max(255);
const ssoMappingsSchema = z
	.object({
		version: z.literal(1),
		providers: z
			.object({
				oidc: z.array(ssoIdentifierSchema).max(200),
				microsoft: z
					.array(
						ssoIdentifierSchema.refine(isMicrosoftEntraGroupId, 'Invalid Microsoft Entra group object ID.'),
					)
					.max(200),
			})
			.strict(),
		defaultProjectRole: z.enum(USER_ROLES).nullable().optional(),
	})
	.strict();
const rowTableIdentitySchema = z.object({
	databaseType: contextNameSchema,
	database: contextNameSchema,
	schema: contextNameSchema,
	table: contextNameSchema,
});
const projectRowSecuritySchema = z
	.object({
		version: z.literal(1),
		tables: z
			.array(
				rowTableIdentitySchema
					.extend({ constraintColumns: z.array(contextNameSchema).min(1).max(256) })
					.strict(),
			)
			.max(10_000),
	})
	.strict();
const projectColumnSecuritySchema = z
	.object({
		version: z.literal(1),
		tables: z
			.array(
				rowTableIdentitySchema
					.extend({ restrictedColumns: z.array(contextNameSchema).min(1).max(256) })
					.strict(),
			)
			.max(10_000),
	})
	.strict();
const updateProjectColumnSecuritySchema = projectColumnSecuritySchema.extend({
	expectedCurrent: projectColumnSecuritySchema.optional(),
});
const userGroupColumnPoliciesSchema = z
	.object({
		version: z.literal(1),
		policies: z
			.array(
				rowTableIdentitySchema.extend({ grantedColumns: z.array(contextNameSchema).min(1).max(256) }).strict(),
			)
			.max(10_000),
	})
	.strict();
const rowSecurityConditionSchema = z
	.object({
		column: contextNameSchema,
		operator: z.enum(ROW_SECURITY_OPERATORS),
		value: z.string().max(ROW_SECURITY_MAX_VALUE_LENGTH).optional(),
	})
	.strict()
	.superRefine((condition, context) => {
		const needsValue = condition.operator !== 'is-null' && condition.operator !== 'is-not-null';
		if (needsValue && !condition.value?.trim()) {
			context.addIssue({ code: 'custom', path: ['value'], message: 'A condition value is required.' });
		}
		if (!needsValue && condition.value !== undefined) {
			context.addIssue({ code: 'custom', path: ['value'], message: 'This operator does not accept a value.' });
		}
		if (
			(condition.operator === 'is-one-of' || condition.operator === 'is-not-one-of') &&
			condition.value?.split(',').some((item) => !item.trim())
		) {
			context.addIssue({
				code: 'custom',
				path: ['value'],
				message: 'Condition lists cannot contain empty values.',
			});
		}
	});
const rowSecuritySqlPredicateSchema = z
	.string()
	.trim()
	.min(1, 'Enter a WHERE clause.')
	.max(ROW_SECURITY_MAX_VALUE_LENGTH)
	.superRefine((value, context) => {
		if (!value) {
			return;
		}
		if (!/^where\b/i.test(value)) {
			context.addIssue({ code: 'custom', message: 'Start with WHERE.' });
		} else if (stripRowSecurityWhereClause(value) === null) {
			context.addIssue({ code: 'custom', message: 'Enter an expression after WHERE.' });
		}
	});
const userGroupRowPoliciesSchema = z
	.object({
		version: z.literal(1),
		policies: z
			.array(
				z.union([
					rowTableIdentitySchema.extend({ access: z.literal('full') }).strict(),
					rowTableIdentitySchema
						.extend({
							access: z.literal('predicate'),
							mode: z.literal('guided'),
							combinator: z.enum(ROW_SECURITY_COMBINATORS),
							conditions: z.array(rowSecurityConditionSchema).min(1).max(ROW_SECURITY_MAX_CONDITIONS),
						})
						.strict(),
					rowTableIdentitySchema
						.extend({
							access: z.literal('predicate'),
							mode: z.literal('sql'),
							predicate: rowSecuritySqlPredicateSchema,
						})
						.strict(),
				]),
			)
			.max(10_000),
	})
	.strict();

async function validateLlmAccess(
	projectId: string,
	configIds: string[],
	modelIdsByConfig: LlmModelIdsByConfig,
): Promise<{ llmConfigIds: string[]; llmModelIdsByConfig: LlmModelIdsByConfig }> {
	const uniqueIds = [...new Set(configIds)];
	const assignedIds = new Set(uniqueIds);
	if (Object.keys(modelIdsByConfig).some((configId) => !assignedIds.has(configId))) {
		throw new TRPCError({
			code: 'BAD_REQUEST',
			message: 'Model restrictions must reference an assigned LLM credential.',
		});
	}
	if (uniqueIds.length === 0) {
		return { llmConfigIds: [], llmModelIdsByConfig: {} };
	}
	if (!(await hasFeature(LICENSE_FEATURES.userGroups, { projectId }))) {
		throw new TRPCError({
			code: 'FORBIDDEN',
			message: 'An Enterprise user-groups license is required to assign LLM credentials.',
		});
	}
	const activeIds = new Set((await llmConfigQueries.getProjectLlmConfigs(projectId)).map((config) => config.id));
	if (uniqueIds.some((configId) => !activeIds.has(configId))) {
		throw new TRPCError({
			code: 'BAD_REQUEST',
			message: 'Every LLM credential must be active and belong to this project.',
		});
	}
	return {
		llmConfigIds: uniqueIds,
		llmModelIdsByConfig: Object.fromEntries(
			Object.entries(modelIdsByConfig).map(([configId, modelIds]) => [configId, [...new Set(modelIds)]]),
		),
	};
}

export const userGroupRoutes = {
	effectiveAccess: projectProtectedProcedure.query(async ({ ctx }) => {
		return getEffectiveUserGroupAccess(ctx.project.id, ctx.user.id, ctx.userRole);
	}),

	projectSharingAccess: projectProtectedProcedure.query(async ({ ctx }) => {
		const audience = await getShareAudience(ctx.project.id, ctx.user.id);
		return { canShareToProject: audience.canShareToProject };
	}),

	previewProjectSharingRevocation: adminProtectedProcedure
		.input(z.object({ groupId: z.string().min(1), projectSharing: projectSharingSchema }))
		.query(async ({ ctx, input }) => {
			return previewProjectWideShareRevocation(ctx.project.id, input.groupId, input.projectSharing);
		}),

	effectiveAccessForUser: adminProtectedProcedure
		.input(z.object({ userId: z.string().min(1) }))
		.query(async ({ ctx, input }) => {
			const role = await projectQueries.getUserRoleInProject(ctx.project.id, input.userId);
			if (!role) {
				throw new TRPCError({
					code: 'NOT_FOUND',
					message: 'This user does not have access to the project.',
				});
			}
			return getEffectiveUserGroupAccessForUserDetail(ctx.project.id, input.userId, role);
		}),

	impersonation: projectProtectedProcedure.query(async ({ ctx }) => {
		const groupIds = await getActiveGroupImpersonation(ctx.project.id, ctx.user.id);
		if (!groupIds) {
			return null;
		}
		return { groupNames: await listGroupNames(ctx.project.id, groupIds) };
	}),

	startImpersonation: projectProtectedProcedure
		.input(z.object({ groupIds: z.array(z.string().min(1)).max(100) }))
		.mutation(async ({ ctx, input }) => {
			if (isCloud) {
				throw new TRPCError({
					code: 'FORBIDDEN',
					message: 'Group impersonation is not available on nao Cloud yet.',
				});
			}
			if ((await projectQueries.getActualUserRoleInProject(ctx.project.id, ctx.user.id)) !== 'admin') {
				throw new TRPCError({ code: 'FORBIDDEN', message: 'Only admins can impersonate user groups.' });
			}
			const groupIds = await handleQuery(() => validateAssignableUserGroupIds(ctx.project.id, input.groupIds));
			await impersonationQueries.startGroupImpersonation(ctx.project.id, ctx.user.id, groupIds);
			await storyViewerDataCacheQueries.invalidateProjectViewerCaches(ctx.project.id);
			await logImpersonationActivity(ctx.project.id, ctx.user.id, 'user_group.impersonation_started', groupIds);
		}),

	stopImpersonation: projectProtectedProcedure.mutation(async ({ ctx }) => {
		const groupIds = await impersonationQueries.stopGroupImpersonation(ctx.project.id, ctx.user.id);
		if (groupIds) {
			await storyViewerDataCacheQueries.invalidateProjectViewerCaches(ctx.project.id);
			await logImpersonationActivity(ctx.project.id, ctx.user.id, 'user_group.impersonation_stopped', groupIds);
		}
	}),

	overview: adminProtectedProcedure.query(async ({ ctx }) => {
		return handleQuery(() => getAvailableUserGroupOverview(ctx.project.id));
	}),

	effectiveOidcEnvMappings: adminProtectedProcedure.query(async ({ ctx }) => {
		if (!(await hasFeature(LICENSE_FEATURES.sso))) {
			throw new TRPCError({ code: 'FORBIDDEN', message: 'SSO requires an Enterprise license.' });
		}
		const mappings = parseOidcGroupNaoGroupMapping(env.OIDC_GROUP_NAO_GROUP_MAPPING);
		if (mappings.status === 'invalid') {
			throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'The OIDC User Group mapping is invalid.' });
		}
		return listEffectiveOidcUserGroupMappings(ctx.project.id, mappings.mappings);
	}),

	effectiveMicrosoftEnvMappings: adminProtectedProcedure.query(async ({ ctx }) => {
		if (!(await hasFeature(LICENSE_FEATURES.sso))) {
			throw new TRPCError({ code: 'FORBIDDEN', message: 'SSO requires an Enterprise license.' });
		}
		const mappings = parseEntraGroupNaoGroupMapping(env.AZURE_AD_GROUP_NAO_GROUP_MAPPING);
		if (mappings.status === 'invalid') {
			throw new TRPCError({
				code: 'INTERNAL_SERVER_ERROR',
				message: 'The Microsoft Entra User Group mapping is invalid.',
			});
		}
		return listEffectiveEntraUserGroupMappings(ctx.project.id, mappings.mappings);
	}),

	contextCatalog: adminProtectedProcedure.query(async ({ ctx }) => {
		if (!ctx.project.path) {
			throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'The project path is not configured.' });
		}
		return getDatabaseContextCatalog(ctx.project.path, { fresh: true });
	}),

	columnSecurity: adminProtectedProcedure.query(async ({ ctx }) => {
		return handleQuery(() => userGroupQueries.getProjectColumnSecurity(ctx.project.id));
	}),

	updateColumnSecurity: adminProtectedProcedure
		.input(updateProjectColumnSecuritySchema)
		.mutation(async ({ ctx, input }) => {
			const columnSecurity = normalizeProjectColumnSecurity({ version: input.version, tables: input.tables });
			const expectedCurrent =
				input.expectedCurrent === undefined ? undefined : normalizeProjectColumnSecurity(input.expectedCurrent);
			await assertColumnSecurityChangeAllowed(ctx.project.id, columnSecurity);
			await validateProjectColumnSecurityCatalog(
				ctx.project.id,
				requireProjectPath(ctx.project.path),
				columnSecurity,
			);
			const saved = await handleQuery(() =>
				expectedCurrent === undefined
					? userGroupQueries.updateProjectColumnSecurity(ctx.project.id, columnSecurity)
					: userGroupQueries.updateProjectColumnSecurity(ctx.project.id, columnSecurity, expectedCurrent),
			);
			await storyViewerDataCacheQueries.invalidateProjectViewerCaches(ctx.project.id);
			return saved;
		}),

	rowSecurity: adminProtectedProcedure.query(async ({ ctx }) => {
		return handleQuery(() => userGroupQueries.getProjectRowSecurity(ctx.project.id));
	}),

	updateRowSecurity: adminProtectedProcedure.input(projectRowSecuritySchema).mutation(async ({ ctx, input }) => {
		const rowSecurity = normalizeProjectRowSecurity(input);
		await assertRowSecurityChangeAllowed(ctx.project.id, rowSecurity);
		await validateProjectRowSecurityCatalog(requireProjectPath(ctx.project.path), rowSecurity);
		const updated = await handleQuery(() => userGroupQueries.updateProjectRowSecurity(ctx.project.id, rowSecurity));
		await storyViewerDataCacheQueries.invalidateProjectViewerCaches(ctx.project.id);
		return updated;
	}),

	docsContextCatalog: adminProtectedProcedure.query(async ({ ctx }) => {
		return getDocsContextCatalog(requireProjectPath(ctx.project.path));
	}),

	filesContextCatalog: adminProtectedProcedure.query(async ({ ctx }) => {
		return getFilesContextCatalog(requireProjectPath(ctx.project.path));
	}),

	create: adminProtectedProcedure
		.input(
			z.object({
				name: groupNameSchema,
				featureGrants: featureGrantsSchema.default([]),
				toolCallDensityPolicy: toolCallDensityPolicySchema.default(DEFAULT_TOOL_CALL_DENSITY_POLICY),
				projectSharing: projectSharingSchema.default('inherit'),
				shareTargets: shareTargetsSchema.default(DEFAULT_GROUP_SHARE_TARGETS),
				showAllSettings: z.boolean().default(false),
				advancedContextExplorer: z.boolean().default(false),
				preloadedSkills: preloadedSkillsSchema.default([]),
				databaseAccess: databaseAccessSchema.default(EMPTY_DATABASE_CONTEXT_ACCESS),
				docsAccess: fileTreeAccessSchema.default(EMPTY_DOCS_CONTEXT_ACCESS),
				filesAccess: fileTreeAccessSchema.default(EMPTY_FILES_CONTEXT_ACCESS),
				mcpAccess: mcpAccessSchema.default(EMPTY_MCP_ACCESS),
				skillsAccess: skillsAccessSchema.default(EMPTY_SKILLS_ACCESS),
				ssoMappings: ssoMappingsSchema.optional(),
				columnPolicies: userGroupColumnPoliciesSchema.optional(),
				rowPolicies: userGroupRowPoliciesSchema.optional(),
				llmConfigIds: llmConfigIdsSchema.default([]),
				llmModelIdsByConfig: llmModelIdsByConfigSchema.default({}),
				budgetLimitUsd: budgetLimitUsdSchema.optional(),
				sharedBudgetLimitUsd: budgetLimitUsdSchema.optional(),
				storyFolderIds: storyFolderIdsSchema.optional(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			await assertGroupBudgetEditable(ctx.project.id, input);
			await assertTeamFoldersChangeAllowed(ctx.project.id, null, input.storyFolderIds);
			const llmAccess = await validateLlmAccess(ctx.project.id, input.llmConfigIds, input.llmModelIdsByConfig);
			const databaseAccess = normalizeDatabaseContextAccess(input.databaseAccess);
			const docsAccess = normalizeFileTreeAccess(input.docsAccess);
			const filesAccess = normalizeFileTreeAccess(input.filesAccess);
			const mcpAccess = normalizeMcpAccess(input.mcpAccess);
			await assertMcpAccessChangeAllowed(ctx.project.id, mcpAccess, () => EMPTY_MCP_ACCESS);
			const skillsAccess = normalizeSkillsAccess(input.skillsAccess);
			await assertSkillsAccessChangeAllowed(ctx.project.id, skillsAccess, () => EMPTY_SKILLS_ACCESS);
			const shareTargets = await keepExistingShareTargetGroups(ctx.project.id, input.shareTargets);
			let rowPolicies: UserGroupRowPolicies | undefined;
			let rowPoliciesRegistry: ProjectRowSecurity | undefined;
			if (input.rowPolicies !== undefined) {
				await assertRowSecurityLicensed(ctx.project.id);
				const validation = await validateGroupRowPolicies(
					ctx.project.id,
					normalizeUserGroupRowPolicies(input.rowPolicies),
				);
				rowPolicies = validation.rowPolicies;
				rowPoliciesRegistry = validation.registry;
			}
			let columnPolicies = EMPTY_USER_GROUP_COLUMN_POLICIES;
			let columnPoliciesRegistry: ProjectColumnSecurity | undefined;
			if (input.columnPolicies !== undefined) {
				await assertColumnSecurityLicensed(ctx.project.id);
				const validation = await validateGroupColumnPolicies(
					ctx.project.id,
					normalizeUserGroupColumnPolicies(input.columnPolicies),
					databaseAccess,
				);
				columnPolicies = validation.columnPolicies;
				columnPoliciesRegistry = validation.registry;
			}
			const createUserGroup = (await hasFeature(LICENSE_FEATURES.userGroups, { projectId: ctx.project.id }))
				? userGroupQueries.createUserGroup
				: userGroupQueries.createUserGroupWithinLimit.bind(null, FREE_CUSTOM_USER_GROUP_LIMIT);
			const group = await handleQuery(() => {
				const values = [
					ctx.project.id,
					input.name,
					unique(input.featureGrants),
					input.toolCallDensityPolicy,
					databaseAccess,
					docsAccess,
					input.ssoMappings === undefined ? undefined : normalizeUserGroupSsoMappings(input.ssoMappings),
					rowPolicies,
					filesAccess,
					input.projectSharing,
					mcpAccess,
					input.showAllSettings,
					input.preloadedSkills,
					skillsAccess,
					columnPolicies,
					shareTargets,
					input.advancedContextExplorer,
					llmAccess.llmConfigIds,
					llmAccess.llmModelIdsByConfig,
				] as const;
				return rowPoliciesRegistry === undefined && columnPoliciesRegistry === undefined
					? createUserGroup(...values)
					: createUserGroup(...values, rowPoliciesRegistry, columnPoliciesRegistry);
			});
			await saveNewGroupTeamFolders(ctx, group.id, input.storyFolderIds);
			await saveGroupBudget(ctx.project.id, group.id, input);
			return group;
		}),

	update: adminProtectedProcedure
		.input(
			z.object({
				groupId: z.string().min(1),
				name: groupNameSchema.optional(),
				featureGrants: featureGrantsSchema,
				toolCallDensityPolicy: toolCallDensityPolicySchema,
				projectSharing: projectSharingSchema.optional(),
				shareTargets: shareTargetsSchema.optional(),
				showAllSettings: z.boolean().optional(),
				advancedContextExplorer: z.boolean().optional(),
				preloadedSkills: preloadedSkillsSchema.optional(),
				databaseAccess: databaseAccessSchema.optional(),
				docsAccess: fileTreeAccessSchema.optional(),
				filesAccess: fileTreeAccessSchema.optional(),
				mcpAccess: mcpAccessSchema.optional(),
				skillsAccess: skillsAccessSchema.optional(),
				ssoMappings: ssoMappingsSchema.optional(),
				columnPolicies: userGroupColumnPoliciesSchema.optional(),
				rowPolicies: userGroupRowPoliciesSchema.optional(),
				llmConfigIds: llmConfigIdsSchema.optional(),
				llmModelIdsByConfig: llmModelIdsByConfigSchema.optional(),
				budgetLimitUsd: budgetLimitUsdSchema.optional(),
				sharedBudgetLimitUsd: budgetLimitUsdSchema.optional(),
				storyFolderIds: storyFolderIdsSchema.optional(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			await handleQuery(() => assertUserGroupManageable(ctx.project.id, input.groupId));
			await assertGroupBudgetEditable(ctx.project.id, input);
			await assertTeamFoldersChangeAllowed(ctx.project.id, input.groupId, input.storyFolderIds);
			const llmAccess =
				input.llmConfigIds === undefined
					? undefined
					: await validateLlmAccess(ctx.project.id, input.llmConfigIds, input.llmModelIdsByConfig ?? {});
			if (input.llmModelIdsByConfig !== undefined && llmAccess === undefined) {
				throw new TRPCError({
					code: 'BAD_REQUEST',
					message: 'LLM credential assignments are required with model restrictions.',
				});
			}
			const databaseAccess =
				input.databaseAccess === undefined ? undefined : normalizeDatabaseContextAccess(input.databaseAccess);
			const docsAccess = input.docsAccess === undefined ? undefined : normalizeFileTreeAccess(input.docsAccess);
			const filesAccess =
				input.filesAccess === undefined ? undefined : normalizeFileTreeAccess(input.filesAccess);
			const mcpAccess = input.mcpAccess === undefined ? undefined : normalizeMcpAccess(input.mcpAccess);
			if (mcpAccess !== undefined) {
				await assertMcpAccessChangeAllowed(ctx.project.id, mcpAccess, () =>
					getCurrentGroupMcpAccess(ctx.project.id, input.groupId),
				);
			}
			const skillsAccess =
				input.skillsAccess === undefined ? undefined : normalizeSkillsAccess(input.skillsAccess);
			if (skillsAccess !== undefined) {
				await assertSkillsAccessChangeAllowed(ctx.project.id, skillsAccess, () =>
					getCurrentGroupSkillsAccess(ctx.project.id, input.groupId),
				);
			}
			const shareTargets =
				input.shareTargets === undefined
					? undefined
					: await keepExistingShareTargetGroups(ctx.project.id, input.shareTargets, input.groupId);
			let rowPolicies: UserGroupRowPolicies | undefined;
			let rowPoliciesRegistry: ProjectRowSecurity | undefined;
			if (input.rowPolicies !== undefined) {
				await assertRowSecurityLicensed(ctx.project.id);
				const validation = await validateGroupRowPolicies(
					ctx.project.id,
					normalizeUserGroupRowPolicies(input.rowPolicies),
				);
				rowPolicies = validation.rowPolicies;
				rowPoliciesRegistry = validation.registry;
			}
			let columnPolicies: UserGroupColumnPolicies | undefined;
			let columnPoliciesRegistry: ProjectColumnSecurity | undefined;
			if (input.columnPolicies !== undefined) {
				await assertColumnSecurityLicensed(ctx.project.id);
				const validation = await validateGroupColumnPolicies(
					ctx.project.id,
					normalizeUserGroupColumnPolicies(input.columnPolicies),
					databaseAccess ?? (await getCurrentGroupDatabaseAccess(ctx.project.id, input.groupId)),
				);
				columnPolicies = validation.columnPolicies;
				columnPoliciesRegistry = validation.registry;
			}
			const group = await handleQuery(() =>
				userGroupQueries.updateUserGroup(ctx.project.id, input.groupId, {
					name: input.name,
					featureGrants: unique(input.featureGrants),
					toolCallDensityPolicy: input.toolCallDensityPolicy,
					projectSharing: input.projectSharing,
					shareTargets,
					showAllSettings: input.showAllSettings,
					advancedContextExplorer: input.advancedContextExplorer,
					preloadedSkills: input.preloadedSkills,
					...(databaseAccess === undefined ? {} : { databaseAccess }),
					...(docsAccess === undefined ? {} : { docsAccess }),
					...(filesAccess === undefined ? {} : { filesAccess }),
					...(mcpAccess === undefined ? {} : { mcpAccess }),
					...(skillsAccess === undefined ? {} : { skillsAccess }),
					...(input.ssoMappings === undefined
						? {}
						: { ssoMappings: normalizeUserGroupSsoMappings(input.ssoMappings) }),
					...(rowPolicies === undefined ? {} : { rowPolicies, rowPoliciesRegistry }),
					...(columnPolicies === undefined ? {} : { columnPolicies, columnPoliciesRegistry }),
					...(llmAccess === undefined ? {} : llmAccess),
				}),
			);
			const changesWarehouseAccess = [rowPolicies, columnPolicies, databaseAccess, input.ssoMappings].some(
				(change) => change !== undefined,
			);
			if (changesWarehouseAccess) {
				await storyViewerDataCacheQueries.invalidateProjectViewerCaches(ctx.project.id);
			}
			await saveGroupBudget(ctx.project.id, input.groupId, input);
			await saveGroupTeamFolders(ctx, input.groupId, input.storyFolderIds);
			await revokeUnauthorizedProjectWideShares(ctx.project.id);
			return group;
		}),

	updateLlmAccess: adminProtectedProcedure
		.input(
			z.object({
				groupId: z.string().min(1),
				llmConfigIds: llmConfigIdsSchema,
				llmModelIdsByConfig: llmModelIdsByConfigSchema.default({}),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			await handleQuery(() => assertUserGroupManageable(ctx.project.id, input.groupId));
			const llmAccess = await validateLlmAccess(ctx.project.id, input.llmConfigIds, input.llmModelIdsByConfig);
			return handleQuery(() =>
				userGroupQueries.updateUserGroupLlmAccess(
					ctx.project.id,
					input.groupId,
					llmAccess.llmConfigIds,
					llmAccess.llmModelIdsByConfig,
				),
			);
		}),

	delete: adminProtectedProcedure.input(z.object({ groupId: z.string().min(1) })).mutation(async ({ ctx, input }) => {
		await handleQuery(() => assertUserGroupManageable(ctx.project.id, input.groupId));
		await storyViewerDataCacheQueries.invalidateProjectViewerCaches(ctx.project.id);
		await storyFolderQueries.withProjectFolderLock(ctx.project.id, async () => {
			await assertNoFolderLeftWithoutGroup(input.groupId);
			await handleQuery(() => userGroupQueries.deleteUserGroup(ctx.project.id, input.groupId));
		});
		await revokeUnauthorizedProjectWideShares(ctx.project.id);
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
			await handleQuery(() => assertUserGroupManageable(ctx.project.id, input.groupId));
			await handleQuery(() =>
				userGroupQueries.setUserGroupMembership(ctx.project.id, input.groupId, input.userId, input.isMember),
			);
			await storyViewerDataCacheQueries.invalidateProjectViewerCaches(ctx.project.id);
			await revokeUnauthorizedProjectWideShares(ctx.project.id);
		}),

	setMemberships: adminProtectedProcedure
		.input(
			z.object({
				groupId: z.string().min(1),
				userIds: z.array(z.string().min(1)).min(1).max(MAX_BULK_MEMBERSHIP_USERS),
				isMember: z.boolean(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			await handleQuery(() => assertUserGroupManageable(ctx.project.id, input.groupId));
			await handleQuery(() =>
				userGroupQueries.setUserGroupMemberships(ctx.project.id, input.groupId, input.userIds, input.isMember),
			);
			await storyViewerDataCacheQueries.invalidateProjectViewerCaches(ctx.project.id);
			await revokeUnauthorizedProjectWideShares(ctx.project.id);
		}),
};

async function saveGroupTeamFolders(
	ctx: { project: { id: string }; user: { id: string } },
	groupId: string,
	storyFolderIds: string[] | undefined,
): Promise<void> {
	if (storyFolderIds === undefined) {
		return;
	}
	try {
		await storyFolderQueries.setGroupTeamFolders(ctx.project.id, groupId, storyFolderIds, ctx.user.id);
	} catch (error) {
		if (error instanceof storyFolderQueries.TeamFolderError) {
			throw new TRPCError({ code: 'BAD_REQUEST', message: error.message });
		}
		throw error;
	}
}

/** A new group whose folders cannot be saved is removed again, so creating it again does not hit its own name. */
async function saveNewGroupTeamFolders(
	ctx: { project: { id: string }; user: { id: string } },
	groupId: string,
	storyFolderIds: string[] | undefined,
): Promise<void> {
	try {
		await saveGroupTeamFolders(ctx, groupId, storyFolderIds);
	} catch (error) {
		await userGroupQueries.deleteUserGroup(ctx.project.id, groupId);
		throw error;
	}
}

/** Like MCP restrictions, taking folders away from a group stays possible without the license. */
async function assertTeamFoldersChangeAllowed(
	projectId: string,
	groupId: string | null,
	storyFolderIds: string[] | undefined,
): Promise<void> {
	if (!storyFolderIds?.length) {
		return;
	}
	const currentFolderIds = groupId ? await storyFolderQueries.listGroupFolderIds(groupId) : [];
	if (storyFolderIds.every((folderId) => currentFolderIds.includes(folderId))) {
		return;
	}
	if (!(await hasFeature(LICENSE_FEATURES.rowLevelSecurity, { projectId }))) {
		throw new TRPCError({ code: 'FORBIDDEN', message: 'Team folders require an Enterprise license.' });
	}
	if (groupId) {
		await assertShareableUserGroupIds(projectId, [groupId]);
	}
}

/** A team folder without groups would open to the entire project, so its last group cannot just disappear. */
async function assertNoFolderLeftWithoutGroup(groupId: string): Promise<void> {
	const folderNames = await storyFolderQueries.listFolderNamesOnlyOwnedByGroup(groupId);
	if (folderNames.length > 0) {
		throw new TRPCError({
			code: 'BAD_REQUEST',
			message: `This group is the only one with access to ${folderNames.map((name) => `"${name}"`).join(', ')}. Remove these folders from the group in its Folders tab, or give them to another group, before deleting it. Archived folders must be restored first.`,
		});
	}
}

interface GroupBudgetsInput {
	budgetLimitUsd?: number | null;
	sharedBudgetLimitUsd?: number | null;
}

async function listGroupNames(projectId: string, groupIds: string[]): Promise<string[]> {
	const groups = await listActiveUserGroups(projectId);
	return groups.filter((group) => groupIds.includes(group.id)).map((group) => group.name);
}

async function logImpersonationActivity(
	projectId: string,
	userId: string,
	type: Extract<ActivityType, `user_group.impersonation_${string}`>,
	groupIds: string[],
): Promise<void> {
	await logActivity({
		projectId,
		userId,
		type,
		payload: { groupIds, groupNames: await listGroupNames(projectId, groupIds) },
	});
}

async function assertGroupBudgetEditable(projectId: string, input: GroupBudgetsInput): Promise<void> {
	if (input.budgetLimitUsd !== undefined || input.sharedBudgetLimitUsd !== undefined) {
		await assertMemberBudgetLicensed(projectId);
	}
}

async function saveGroupBudget(projectId: string, groupId: string, input: GroupBudgetsInput): Promise<void> {
	if (input.budgetLimitUsd !== undefined) {
		await setGroupBudget(projectId, groupId, input.budgetLimitUsd);
	}
	if (input.sharedBudgetLimitUsd !== undefined) {
		await setGroupSharedBudget(projectId, groupId, input.sharedBudgetLimitUsd);
	}
}

/** Drops the group itself and groups that are not active custom groups of the project, like deleted or locked ones. */
async function keepExistingShareTargetGroups(
	projectId: string,
	shareTargets: GroupShareTargets,
	groupId?: string,
): Promise<GroupShareTargets> {
	if (shareTargets.groupIds.length === 0) {
		return shareTargets;
	}
	const groups = await listActiveUserGroups(projectId);
	const targetableGroupIds = new Set(
		groups.filter((group) => !group.isDefault && group.id !== groupId).map((group) => group.id),
	);
	return {
		includeOwnGroup: shareTargets.includeOwnGroup,
		groupIds: unique(shareTargets.groupIds).filter((targetId) => targetableGroupIds.has(targetId)),
	};
}

async function assertRowSecurityLicensed(projectId: string): Promise<void> {
	if (!(await hasFeature(LICENSE_FEATURES.rowLevelSecurity, { projectId }))) {
		throw new TRPCError({ code: 'FORBIDDEN', message: 'Row-level security requires an Enterprise license.' });
	}
}

async function assertColumnSecurityLicensed(projectId: string): Promise<void> {
	if (!(await hasFeature(LICENSE_FEATURES.rowLevelSecurity, { projectId }))) {
		throw new TRPCError({ code: 'FORBIDDEN', message: 'Column-level security requires an Enterprise license.' });
	}
}

/** Without the license an admin may still lift MCP restrictions, so a lapsed license never locks a group in. */
async function assertMcpAccessChangeAllowed(
	projectId: string,
	mcpAccess: McpAccess,
	getCurrentMcpAccess: () => McpAccess | Promise<McpAccess>,
): Promise<void> {
	if (mcpAccess.mode === 'all') {
		return;
	}
	const currentMcpAccess = normalizeMcpAccess(await getCurrentMcpAccess());
	if (JSON.stringify(currentMcpAccess) === JSON.stringify(mcpAccess)) {
		return;
	}
	if (!(await hasFeature(LICENSE_FEATURES.rowLevelSecurity, { projectId }))) {
		throw new TRPCError({
			code: 'FORBIDDEN',
			message: 'Restricting MCP servers per group requires an Enterprise license.',
		});
	}
}

async function getCurrentGroupMcpAccess(projectId: string, groupId: string): Promise<McpAccess> {
	const groups = await userGroupQueries.listUserGroups(projectId);
	return groups.find((group) => group.id === groupId)?.mcpAccess ?? EMPTY_MCP_ACCESS;
}

async function getCurrentGroupDatabaseAccess(projectId: string, groupId: string): Promise<DatabaseContextAccess> {
	const groups = await userGroupQueries.listUserGroups(projectId);
	return groups.find((group) => group.id === groupId)?.databaseAccess ?? EMPTY_DATABASE_CONTEXT_ACCESS;
}

/** Like MCP restrictions, lifting skill restrictions stays possible without the license. */
async function assertSkillsAccessChangeAllowed(
	projectId: string,
	skillsAccess: SkillsAccess,
	getCurrentSkillsAccess: () => SkillsAccess | Promise<SkillsAccess>,
): Promise<void> {
	if (skillsAccess.mode === 'all') {
		return;
	}
	const currentSkillsAccess = normalizeSkillsAccess(await getCurrentSkillsAccess());
	if (JSON.stringify(currentSkillsAccess) === JSON.stringify(skillsAccess)) {
		return;
	}
	if (!(await hasFeature(LICENSE_FEATURES.rowLevelSecurity, { projectId }))) {
		throw new TRPCError({
			code: 'FORBIDDEN',
			message: 'Restricting skills per group requires an Enterprise license.',
		});
	}
}

async function getCurrentGroupSkillsAccess(projectId: string, groupId: string): Promise<SkillsAccess> {
	const groups = await userGroupQueries.listUserGroups(projectId);
	return groups.find((group) => group.id === groupId)?.skillsAccess ?? EMPTY_SKILLS_ACCESS;
}

async function assertRowSecurityChangeAllowed(projectId: string, rowSecurity: ProjectRowSecurity): Promise<void> {
	if (await hasFeature(LICENSE_FEATURES.rowLevelSecurity, { projectId })) {
		return;
	}
	const current = normalizeProjectRowSecurity(await userGroupQueries.getProjectRowSecurity(projectId));
	const currentTables = new Map(current.tables.map((table) => [rowSecurityTableKey(table), table.constraintColumns]));
	const onlyRemovesTables = rowSecurity.tables.every((table) => {
		const currentColumns = currentTables.get(rowSecurityTableKey(table));
		return (
			currentColumns !== undefined &&
			currentColumns.length === table.constraintColumns.length &&
			currentColumns.every((column, index) => column === table.constraintColumns[index])
		);
	});
	if (!onlyRemovesTables) {
		throw new TRPCError({ code: 'FORBIDDEN', message: 'Row-level security requires an Enterprise license.' });
	}
}

async function assertColumnSecurityChangeAllowed(
	projectId: string,
	columnSecurity: ProjectColumnSecurity,
): Promise<void> {
	if (await hasFeature(LICENSE_FEATURES.rowLevelSecurity, { projectId })) {
		return;
	}
	const current = normalizeProjectColumnSecurity(await userGroupQueries.getProjectColumnSecurity(projectId));
	const currentTables = new Map(
		current.tables.map((table) => [columnSecurityTableKey(table), table.restrictedColumns]),
	);
	const onlyRemovesTables = columnSecurity.tables.every((table) => {
		const currentColumns = currentTables.get(columnSecurityTableKey(table));
		return (
			currentColumns !== undefined &&
			currentColumns.length === table.restrictedColumns.length &&
			currentColumns.every((column, index) => column === table.restrictedColumns[index])
		);
	});
	if (!onlyRemovesTables) {
		throw new TRPCError({ code: 'FORBIDDEN', message: 'Column-level security requires an Enterprise license.' });
	}
}

async function validateProjectRowSecurityCatalog(
	projectPath: string,
	rowSecurity: ReturnType<typeof normalizeProjectRowSecurity>,
): Promise<void> {
	const catalog = getDatabaseContextCatalog(projectPath, { fresh: true });
	for (const table of rowSecurity.tables) {
		const catalogTable = catalog.objects.find(
			(candidate) =>
				candidate.databaseType === table.databaseType &&
				candidate.database === table.database &&
				candidate.schema === table.schema &&
				candidate.table === table.table,
		);
		if (!catalogTable) {
			throw new TRPCError({
				code: 'BAD_REQUEST',
				message: `Table ${table.schema}.${table.table} is not in the synced catalog.`,
			});
		}
		if (table.constraintColumns.some((column) => !catalogTable.columns.includes(column))) {
			throw new TRPCError({
				code: 'BAD_REQUEST',
				message: `Invalid filter column for ${table.schema}.${table.table}.`,
			});
		}
	}
}

async function validateProjectColumnSecurityCatalog(
	projectId: string,
	projectPath: string,
	columnSecurity: ReturnType<typeof normalizeProjectColumnSecurity>,
): Promise<void> {
	const current = normalizeProjectColumnSecurity(await userGroupQueries.getProjectColumnSecurity(projectId));
	const currentTables = new Map(current.tables.map((table) => [columnSecurityTableKey(table), table]));
	const catalog = getDatabaseContextCatalog(projectPath, { fresh: true });
	for (const table of columnSecurity.tables) {
		const currentTable = currentTables.get(columnSecurityTableKey(table));
		const currentColumns = new Set(currentTable?.restrictedColumns ?? []);
		const addedColumns = table.restrictedColumns.filter((column) => !currentColumns.has(column));
		if (addedColumns.length === 0) {
			continue;
		}
		const catalogTable = catalog.objects.find(
			(candidate) =>
				candidate.databaseType === table.databaseType &&
				candidate.database === table.database &&
				candidate.schema === table.schema &&
				candidate.table === table.table,
		);
		if (!catalogTable) {
			throw new TRPCError({
				code: 'BAD_REQUEST',
				message: `Table ${table.schema}.${table.table} is not in the synced catalog.`,
			});
		}
		if (addedColumns.some((column) => !catalogTable.columns.includes(column))) {
			throw new TRPCError({
				code: 'BAD_REQUEST',
				message: `Invalid hidden column for ${table.schema}.${table.table}.`,
			});
		}
	}
}

async function validateGroupRowPolicies(
	projectId: string,
	rowPolicies: ReturnType<typeof normalizeUserGroupRowPolicies>,
): Promise<{ rowPolicies: ReturnType<typeof normalizeUserGroupRowPolicies>; registry: ProjectRowSecurity }> {
	const registry = await userGroupQueries.getProjectRowSecurity(projectId);
	const registered = new Map(
		registry.tables.map((table) => [
			[table.databaseType, table.database, table.schema, table.table].join('\0'),
			table,
		]),
	);
	if (
		rowPolicies.policies.some(
			(policy) => !registered.has([policy.databaseType, policy.database, policy.schema, policy.table].join('\0')),
		)
	) {
		throw new TRPCError({
			code: 'BAD_REQUEST',
			message: 'A row policy references a table outside the project registry.',
		});
	}
	const policies = await Promise.all(
		rowPolicies.policies.map(async (policy) => {
			if (policy.access === 'full') {
				return policy;
			}
			const table = registered.get(
				[policy.databaseType, policy.database, policy.schema, policy.table].join('\0'),
			)!;
			if (
				policy.mode === 'guided' &&
				policy.conditions.some((condition) => !table.constraintColumns.includes(condition.column))
			) {
				throw new TRPCError({
					code: 'BAD_REQUEST',
					message: `Invalid filter column for ${table.schema}.${table.table}.`,
				});
			}
			try {
				const predicate =
					policy.mode === 'guided'
						? compileRowSecurityConditions(policy.conditions, table.databaseType, policy.combinator)
						: stripRowSecurityWhereClause(policy.predicate)!;
				const normalizedPredicate = await validateWarehouseRowPredicate(
					predicate,
					table.constraintColumns,
					table.databaseType,
				);
				return policy.mode === 'sql' ? { ...policy, predicate: `WHERE ${normalizedPredicate}` } : policy;
			} catch (error) {
				throw new TRPCError({
					code: 'BAD_REQUEST',
					message: error instanceof Error ? error.message : 'Invalid row predicate.',
				});
			}
		}),
	);
	return {
		rowPolicies: normalizeUserGroupRowPolicies({ version: 1, policies }),
		registry,
	};
}

async function validateGroupColumnPolicies(
	projectId: string,
	columnPolicies: ReturnType<typeof normalizeUserGroupColumnPolicies>,
	databaseAccess: DatabaseContextAccess,
): Promise<{
	columnPolicies: ReturnType<typeof normalizeUserGroupColumnPolicies>;
	registry: ProjectColumnSecurity;
}> {
	const registry = await userGroupQueries.getProjectColumnSecurity(projectId);
	const registered = new Map(registry.tables.map((table) => [columnSecurityTableKey(table), table]));
	for (const policy of columnPolicies.policies) {
		const table = registered.get(columnSecurityTableKey(policy));
		if (!table) {
			throw new TRPCError({
				code: 'BAD_REQUEST',
				message: 'A column policy references a table outside the project registry.',
			});
		}
		if (!isDatabaseContextTableGranted(databaseAccess, policy)) {
			throw new TRPCError({
				code: 'BAD_REQUEST',
				message: `Column access cannot be granted without access to ${table.schema}.${table.table}.`,
			});
		}
		if (policy.grantedColumns.some((column) => !table.restrictedColumns.includes(column))) {
			throw new TRPCError({
				code: 'BAD_REQUEST',
				message: `Invalid granted column for ${table.schema}.${table.table}.`,
			});
		}
	}
	return { columnPolicies, registry };
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
