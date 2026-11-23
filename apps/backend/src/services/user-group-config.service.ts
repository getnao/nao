import { createHash } from 'node:crypto';

import {
	type DatabaseContextAccess,
	DEFAULT_USER_GROUP_NAME,
	type DocsContextAccess,
	type FilesContextAccess,
	type FileTreeGrant,
	isMicrosoftEntraGroupId,
	MAX_PRELOADED_SKILLS,
	type McpAccess,
	normalizeDatabaseContextAccess,
	normalizeFileTreeAccess,
	normalizeFileTreePath,
	normalizeMcpAccess,
	normalizeSkillsAccess,
	normalizeUserGroupRowPolicies,
	normalizeUserGroupSsoMappings,
	PROJECT_SHARING_PERMISSIONS,
	type ProjectSharingPermission,
	ROW_SECURITY_COMBINATORS,
	ROW_SECURITY_MAX_CONDITIONS,
	ROW_SECURITY_MAX_VALUE_LENGTH,
	ROW_SECURITY_OPERATORS,
	type RowSecurityOperator,
	type SkillsAccess,
	TOOL_CALL_DENSITIES,
	type ToolCallDensityPolicy,
	USER_GROUP_FEATURES,
	USER_ROLES,
	type UserGroupFeature,
	type UserGroupRowPolicies,
	type UserGroupSsoMappings,
} from '@nao/shared';
import yaml from 'js-yaml';
import { z } from 'zod';

export const USER_GROUPS_CONFIG_FILENAME = 'groups.yaml';
export const DEFAULT_GROUP_ID = 'default';
export const ALL_USERS_GROUP_ID = 'all_users';
export const DOCS_ROOT = 'docs';

const MAX_GROUPS = 10_000;
const MAX_GRANTS = 10_000;
const MAX_PATTERNS = 200;
const MAX_MEMBERS = 100_000;
const MAX_SSO_GROUPS = 200;
const LIST_OPERATORS = ['is-one-of', 'is-not-one-of'] as const satisfies RowSecurityOperator[];
const NULL_OPERATORS = ['is-null', 'is-not-null'] as const satisfies RowSecurityOperator[];
const VALUE_OPERATORS = ROW_SECURITY_OPERATORS.filter(
	(operator) =>
		!(LIST_OPERATORS as readonly string[]).includes(operator) &&
		!(NULL_OPERATORS as readonly string[]).includes(operator),
);

export const FEATURE_IDS = new Map(USER_GROUP_FEATURES.map((feature) => [toSnakeCase(feature), feature]));
export const ROW_OPERATOR_IDS = new Map(ROW_SECURITY_OPERATORS.map((operator) => [toSnakeCase(operator), operator]));

const groupIdSchema = z
	.string()
	.trim()
	.min(1)
	.max(80)
	.regex(/^[a-z][a-z0-9_]*$/, 'Group ids must be snake_case, like finance_team.');
const contextNameSchema = z.string().trim().min(1).max(255);
const skillNameSchema = z.string().trim().min(1).max(200);
const memberEmailSchema = z.string().trim().toLowerCase().email().max(320);
const filePathSchema = z
	.string()
	.refine((value) => normalizeFileTreePath(value) !== null, 'Invalid path.')
	.transform((value) => normalizeFileTreePath(value)!);
const rowValueSchema = z
	.union([z.string(), z.number()])
	.transform(String)
	.pipe(z.string().trim().min(1).max(ROW_SECURITY_MAX_VALUE_LENGTH));

const capabilitiesSchema = z
	.object({
		features: z.array(z.enum([...FEATURE_IDS.keys()] as [string, ...string[]])).max(USER_GROUP_FEATURES.length),
		tool_call_density: z
			.object({
				default_density: z.enum(TOOL_CALL_DENSITIES).default('detailed'),
				can_change: z.boolean().default(true),
			})
			.strict(),
		show_all_settings: z.boolean(),
		advanced_context_explorer: z.boolean(),
		project_sharing: z.enum(PROJECT_SHARING_PERMISSIONS),
		share_targets: z
			.object({
				include_own_group: z.boolean().default(true),
				group_ids: z.array(groupIdSchema).max(MAX_GROUPS).default([]),
			})
			.strict(),
		mcp: z.discriminatedUnion('mode', [
			z.object({ mode: z.literal('all') }).strict(),
			z
				.object({
					mode: z.literal('restricted'),
					grants: z
						.array(
							z.discriminatedUnion('kind', [
								z.object({ kind: z.literal('server'), server: contextNameSchema }).strict(),
								z
									.object({
										kind: z.literal('tool'),
										server: contextNameSchema,
										tool: contextNameSchema,
									})
									.strict(),
							]),
						)
						.max(MAX_GRANTS)
						.default([]),
				})
				.strict(),
		]),
		skills: z.discriminatedUnion('mode', [
			z
				.object({
					mode: z.literal('all'),
					preloaded: z.array(skillNameSchema).max(MAX_PRELOADED_SKILLS).default([]),
				})
				.strict(),
			z
				.object({
					mode: z.literal('restricted'),
					allowed: z.array(skillNameSchema).max(MAX_GRANTS).default([]),
					preloaded: z.array(skillNameSchema).max(MAX_PRELOADED_SKILLS).default([]),
				})
				.strict(),
		]),
	})
	.strict()
	.partial();

