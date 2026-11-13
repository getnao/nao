import { createHash } from 'node:crypto';

import {
	type DatabaseContextAccess,
	type DocsContextAccess,
	type FilesContextAccess,
	MAX_PRELOADED_SKILLS,
	type McpAccess,
	normalizeDatabaseContextAccess,
	normalizeFileTreeAccess,
	normalizeFileTreePath,
	normalizeMcpAccess,
	normalizeSkillsAccess,
	normalizeUserGroupRowPolicies,
	PROJECT_SHARING_PERMISSIONS,
	type ProjectSharingPermission,
	ROW_SECURITY_COMBINATORS,
	ROW_SECURITY_MAX_CONDITIONS,
	ROW_SECURITY_MAX_VALUE_LENGTH,
	type SkillsAccess,
	TOOL_CALL_DENSITIES,
	type ToolCallDensityPolicy,
	USER_GROUP_FEATURES,
	type UserGroupFeature,
	type UserGroupRowPolicies,
} from '@nao/shared';
import yaml from 'js-yaml';
import { z } from 'zod';

import { budgetLimitUsdSchema } from '../types/member-budget';

const MAX_GROUPS = 10_000;
const MAX_GRANTS = 10_000;
const MAX_PATTERNS = 200;
const MAX_MEMBERS = 100_000;
const MAX_SHARE_TARGETS = 10_000;
const ROW_SECURITY_VALUE_OPERATORS = [
	'equals',
	'does-not-equal',
	'greater-than',
	'greater-than-or-equal',
	'less-than',
	'less-than-or-equal',
	'is-one-of',
	'is-not-one-of',
] as const;
const groupKeySchema = z
	.string()
	.trim()
	.min(1)
	.max(80)
	.regex(/^[a-z][a-z0-9_-]*$/);
const groupNameSchema = z.string().trim().min(1).max(80);
const contextNameSchema = z.string().trim().min(1).max(255);
const skillNameSchema = z.string().trim().min(1).max(200);
const memberEmailSchema = z.string().trim().toLowerCase().email().max(320);
const featureSchema = z.array(z.enum(USER_GROUP_FEATURES)).max(USER_GROUP_FEATURES.length);
const toolCallDensitySchema = z
	.object({
		default_density: z.enum(TOOL_CALL_DENSITIES),
		can_change: z.boolean(),
	})
	.strict();
const shareTargetsSchema = z
	.object({
		include_own_group: z.boolean(),
		group_keys: z.array(groupKeySchema).max(MAX_SHARE_TARGETS),
	})
	.strict();
const databaseGrantSchema = z.discriminatedUnion('kind', [
	z
		.object({
			kind: z.literal('schema'),
			database_type: contextNameSchema,
			database: contextNameSchema,
			schema: contextNameSchema,
		})
		.strict(),
	z
		.object({
			kind: z.literal('table'),
			database_type: contextNameSchema,
			database: contextNameSchema,
			schema: contextNameSchema,
			table: contextNameSchema,
		})
		.strict(),
]);
const databaseAccessSchema = z.discriminatedUnion('mode', [
	z.object({ mode: z.literal('all'), strict: z.boolean() }).strict(),
	z
		.object({
			mode: z.literal('restricted'),
			strict: z.boolean(),
			grants: z.array(databaseGrantSchema).max(MAX_GRANTS),
			patterns: z.array(z.string().max(255)).max(MAX_PATTERNS),
		})
		.strict(),
]);
const fileTreeGrantSchema = z.discriminatedUnion('kind', [
	z
		.object({
			kind: z.literal('folder'),
			path: z
				.string()
				.refine((value) => normalizeFileTreePath(value) !== null, 'Invalid folder path.')
				.transform((value) => normalizeFileTreePath(value)!),
		})
		.strict(),
	z
		.object({
			kind: z.literal('file'),
			path: z
				.string()
				.refine((value) => normalizeFileTreePath(value) !== null, 'Invalid file path.')
				.transform((value) => normalizeFileTreePath(value)!),
		})
		.strict(),
]);
const fileTreeAccessSchema = z.discriminatedUnion('mode', [
	z.object({ mode: z.literal('all') }).strict(),
	z.object({ mode: z.literal('restricted'), grants: z.array(fileTreeGrantSchema).max(MAX_GRANTS) }).strict(),
]);
const mcpGrantSchema = z.discriminatedUnion('kind', [
	z.object({ kind: z.literal('server'), server: contextNameSchema }).strict(),
	z.object({ kind: z.literal('tool'), server: contextNameSchema, tool: contextNameSchema }).strict(),
]);
const mcpAccessSchema = z.discriminatedUnion('mode', [
	z.object({ mode: z.literal('all') }).strict(),
	z.object({ mode: z.literal('restricted'), grants: z.array(mcpGrantSchema).max(MAX_GRANTS) }).strict(),
]);
const skillsAccessSchema = z.discriminatedUnion('mode', [
	z.object({ mode: z.literal('all') }).strict(),
	z.object({ mode: z.literal('restricted'), skills: z.array(skillNameSchema).max(MAX_GRANTS) }).strict(),
]);
const rowTableIdentityShape = {
	database_type: contextNameSchema,
	database: contextNameSchema,
	schema: contextNameSchema,
	table: contextNameSchema,
};
const rowSecurityValueConditionSchema = z
	.object({
		column: contextNameSchema,
		operator: z.enum(ROW_SECURITY_VALUE_OPERATORS),
		value: z.string().trim().min(1).max(ROW_SECURITY_MAX_VALUE_LENGTH),
	})
	.strict();
