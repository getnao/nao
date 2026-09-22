import {
	compileRowSecurityConditions,
	DEFAULT_TOOL_CALL_DENSITY_POLICY,
	EMPTY_DATABASE_CONTEXT_ACCESS,
	EMPTY_DOCS_CONTEXT_ACCESS,
	FREE_CUSTOM_USER_GROUP_LIMIT,
	isMicrosoftEntraGroupId,
	normalizeDatabaseContextAccess,
	normalizeDocsContextAccess,
	normalizeDocsContextPath,
	normalizeProjectRowSecurity,
	normalizeUserGroupRowPolicies,
	normalizeUserGroupSsoMappings,
	type ProjectRowSecurity,
	ROW_SECURITY_COMBINATORS,
	ROW_SECURITY_MAX_CONDITIONS,
	ROW_SECURITY_MAX_VALUE_LENGTH,
	ROW_SECURITY_OPERATORS,
	rowSecurityTableKey,
	stripRowSecurityWhereClause,
	TOOL_CALL_DENSITIES,
	USER_GROUP_FEATURES,
	USER_ROLES,
	type UserGroupRowPolicies,
} from '@nao/shared';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { getDatabaseContextCatalog } from '../agents/user-rules';
import { env } from '../env';
import * as projectQueries from '../queries/project.queries';
import * as userGroupQueries from '../queries/user-group.queries';
import { getDocsContextCatalog } from '../services/docs-context-catalog.service';
import { hasFeature, LICENSE_FEATURES } from '../services/license.service';
import {
	listEffectiveEntraUserGroupMappings,
	listEffectiveOidcUserGroupMappings,
} from '../services/sso-user-group-mapping.service';
import { assertUserGroupManageable, getAvailableUserGroupOverview } from '../services/user-group-availability.service';
import {
	getEffectiveUserGroupAccess,
	getEffectiveUserGroupAccessForUserDetail,
} from '../services/user-group-feature-access.service';
import { validateWarehouseRowPredicate } from '../services/warehouse-sql.service';
import { parseEntraGroupNaoGroupMapping, parseOidcGroupNaoGroupMapping } from '../utils/sso-group-mapping';
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