const tableIdentityShape = {
	database_type: contextNameSchema,
	database: contextNameSchema,
	schema: contextNameSchema,
	table: contextNameSchema,
};

const accessSchema = z
	.object({
		databases: z.discriminatedUnion('mode', [
			z.object({ mode: z.literal('all'), strict: z.boolean().default(false) }).strict(),
			z
				.object({
					mode: z.literal('restricted'),
					strict: z.boolean().default(false),
					grants: z
						.array(
							z.discriminatedUnion('kind', [
								z
									.object({
										kind: z.literal('schema'),
										database_type: contextNameSchema,
										database: contextNameSchema,
										schema: contextNameSchema,
									})
									.strict(),
								z.object({ kind: z.literal('table'), ...tableIdentityShape }).strict(),
							]),
						)
						.max(MAX_GRANTS)
						.default([]),
					patterns: z.array(z.string().max(255)).max(MAX_PATTERNS).default([]),
				})
				.strict(),
		]),
		files: z.discriminatedUnion('mode', [
			z.object({ mode: z.literal('all') }).strict(),
			z
				.object({
					mode: z.literal('restricted'),
					grants: z
						.array(z.object({ kind: z.enum(['folder', 'file']), path: filePathSchema }).strict())
						.max(MAX_GRANTS)
						.default([]),
				})
				.strict(),
		]),
	})
	.strict()
	.partial();

const rowConditionSchema = z.discriminatedUnion('operator', [
	z
		.object({ column: contextNameSchema, operator: z.enum(snakeCaseAll(VALUE_OPERATORS)), value: rowValueSchema })
		.strict(),
	z
		.object({
			column: contextNameSchema,
			operator: z.enum(snakeCaseAll(LIST_OPERATORS)),
			values: z
				.array(rowValueSchema.refine((value) => !value.includes(','), 'List values cannot contain commas.'))
				.min(1),
		})
		.strict(),
	z.object({ column: contextNameSchema, operator: z.enum(snakeCaseAll(NULL_OPERATORS)) }).strict(),
]);

const rowPolicySchema = z.discriminatedUnion('access', [
	z.object({ ...tableIdentityShape, access: z.literal('full') }).strict(),
	z.discriminatedUnion('mode', [
		z
			.object({
				...tableIdentityShape,
				access: z.literal('predicate'),
				mode: z.literal('guided'),
				combinator: z.enum(ROW_SECURITY_COMBINATORS).default('and'),
				conditions: z.array(rowConditionSchema).min(1).max(ROW_SECURITY_MAX_CONDITIONS),
			})
			.strict(),
		z
			.object({
				...tableIdentityShape,
				access: z.literal('predicate'),
				mode: z.literal('sql'),
				predicate: z
					.string()
					.trim()
					.max(ROW_SECURITY_MAX_VALUE_LENGTH)
					.regex(/^where\s+\S/i, 'SQL row policy predicates must start with WHERE followed by a condition.'),
			})
			.strict(),
	]),
]);

const policiesSchema = z
	.object({
		rows: z.array(rowPolicySchema).max(MAX_GRANTS),
		columns: z.array(z.unknown()).max(0, 'Column policies are not supported yet. Leave the list empty.'),
	})
	.strict()
	.partial();

const ssoGroupsSchema = z
	.object({
		oidc: z.array(z.string().trim().min(1).max(255)).max(MAX_SSO_GROUPS).default([]),
		microsoft: z
			.array(z.string().trim().refine(isMicrosoftEntraGroupId, 'Invalid Microsoft Entra group object ID.'))
			.max(MAX_SSO_GROUPS)
			.default([]),
		default_project_role: z.enum(USER_ROLES).optional(),
	})
	.strict();