const rowSecurityNullConditionSchema = z
	.object({
		column: contextNameSchema,
		operator: z.enum(['is-null', 'is-not-null']),
	})
	.strict();
const rowSecurityConditionSchema = z.union([rowSecurityValueConditionSchema, rowSecurityNullConditionSchema]);
const rowPolicySchema = z.union([
	z.object({ ...rowTableIdentityShape, access: z.literal('full') }).strict(),
	z
		.object({
			...rowTableIdentityShape,
			access: z.literal('predicate'),
			mode: z.literal('guided'),
			combinator: z.enum(ROW_SECURITY_COMBINATORS),
			conditions: z.array(rowSecurityConditionSchema).min(1).max(ROW_SECURITY_MAX_CONDITIONS),
		})
		.strict(),
	z
		.object({
			...rowTableIdentityShape,
			access: z.literal('predicate'),
			mode: z.literal('sql'),
			predicate: z
				.string()
				.trim()
				.min(1)
				.max(ROW_SECURITY_MAX_VALUE_LENGTH)
				.regex(/^where\b/i, 'SQL row policy predicates must start with WHERE.'),
		})
		.strict(),
]);
const rowPoliciesSchema = z
	.object({
		version: z.literal(1),
		policies: z.array(rowPolicySchema).max(MAX_GRANTS),
	})
	.strict();
const settingsShape = {
	features: featureSchema,
	tool_call_density: toolCallDensitySchema,
	show_all_settings: z.boolean(),
	project_sharing: z.enum(PROJECT_SHARING_PERMISSIONS),
	share_targets: shareTargetsSchema,
	preloaded_skills: z.array(skillNameSchema).max(MAX_PRELOADED_SKILLS),
	budget_limit_usd: budgetLimitUsdSchema,
	database_access: databaseAccessSchema,
	docs_access: fileTreeAccessSchema,
	files_access: fileTreeAccessSchema,
	mcp_access: mcpAccessSchema,
	skills_access: skillsAccessSchema,
	row_policies: rowPoliciesSchema,
};
const completeSettingsSchema = z.object(settingsShape).strict();
const settingsOverrideSchema = completeSettingsSchema.partial();
const allUsersSchema = settingsOverrideSchema;
const customGroupSchema = settingsOverrideSchema.extend({
	key: groupKeySchema,
	name: groupNameSchema,
	members: z.array(memberEmailSchema).max(MAX_MEMBERS),
});
const fileSchema = z
	.object({
		version: z.literal(1),
		defaults: completeSettingsSchema,
		all_users: allUsersSchema,
		groups: z.array(customGroupSchema).max(MAX_GROUPS),
	})
	.strict();

type ParsedSettings = z.infer<typeof completeSettingsSchema>;
export interface NormalizedUserGroupSettings {
	features: UserGroupFeature[];
	toolCallDensityPolicy: ToolCallDensityPolicy;
	showAllSettings: boolean;
	projectSharing: ProjectSharingPermission;
	shareTargets: { includeOwnGroup: boolean; groupKeys: string[] };
	preloadedSkills: string[];
	budgetLimitUsd: number | null;
	databaseAccess: DatabaseContextAccess;
	docsAccess: DocsContextAccess;
	filesAccess: FilesContextAccess;
	mcpAccess: McpAccess;
	skillsAccess: SkillsAccess;
	rowPolicies: UserGroupRowPolicies;
}

export interface NormalizedConfiguredUserGroup extends NormalizedUserGroupSettings {
	key: string;
	name: string;
	members: string[];
}