export const userGroupRoutes = {
	effectiveAccess: projectProtectedProcedure.query(async ({ ctx }) => {
		return getEffectiveUserGroupAccess(ctx.project.id, ctx.user.id);
	}),

	effectiveAccessForUser: adminProtectedProcedure
		.input(z.object({ userId: z.string().min(1) }))
		.query(async ({ ctx, input }) => {
			if (!(await projectQueries.getUserRoleInProject(ctx.project.id, input.userId))) {
				throw new TRPCError({
					code: 'NOT_FOUND',
					message: 'This user does not have access to the project.',
				});
			}
			return getEffectiveUserGroupAccessForUserDetail(ctx.project.id, input.userId);
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

	rowSecurity: adminProtectedProcedure.query(async ({ ctx }) => {
		return handleQuery(() => userGroupQueries.getProjectRowSecurity(ctx.project.id));
	}),

	updateRowSecurity: adminProtectedProcedure.input(projectRowSecuritySchema).mutation(async ({ ctx, input }) => {
		const rowSecurity = normalizeProjectRowSecurity(input);
		await assertRowSecurityChangeAllowed(ctx.project.id, rowSecurity);
		await validateProjectRowSecurityCatalog(requireProjectPath(ctx.project.path), rowSecurity);
		return handleQuery(() => userGroupQueries.updateProjectRowSecurity(ctx.project.id, rowSecurity));
	}),

	docsContextCatalog: adminProtectedProcedure.query(async ({ ctx }) => {
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
				ssoMappings: ssoMappingsSchema.optional(),
				rowPolicies: userGroupRowPoliciesSchema.optional(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const databaseAccess = normalizeDatabaseContextAccess(input.databaseAccess);
			const docsAccess = normalizeDocsContextAccess(input.docsAccess);
			let rowPolicies: UserGroupRowPolicies | undefined;
			if (input.rowPolicies !== undefined) {
				await assertRowSecurityLicensed();
				const validation = await validateGroupRowPolicies(
					ctx.project.id,
					normalizeUserGroupRowPolicies(input.rowPolicies),
				);
				rowPolicies = validation.rowPolicies;
			}
			const createUserGroup = (await hasFeature(LICENSE_FEATURES.userGroups))
				? userGroupQueries.createUserGroup
				: userGroupQueries.createUserGroupWithinLimit.bind(null, FREE_CUSTOM_USER_GROUP_LIMIT);
			return handleQuery(() => {
				const values = [
					ctx.project.id,
					input.name,
					unique(input.featureGrants),
					input.toolCallDensityPolicy,
					databaseAccess,
					docsAccess,
				] as const;
				if (rowPolicies !== undefined) {
					return createUserGroup(
						...values,
						input.ssoMappings === undefined ? undefined : normalizeUserGroupSsoMappings(input.ssoMappings),
						rowPolicies,
					);
				}
				return input.ssoMappings === undefined
					? createUserGroup(...values)
					: createUserGroup(...values, normalizeUserGroupSsoMappings(input.ssoMappings));
			});
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
				ssoMappings: ssoMappingsSchema.optional(),
				rowPolicies: userGroupRowPoliciesSchema.optional(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			await handleQuery(() => assertUserGroupManageable(ctx.project.id, input.groupId));
			const databaseAccess =
				input.databaseAccess === undefined ? undefined : normalizeDatabaseContextAccess(input.databaseAccess);
			const docsAccess =
				input.docsAccess === undefined ? undefined : normalizeDocsContextAccess(input.docsAccess);
			let rowPolicies: UserGroupRowPolicies | undefined;
			let rowPoliciesRegistry: ProjectRowSecurity | undefined;
			if (input.rowPolicies !== undefined) {
				await assertRowSecurityLicensed();
				const validation = await validateGroupRowPolicies(
					ctx.project.id,
					normalizeUserGroupRowPolicies(input.rowPolicies),
				);
				rowPolicies = validation.rowPolicies;
				rowPoliciesRegistry = validation.registry;
			}
			return handleQuery(() =>
				userGroupQueries.updateUserGroup(ctx.project.id, input.groupId, {
					name: input.name,
					featureGrants: unique(input.featureGrants),
					toolCallDensityPolicy: input.toolCallDensityPolicy,
					...(databaseAccess === undefined ? {} : { databaseAccess }),
					...(docsAccess === undefined ? {} : { docsAccess }),
					...(input.ssoMappings === undefined
						? {}
						: { ssoMappings: normalizeUserGroupSsoMappings(input.ssoMappings) }),
					...(rowPolicies === undefined ? {} : { rowPolicies, rowPoliciesRegistry }),
				}),
			);
		}),

	delete: adminProtectedProcedure.input(z.object({ groupId: z.string().min(1) })).mutation(async ({ ctx, input }) => {
		await handleQuery(() => assertUserGroupManageable(ctx.project.id, input.groupId));
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
			await handleQuery(() => assertUserGroupManageable(ctx.project.id, input.groupId));
			return handleQuery(() =>
				userGroupQueries.setUserGroupMembership(ctx.project.id, input.groupId, input.userId, input.isMember),
			);
		}),
};

async function assertRowSecurityLicensed(): Promise<void> {
	if (!(await hasFeature(LICENSE_FEATURES.rowLevelSecurity))) {
		throw new TRPCError({ code: 'FORBIDDEN', message: 'Row-level security requires an Enterprise license.' });
	}
}

async function assertRowSecurityChangeAllowed(projectId: string, rowSecurity: ProjectRowSecurity): Promise<void> {
	if (await hasFeature(LICENSE_FEATURES.rowLevelSecurity)) {
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
				message: `Invalid constraint column for ${table.schema}.${table.table}.`,
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
					message: `Invalid constraint column for ${table.schema}.${table.table}.`,
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