const groupEntrySchema = z
	.object({
		id: groupIdSchema,
		name: z.string().trim().min(1).max(80).optional(),
		list_of_emails: z.array(memberEmailSchema).max(MAX_MEMBERS).optional(),
		sso_groups: ssoGroupsSchema.optional(),
		capabilities: capabilitiesSchema.optional(),
		access: accessSchema.optional(),
		policies: policiesSchema.optional(),
	})
	.strict();

const reservedSectionSchema = z.record(z.string(), z.unknown()).nullable().optional();

const fileSchema = z
	.object({
		groups: z.array(groupEntrySchema).max(MAX_GROUPS),
		protected_tables: reservedSectionSchema,
		budget: reservedSectionSchema,
	})
	.strict();

type GroupEntry = z.infer<typeof groupEntrySchema>;
type Capabilities = Required<z.infer<typeof capabilitiesSchema>>;
type Access = Required<z.infer<typeof accessSchema>>;
type Policies = Required<z.infer<typeof policiesSchema>>;
type ResolvedSettings = { capabilities: Capabilities; access: Access; policies: Policies };

export const HIDDEN_DEFAULTS: ResolvedSettings = {
	capabilities: {
		features: [],
		tool_call_density: { default_density: 'detailed', can_change: true },
		show_all_settings: false,
		advanced_context_explorer: false,
		project_sharing: 'inherit',
		share_targets: { include_own_group: true, group_ids: [] },
		mcp: { mode: 'restricted', grants: [] },
		skills: { mode: 'restricted', allowed: [], preloaded: [] },
	},
	access: {
		databases: { mode: 'restricted', strict: false, grants: [], patterns: [] },
		files: { mode: 'restricted', grants: [] },
	},
	policies: { rows: [], columns: [] },
};

export interface NormalizedUserGroupSettings {
	features: UserGroupFeature[];
	toolCallDensityPolicy: ToolCallDensityPolicy;
	showAllSettings: boolean;
	advancedContextExplorer: boolean;
	projectSharing: ProjectSharingPermission;
	shareTargets: { includeOwnGroup: boolean; groupKeys: string[] };
	preloadedSkills: string[];
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
	ssoMappings: UserGroupSsoMappings;
}

export interface NormalizedUserGroupsConfig {
	allUsers: NormalizedUserGroupSettings;
	groups: NormalizedConfiguredUserGroup[];
	hash: string;
}

export type ResolvedUserGroupEntry = ResolvedSettings & {
	id: string;
	name?: string;
	list_of_emails?: string[];
	sso_groups?: GroupEntry['sso_groups'];
};

export class UserGroupConfigError extends Error {}

export function parseUserGroupsConfig(
	source: string,
	filename = USER_GROUPS_CONFIG_FILENAME,
): NormalizedUserGroupsConfig {
	return normalizeUserGroupsConfig(parseGroupEntries(source, filename));
}

/** Every group except `default`, in the file's own shape, with inheritance resolved. */
export function resolveUserGroupsConfig(
	source: string,
	filename = USER_GROUPS_CONFIG_FILENAME,
): ResolvedUserGroupEntry[] {
	const entries = parseGroupEntries(source, filename);
	normalizeUserGroupsConfig(entries);
	const defaults = entries.find((entry) => entry.id === DEFAULT_GROUP_ID);
	return entries
		.filter((entry) => entry !== defaults)
		.map((entry) => ({
			id: entry.id,
			...(entry.id === ALL_USERS_GROUP_ID
				? {}
				: {
						name: entry.name ?? entry.id,
						list_of_emails: entry.list_of_emails ?? [],
						sso_groups: entry.sso_groups ?? { oidc: [], microsoft: [] },
					}),
			...resolveSettings(entry, defaults),
		}));
}

function parseGroupEntries(source: string, filename: string): GroupEntry[] {
	let document: unknown;
	try {
		document = yaml.load(source, { filename, schema: yaml.JSON_SCHEMA, json: false });
	} catch (error) {
		throw new UserGroupConfigError(error instanceof Error ? error.message : 'Invalid YAML.');
	}
	const result = fileSchema.safeParse(document);
	if (!result.success) {
		throw new UserGroupConfigError(formatSchemaIssues(result.error, document));
	}
	return result.data.groups;
}