export interface NormalizedUserGroupsConfig {
	version: 1;
	allUsers: NormalizedUserGroupSettings;
	groups: NormalizedConfiguredUserGroup[];
	hash: string;
}

export class UserGroupConfigError extends Error {}

export function parseUserGroupsConfig(source: string, filename = 'user_groups.yaml'): NormalizedUserGroupsConfig {
	let document: unknown;
	try {
		document = yaml.load(source, { filename, schema: yaml.JSON_SCHEMA, json: false });
	} catch (error) {
		throw new UserGroupConfigError(error instanceof Error ? error.message : 'Invalid YAML.');
	}
	const result = fileSchema.safeParse(document);
	if (!result.success) {
		throw new UserGroupConfigError(z.prettifyError(result.error));
	}
	return normalizeUserGroupsConfig(result.data);
}

function normalizeUserGroupsConfig(parsed: z.infer<typeof fileSchema>): NormalizedUserGroupsConfig {
	assertUnique(
		parsed.groups.map((group) => group.key),
		'group key',
	);
	assertUnique(
		parsed.groups.map((group) => group.name.toLocaleLowerCase()),
		'active group name',
	);
	const groupKeys = new Set(parsed.groups.map((group) => group.key));
	const allUsers = normalizeSettings({ ...parsed.defaults, ...parsed.all_users });
	const groups = parsed.groups
		.map((group) => {
			const { key, name, members, ...overrides } = group;
			return {
				key,
				name,
				members: uniqueSorted(members),
				...normalizeSettings({ ...parsed.defaults, ...overrides }),
			};
		})
		.sort((left, right) => left.key.localeCompare(right.key));
	validateShareTargets(allUsers.shareTargets.groupKeys, groupKeys, 'all_users');
	for (const group of groups) {
		validateShareTargets(group.shareTargets.groupKeys, groupKeys, group.key);
	}
	const normalized = { version: 1 as const, allUsers, groups };
	return {
		...normalized,
		hash: createHash('sha256').update(JSON.stringify(normalized)).digest('hex'),
	};
}

function normalizeSettings(settings: ParsedSettings): NormalizedUserGroupSettings {
	return {
		features: uniqueSorted(settings.features),
		toolCallDensityPolicy: {
			defaultDensity: settings.tool_call_density.default_density,
			canChange: settings.tool_call_density.can_change,
		},
		showAllSettings: settings.show_all_settings,
		projectSharing: settings.project_sharing,
		shareTargets: {
			includeOwnGroup: settings.share_targets.include_own_group,
			groupKeys: uniqueSorted(settings.share_targets.group_keys),
		},
		preloadedSkills: uniqueSorted(settings.preloaded_skills),
		budgetLimitUsd: settings.budget_limit_usd,
		databaseAccess: normalizeDatabaseContextAccess(mapDatabaseAccess(settings.database_access)),
		docsAccess: normalizeFileTreeAccess(settings.docs_access),
		filesAccess: normalizeFileTreeAccess(settings.files_access),
		mcpAccess: normalizeMcpAccess(settings.mcp_access),
		skillsAccess: normalizeSkillsAccess(settings.skills_access),
		rowPolicies: normalizeUserGroupRowPolicies(mapRowPolicies(settings.row_policies)),
	};
}

function mapDatabaseAccess(value: z.infer<typeof databaseAccessSchema>): DatabaseContextAccess {
	if (value.mode === 'all') {
		return value;
	}
	return {
		...value,
		grants: value.grants.map((grant) => {
			const { database_type: databaseType, ...rest } = grant;
			return { ...rest, databaseType };
		}),
	};
}

function mapRowPolicies(value: z.infer<typeof rowPoliciesSchema>): UserGroupRowPolicies {
	return {
		version: 1,
		policies: value.policies.map((policy) => {
			const { database_type: databaseType, ...rest } = policy;
			return { ...rest, databaseType };
		}) as UserGroupRowPolicies['policies'],
	};
}

function validateShareTargets(targets: string[], groupKeys: ReadonlySet<string>, owner: string): void {
	for (const target of targets) {
		if (!groupKeys.has(target)) {
			throw new UserGroupConfigError(`${owner} references unknown share target group key "${target}".`);
		}
		if (target === owner) {
			throw new UserGroupConfigError(`${owner} cannot include itself in share_targets.group_keys.`);
		}
	}
}

function assertUnique(values: string[], label: string): void {
	const seen = new Set<string>();
	for (const value of values) {
		if (seen.has(value)) {
			throw new UserGroupConfigError(`Duplicate ${label}: "${value}".`);
		}
		seen.add(value);
	}
}

function uniqueSorted<T extends string>(values: readonly T[]): T[] {
	return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}
