import {
	isMicrosoftEntraGroupId,
	MAX_PRELOADED_SKILLS,
	normalizeFileTreePath,
	PROJECT_SHARING_PERMISSIONS,
	ROW_SECURITY_COMBINATORS,
	ROW_SECURITY_MAX_CONDITIONS,
	ROW_SECURITY_MAX_VALUE_LENGTH,
	ROW_SECURITY_OPERATORS,
	stripRowSecurityWhereClause,
	TOOL_CALL_DENSITIES,
	USER_GROUP_FEATURES,
	USER_ROLES,
} from '@nao/shared';
import { z } from 'zod';

export const groupNameSchema = z.string().trim().min(1, 'Group name is required.').max(80, 'Group name is too long.');
export const featureGrantsSchema = z.array(z.enum(USER_GROUP_FEATURES)).max(USER_GROUP_FEATURES.length);
export const toolCallDensityPolicySchema = z.object({
	defaultDensity: z.enum(TOOL_CALL_DENSITIES),
	canChange: z.boolean(),
});
export const projectSharingSchema = z.enum(PROJECT_SHARING_PERMISSIONS);
export const shareTargetsSchema = z
	.object({
		includeOwnGroup: z.boolean(),
		groupIds: z.array(z.string().min(1)).max(10_000),
	})
	.strict();
export const skillNameSchema = z.string().trim().min(1).max(200);
export const preloadedSkillsSchema = z.array(skillNameSchema).max(MAX_PRELOADED_SKILLS);
export const skillsAccessSchema = z.discriminatedUnion('mode', [
	z.object({ mode: z.literal('all') }).strict(),
	z.object({ mode: z.literal('restricted'), skills: z.array(skillNameSchema).max(10_000) }).strict(),
]);
export const contextNameSchema = z.string().trim().min(1).max(255);
export const databaseContextGrantSchema = z.discriminatedUnion('kind', [
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
export const databaseAccessSchema = z.discriminatedUnion('mode', [
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
export const fileTreePathSchema = z
	.string()
	.max(1_024)
	.refine((value) => normalizeFileTreePath(value) !== null, 'Invalid path.')
	.transform((value) => normalizeFileTreePath(value)!);
export const fileTreeGrantSchema = z.discriminatedUnion('kind', [
	z.object({ kind: z.literal('folder'), path: fileTreePathSchema }).strict(),
	z.object({ kind: z.literal('file'), path: fileTreePathSchema }).strict(),
]);
export const fileTreeAccessSchema = z.discriminatedUnion('mode', [
	z.object({ mode: z.literal('all') }).strict(),
	z.object({ mode: z.literal('restricted'), grants: z.array(fileTreeGrantSchema).max(10_000) }).strict(),
]);
export const mcpGrantSchema = z.discriminatedUnion('kind', [
	z.object({ kind: z.literal('server'), server: contextNameSchema }).strict(),
	z.object({ kind: z.literal('tool'), server: contextNameSchema, tool: contextNameSchema }).strict(),
]);
export const mcpAccessSchema = z.discriminatedUnion('mode', [
	z.object({ mode: z.literal('all') }).strict(),
	z.object({ mode: z.literal('restricted'), grants: z.array(mcpGrantSchema).max(10_000) }).strict(),
]);
const ssoIdentifierSchema = z.string().trim().min(1).max(255);
export const ssoMappingsSchema = z
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
export const rowTableIdentitySchema = z.object({
	databaseType: contextNameSchema,
	database: contextNameSchema,
	schema: contextNameSchema,
	table: contextNameSchema,
});
export const projectRowSecuritySchema = z
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
export const projectColumnSecuritySchema = z
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
export const updateProjectColumnSecuritySchema = projectColumnSecuritySchema.extend({
	expectedCurrent: projectColumnSecuritySchema.optional(),
});
export const userGroupColumnPoliciesSchema = z
	.object({
		version: z.literal(1),
		policies: z
			.array(
				rowTableIdentitySchema.extend({ grantedColumns: z.array(contextNameSchema).min(1).max(256) }).strict(),
			)
			.max(10_000),
	})
	.strict();
export const rowSecurityConditionSchema = z
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
export const rowSecuritySqlPredicateSchema = z
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
export const userGroupRowPoliciesSchema = z
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