/** Names groups by id rather than by their position in the list. */
function formatSchemaIssues(error: z.ZodError, document: unknown): string {
	const groups = (document as { groups?: unknown } | null)?.groups;
	return error.issues
		.map((issue) => {
			const [section, index, ...rest] = issue.path;
			const id =
				section === 'groups' && Array.isArray(groups) && typeof index === 'number'
					? (groups[index] as { id?: unknown } | null)?.id
					: undefined;
			const location = typeof id === 'string' ? `"${id}": ${rest.join('.')}` : issue.path.join('.');
			return location ? `${location}: ${issue.message}` : issue.message;
		})
		.join('\n');
}

function normalizeUserGroupsConfig(entries: GroupEntry[]): NormalizedUserGroupsConfig {
	const issues: string[] = [];
	const seen = new Set<string>();
	for (const entry of entries) {
		if (seen.has(entry.id)) {
			issues.push(`Duplicate group id "${entry.id}".`);
		}
		seen.add(entry.id);
	}
	const defaults = entries.find((entry) => entry.id === DEFAULT_GROUP_ID);
	const allUsers = entries.find((entry) => entry.id === ALL_USERS_GROUP_ID);
	if (!allUsers) {
		issues.push(`The "${ALL_USERS_GROUP_ID}" group is required.`);
	}
	for (const reserved of [defaults, allUsers]) {
		if (
			reserved &&
			[reserved.name, reserved.list_of_emails, reserved.sso_groups].some((value) => value !== undefined)
		) {
			issues.push(`"${reserved.id}" cannot declare name, list_of_emails or sso_groups.`);
		}
	}
	const customEntries = entries.filter((entry) => entry !== defaults && entry !== allUsers);
	issues.push(...findDuplicateNames(customEntries));
	const customIds = new Set(customEntries.map((entry) => entry.id));
	const resolve = (entry: GroupEntry | undefined) => {
		const settings = resolveSettings(entry, defaults);
		issues.push(...validateResolvedSettings(entry?.id ?? ALL_USERS_GROUP_ID, settings, customIds));
		return settings;
	};
	const allUsersSettings = resolve(allUsers);
	const groups = customEntries
		.map((entry) => ({
			key: entry.id,
			name: entry.name ?? entry.id,
			members: uniqueSorted(entry.list_of_emails ?? []),
			ssoMappings: toSsoMappings(entry.sso_groups),
			...toNormalizedSettings(resolve(entry)),
		}))
		.sort((left, right) => left.key.localeCompare(right.key));
	if (issues.length > 0) {
		throw new UserGroupConfigError(issues.join('\n'));
	}
	const normalized = { allUsers: toNormalizedSettings(allUsersSettings), groups };
	return { ...normalized, hash: createHash('sha256').update(JSON.stringify(normalized)).digest('hex') };
}

/** Names are unique per project, and the All Users group keeps its own. */
function findDuplicateNames(entries: GroupEntry[]): string[] {
	const ownerByName = new Map([[DEFAULT_USER_GROUP_NAME, ALL_USERS_GROUP_ID]]);
	return entries.flatMap((entry) => {
		const name = entry.name ?? entry.id;
		const owner = ownerByName.get(name);
		ownerByName.set(name, entry.id);
		return owner ? [`"${entry.id}": name "${name}" is already used by "${owner}".`] : [];
	});
}

/** Each leaf (a key of `capabilities`, `access` or `policies`) replaces the inherited value as a whole. */
function resolveSettings(entry: GroupEntry | undefined, defaults: GroupEntry | undefined): ResolvedSettings {
	return {
		capabilities: { ...HIDDEN_DEFAULTS.capabilities, ...defaults?.capabilities, ...entry?.capabilities },
		access: { ...HIDDEN_DEFAULTS.access, ...defaults?.access, ...entry?.access },
		policies: { ...HIDDEN_DEFAULTS.policies, ...defaults?.policies, ...entry?.policies },
	};
}

function validateResolvedSettings(id: string, settings: ResolvedSettings, customIds: ReadonlySet<string>): string[] {
	const issues: string[] = [];
	for (const target of settings.capabilities.share_targets.group_ids) {
		if (target === id) {
			issues.push(`"${id}": capabilities.share_targets.group_ids cannot include the group itself.`);
		} else if (!customIds.has(target)) {
			issues.push(`"${id}": capabilities.share_targets.group_ids references unknown group "${target}".`);
		}
	}
	const skills = settings.capabilities.skills;
	if (skills.mode === 'restricted') {
		const allowed = new Set(skills.allowed);
		for (const skill of skills.preloaded.filter((name) => !allowed.has(name))) {
			issues.push(`"${id}": preloaded skill "${skill}" must also be in capabilities.skills.allowed.`);
		}
	}
	if (settings.access.files.mode === 'restricted') {
		for (const grant of settings.access.files.grants) {
			if (grant.path === 'databases' || grant.path.startsWith('databases/')) {
				issues.push(`"${id}": grant databases through access.databases, not access.files (${grant.path}).`);
			}
		}
	}
	return issues;
}

function toNormalizedSettings({ capabilities, access, policies }: ResolvedSettings): NormalizedUserGroupSettings {
	const skills = capabilities.skills;
	return {
		features: uniqueSorted(capabilities.features.map((feature) => FEATURE_IDS.get(feature)!)),
		toolCallDensityPolicy: {
			defaultDensity: capabilities.tool_call_density.default_density,
			canChange: capabilities.tool_call_density.can_change,
		},
		showAllSettings: capabilities.show_all_settings,
		advancedContextExplorer: capabilities.advanced_context_explorer,
		projectSharing: capabilities.project_sharing,
		shareTargets: {
			includeOwnGroup: capabilities.share_targets.include_own_group,
			groupKeys: uniqueSorted(capabilities.share_targets.group_ids),
		},
		preloadedSkills: uniqueSorted(skills.preloaded),
		databaseAccess: normalizeDatabaseContextAccess(toDatabaseAccess(access.databases)),
		...splitFileAccess(access.files),
		mcpAccess: normalizeMcpAccess(capabilities.mcp),
		skillsAccess: normalizeSkillsAccess(
			skills.mode === 'all' ? { mode: 'all' } : { mode: 'restricted', skills: skills.allowed },
		),
		rowPolicies: normalizeUserGroupRowPolicies(toRowPolicies(policies.rows)),
	};
}

function toDatabaseAccess(access: Access['databases']): DatabaseContextAccess {
	if (access.mode === 'all') {
		return access;
	}
	return {
		...access,
		grants: access.grants.map(({ database_type: databaseType, ...grant }) => ({ ...grant, databaseType })),
	};
}

/** `access.files` covers docs too: `docs/...` paths become docs grants and a `docs` folder grant opens every doc. */
function splitFileAccess(access: Access['files']): { docsAccess: DocsContextAccess; filesAccess: FilesContextAccess } {
	if (access.mode === 'all') {
		return { docsAccess: { mode: 'all' }, filesAccess: { mode: 'all' } };
	}
	const docsGrants: FileTreeGrant[] = [];
	const fileGrants: FileTreeGrant[] = [];
	let allDocs = false;
	for (const grant of access.grants) {
		if (grant.kind === 'folder' && grant.path === DOCS_ROOT) {
			allDocs = true;
		} else if (grant.path.startsWith(`${DOCS_ROOT}/`)) {
			docsGrants.push({ kind: grant.kind, path: grant.path.slice(DOCS_ROOT.length + 1) });
		} else {
			fileGrants.push(grant);
		}
	}
	return {
		docsAccess: allDocs ? { mode: 'all' } : normalizeFileTreeAccess({ mode: 'restricted', grants: docsGrants }),
		filesAccess: normalizeFileTreeAccess({ mode: 'restricted', grants: fileGrants }),
	};
}

function toRowPolicies(rows: Policies['rows']): UserGroupRowPolicies {
	return {
		version: 1,
		policies: rows.map((row) => {
			const { database_type: databaseType, ...policy } = row;
			if (policy.access === 'full' || policy.mode === 'sql') {
				return { ...policy, databaseType };
			}
			return {
				...policy,
				databaseType,
				conditions: policy.conditions.map((condition) => ({
					column: condition.column,
					operator: ROW_OPERATOR_IDS.get(condition.operator)!,
					...('value' in condition ? { value: condition.value } : {}),
					...('values' in condition ? { value: condition.values.join(',') } : {}),
				})),
			};
		}),
	};
}

function toSsoMappings(ssoGroups: GroupEntry['sso_groups']): UserGroupSsoMappings {
	return normalizeUserGroupSsoMappings({
		version: 1,
		providers: { oidc: ssoGroups?.oidc ?? [], microsoft: ssoGroups?.microsoft ?? [] },
		defaultProjectRole: ssoGroups?.default_project_role ?? null,
	});
}

export function toSnakeCase(value: string): string {
	return value.replaceAll('-', '_').replaceAll(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
}

function snakeCaseAll<T extends string>(values: readonly T[]): [string, ...string[]] {
	return values.map(toSnakeCase) as [string, ...string[]];
}

function uniqueSorted<T extends string>(values: readonly T[]): T[] {
	return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}
