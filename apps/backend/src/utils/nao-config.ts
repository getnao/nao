import fs from 'node:fs';
import path from 'node:path';

import { DEFAULT_RULES_FILE } from '@nao/shared/rules-template';
import {
	DEFAULT_SQL_QUERY_TAG_POSITION,
	isSqlQueryTagPosition,
	SQL_QUERY_TAG_TEMPLATE_MAX_LENGTH,
	type SqlQueryTagConfig,
} from '@nao/shared/sql-query-tag';
import { isLlmProvider, type LlmSelectedModel, type RepoProvider } from '@nao/shared/types';
import yaml from 'js-yaml';
import { z } from 'zod/v4';

import { getModelReasoningEfforts } from '../agents/provider-meta';
import { parseGithubRemoteRepoFullName } from '../services/github';
import { gitlabBaseUrl } from '../services/gitlab';
import type { LinkedContextRepo, RepoTarget } from '../types/context-recommendation';
import type { ActiveEffort } from '../types/llm';
import {
	type ConfiguredTestSettings,
	DEFAULT_TEST_COMPARISON_TOLERANCES,
	testComparisonTolerancesSchema,
	type TestModelSelection,
	type TestScheduleSettings,
} from '../types/test-run';
import { getTestScheduleCronError } from './cron';
import { getDeploymentEnvVar } from './deployment-env';
import { logger } from './logger';
import { resolveSecrets } from './nao-config-llm';
import { resolveFileReferences, resolveProjectFile } from './nao-config-references';
import { escapeRegExp } from './utils';

const DATABASE_TEMPLATES = ['columns', 'preview', 'profiling', 'query_history', 'ai_summary'] as const;
const DEFAULT_DATABASE_TEMPLATES = ['columns', 'preview'] as const;

export type ContextPresence = {
	rules: boolean;
	/** Project-relative path of the rules file, `RULES.md` unless nao_config.yaml sets `rules_file`. */
	rulesFile?: string;
	semantics: boolean;
	docs: boolean;
	notionDocs: boolean;
	databases: boolean;
};
/** Accepts the same spacing as the CLI, which resolves a reference left unfilled here to an empty string. */
const NAO_CONFIG_ENV_PATTERN = /\$?\{\{\s*env\(\s*['"]([^'"]+)['"]\s*\)\s*\}\}/g;
const MCP_CONFIG_ENV_PATTERN = /\$\{(\w+)\}/g;
const TEST_MODEL_FORMAT = "'provider:model_id'";
const TEST_MODEL_OBJECT_FORMAT = "{ model: 'provider:model_id', reasoning_efforts: [low, high] or all }";
const DATABASE_IDENTIFYING_FIELDS = ['database', 'project_id', 'dataset_id', 'catalog'] as const;
/** Top folders a repository target cannot write into, as other parts of `nao sync` replace them. */
const RESERVED_TARGET_FOLDERS = ['repos', 'databases'];

type DatabaseIdentifyingField = (typeof DATABASE_IDENTIFYING_FIELDS)[number];

export type ConfiguredDatabase = {
	id: string;
	type?: string;
} & Partial<Record<DatabaseIdentifyingField, string>>;

export type ConfiguredSemanticLayer = {
	type: string;
	manifestPath: string;
	database: string | null;
};

export function extractRequiredEnvVars(projectFolder: string): string[] {
	const configPath = path.join(projectFolder, 'nao_config.yaml');
	const mcpConfigPath = path.join(projectFolder, 'agent', 'mcps', 'mcp.json');
	const vars = new Set<string>();

	addEnvVarsFromFile(configPath, NAO_CONFIG_ENV_PATTERN, vars);
	addEnvVarsFromFile(mcpConfigPath, MCP_CONFIG_ENV_PATTERN, vars);

	return [...vars];
}

function addEnvVarsFromFile(filePath: string, pattern: RegExp, vars: Set<string>) {
	if (!fs.existsSync(filePath)) {
		return;
	}

	let content: string;
	try {
		content = fs.readFileSync(filePath, 'utf-8');
	} catch (err) {
		logger.warn(`Failed to read ${filePath}: ${err instanceof Error ? err.message : String(err)}`, {
			source: 'system',
		});
		return;
	}

	for (const match of content.matchAll(pattern)) {
		vars.add(match[1]);
	}
}

/**
 * Repository URLs written with `{{ env('NAME') }}` are resolved only when project variables are given, for server-side
 * use: a resolved URL may hold secrets, so the URLs shown to users stay as written.
 */
export function extractConfiguredRepos(projectFolder: string, envVars?: Record<string, string>): LinkedContextRepo[] {
	return configuredReposFrom(loadProjectConfig(projectFolder), envVars);
}

/** The context folders `nao sync` writes for the repositories' targets, such as `tests/analytics`. */
export function extractRepoTargetFolders(projectFolder: string): string[] {
	return extractConfiguredRepos(projectFolder).flatMap((repo) => repo.targets.map((target) => target.target));
}

/** Returns configured database templates, falling back to the default when unavailable. */
export function extractConfiguredTemplates(projectFolder: string): string[] {
	return configuredTemplatesFrom(loadProjectConfig(projectFolder));
}

export function readProjectContext(projectFolder: string): {
	repos: LinkedContextRepo[];
	templates: string[];
	presence: ContextPresence;
} {
	const config = loadProjectConfig(projectFolder);
	return {
		repos: configuredReposFrom(config),
		templates: configuredTemplatesFrom(config),
		presence: extractContextPresence(projectFolder),
	};
}

/** Returns which filesystem-backed project context is available to read. */
export function extractContextPresence(projectFolder: string): ContextPresence {
	const rulesFile = extractRulesFile(projectFolder);
	return {
		rules: fs.existsSync(path.join(projectFolder, rulesFile)),
		rulesFile,
		semantics: hasDirectoryContent(path.join(projectFolder, 'semantics')),
		docs: hasDirectoryContent(path.join(projectFolder, 'docs')),
		notionDocs: hasDirectoryContent(path.join(projectFolder, 'docs', 'notion')),
		databases: hasDirectoryContent(path.join(projectFolder, 'databases')),
	};
}

/**
 * The rules file `rules_file` names, such as one of a synced repository: `repos/business_context/nao/RULES.md`.
 * It falls back to RULES.md while that file is missing, before its repository is synced, or when it is refused.
 */
export function extractRulesFile(projectFolder: string): string {
	const config = loadProjectConfig(projectFolder);
	const rulesFile = isRecord(config) ? config.rules_file : undefined;
	if (typeof rulesFile !== 'string') {
		return DEFAULT_RULES_FILE;
	}
	try {
		const filePath = resolveProjectFile(rulesFile, projectFolder);
		return path.relative(fs.realpathSync(projectFolder), filePath).split(path.sep).join('/');
	} catch (err) {
		const reason = err instanceof Error ? err.message : String(err);
		logger.warn(`Ignoring rules_file '${rulesFile}' of nao_config.yaml: ${reason}`, { source: 'system' });
		return DEFAULT_RULES_FILE;
	}
}

function configuredReposFrom(config: unknown, envVars?: Record<string, string>): LinkedContextRepo[] {
	if (!isRecord(config) || !Array.isArray(config.repos)) {
		return [];
	}

	return config.repos.flatMap((repo) => {
		if (!isRecord(repo) || typeof repo.name !== 'string' || repo.name.trim() === '') {
			return [];
		}

		const url = (envVars ? resolveSecrets(repo.url, envVars) : asString(repo.url))?.trim() || null;
		const branch = typeof repo.branch === 'string' && repo.branch.trim() !== '' ? repo.branch.trim() : null;
		const localPath =
			typeof repo.local_path === 'string' && repo.local_path.trim() !== '' ? repo.local_path.trim() : null;
		const parsed = url ? parseRepoFullName(url) : null;

		return [
			{
				name: repo.name.trim(),
				contextPath: `repos/${repo.name.trim()}`,
				targets: repoTargetsFrom(resolveEnvReferences(repo.targets, envVars ?? {})),
				url,
				branch,
				localPath,
				repoFullName: parsed?.repoFullName ?? null,
				provider: parsed?.provider ?? null,
			},
		];
	});
}

/**
 * Leaves out the targets `nao sync` refuses, so no path read here can lead out of the context. Their env references
 * resolve like those `nao sync` gets, as targets hold no secret.
 */
function repoTargetsFrom(targets: unknown): RepoTarget[] {
	if (!Array.isArray(targets)) {
		return [];
	}
	return targets.flatMap((entry) => {
		const source = isRecord(entry) ? toRelativeFolder(entry.source) : null;
		const target = isRecord(entry) ? toRelativeFolder(entry.target) : null;
		const isValidTarget =
			target !== null && target.includes('/') && !RESERVED_TARGET_FOLDERS.includes(target.split('/')[0]);
		return source && target && isValidTarget ? [{ source, target }] : [];
	});
}

function toRelativeFolder(value: unknown): string | null {
	if (typeof value !== 'string' || value.includes('\\') || value.trim().startsWith('/')) {
		return null;
	}
	const segments = value
		.trim()
		.split('/')
		.filter((segment) => segment !== '' && segment !== '.');
	return segments.length > 0 && !segments.includes('..') ? segments.join('/') : null;
}

function configuredTemplatesFrom(config: unknown): string[] {
	if (!isRecord(config) || !Array.isArray(config.databases)) {
		return [...DEFAULT_DATABASE_TEMPLATES];
	}

	const configuredTemplates = new Set<string>();
	for (const database of config.databases) {
		if (!isRecord(database)) {
			continue;
		}

		const templates = getDatabaseTemplates(database);
		const migratedTemplates = [
			...new Set(
				templates
					.filter((template) => template !== 'description')
					.map((template) => (template === 'how_to_use' ? 'query_history' : template)),
			),
		];
		const resolvedTemplates = migratedTemplates.length > 0 ? migratedTemplates : DEFAULT_DATABASE_TEMPLATES;
		for (const template of resolvedTemplates) {
			configuredTemplates.add(template);
		}
	}

	const resolvedTemplates = DATABASE_TEMPLATES.filter((template) => configuredTemplates.has(template));
	return resolvedTemplates.length > 0 ? resolvedTemplates : [...DEFAULT_DATABASE_TEMPLATES];
}

/** The `repos` entry of `nao_config.yaml` as written, so that `nao sync` can run it with the same filters. */
export function extractRawRepoConfig(projectFolder: string, repoName: string): Record<string, unknown> | null {
	const config = loadProjectConfig(projectFolder);
	if (!isRecord(config) || !Array.isArray(config.repos)) {
		return null;
	}
	const repo = config.repos.find(
		(entry) => isRecord(entry) && typeof entry.name === 'string' && entry.name.trim() === repoName,
	);
	return isRecord(repo) ? repo : null;
}

/** Fills in the `{{ env('NAME') }}` references of a config value, leaving the `aws` and `k8s` ones to the CLI. */
export function resolveEnvReferences<T>(value: T, envVars: Record<string, string>): T {
	if (typeof value === 'string') {
		return value.replace(
			NAO_CONFIG_ENV_PATTERN,
			(_reference, name: string) => envVars[name] || getDeploymentEnvVar(name) || '',
		) as T;
	}
	if (Array.isArray(value)) {
		return value.map((item) => resolveEnvReferences(item, envVars)) as T;
	}
	if (isRecord(value)) {
		return Object.fromEntries(
			Object.entries(value).map(([key, item]) => [key, resolveEnvReferences(item, envVars)]),
		) as T;
	}
	return value;
}

function asString(value: unknown): string | null {
	return typeof value === 'string' ? value : null;
}

function loadProjectConfig(projectFolder: string): unknown {
	const configPath = path.join(projectFolder, 'nao_config.yaml');
	return fs.existsSync(configPath) ? loadConfig(configPath) : null;
}

function hasDirectoryContent(directoryPath: string): boolean {
	if (!fs.existsSync(directoryPath)) {
		return false;
	}
	try {
		return fs.readdirSync(directoryPath, { withFileTypes: true }).some((entry) => {
			if (entry.isFile()) {
				return true;
			}
			return entry.isDirectory() && hasDirectoryContent(path.join(directoryPath, entry.name));
		});
	} catch {
		return false;
	}
}

function getDatabaseTemplates(database: Record<string, unknown>): string[] {
	if (!('templates' in database) && !('accessors' in database)) {
		return [...DEFAULT_DATABASE_TEMPLATES];
	}

	const templates = 'templates' in database ? database.templates : database.accessors;
	if (!Array.isArray(templates)) {
		return [...DEFAULT_DATABASE_TEMPLATES];
	}
	const stringTemplates = templates.filter((template): template is string => typeof template === 'string');
	return templates.length === 0 || stringTemplates.length > 0 ? stringTemplates : [...DEFAULT_DATABASE_TEMPLATES];
}

export function extractConfiguredDatabases(projectFolder: string): ConfiguredDatabase[] {
	const configPath = path.join(projectFolder, 'nao_config.yaml');
	if (!fs.existsSync(configPath)) {
		return [];
	}

	const config = loadConfig(configPath);
	if (!isRecord(config) || !Array.isArray(config.databases)) {
		return [];
	}

	return config.databases.flatMap((database) => {
		if (!isRecord(database) || typeof database.name !== 'string' || database.name.trim() === '') {
			return [];
		}

		const configuredDatabase: ConfiguredDatabase = { id: database.name.trim() };
		const type = normalizeString(database.type);
		if (type) {
			configuredDatabase.type = type;
		}

		for (const field of DATABASE_IDENTIFYING_FIELDS) {
			const value = normalizeIdentifyingValue(database[field]);
			if (value) {
				configuredDatabase[field] = value;
			}
		}

		const databasePath = normalizeString(database.path);
		if (!configuredDatabase.database && databasePath) {
			const databaseName = deriveDatabaseNameFromPath(databasePath);
			if (databaseName) {
				configuredDatabase.database = databaseName;
			}
		}

		return [configuredDatabase];
	});
}

/** The `semantic_layer` section of nao_config.yaml, or null when the project declares none. */
export function extractConfiguredSemanticLayer(projectFolder: string): ConfiguredSemanticLayer | null {
	const configPath = path.join(projectFolder, 'nao_config.yaml');
	if (!fs.existsSync(configPath)) {
		return null;
	}

	const config = loadConfig(configPath);
	if (!isRecord(config) || !isRecord(config.semantic_layer)) {
		return null;
	}

	const semanticLayer = config.semantic_layer;
	const manifestPath = normalizeString(semanticLayer.manifest_path);
	if (!manifestPath) {
		return null;
	}
	return {
		type: normalizeString(semanticLayer.type) ?? 'metricflow',
		manifestPath,
		database: normalizeString(semanticLayer.database),
	};
}

/** The `query_tag` section of nao_config.yaml, or null when the project declares none or an invalid one. */
export function extractConfiguredSqlQueryTag(projectFolder: string): SqlQueryTagConfig | null {
	const config = loadProjectConfig(projectFolder);
	if (!isRecord(config) || !isRecord(config.query_tag)) {
		return null;
	}

	const { template, position = DEFAULT_SQL_QUERY_TAG_POSITION } = config.query_tag;
	const isValidTemplate =
		typeof template === 'string' && template.trim() !== '' && template.length <= SQL_QUERY_TAG_TEMPLATE_MAX_LENGTH;
	return isValidTemplate && isSqlQueryTagPosition(position) ? { template, position } : null;
}

/** The `test` section of nao_config.yaml, read with the same defaults and validation as `nao test`. */
export function extractConfiguredTestSettings(projectFolder: string): ConfiguredTestSettings {
	const config = loadProjectConfig(projectFolder);
	const testConfig = isRecord(config) && isRecord(config.test) ? config.test : {};
	const errors: string[] = [];

	const models = parseTestModels(testConfig.models, errors);
	const attempts = testConfig.k ?? 1;
	const isValidAttempts = isPositiveInteger(attempts);
	if (!isValidAttempts) {
		errors.push(`test.k must be an integer of at least 1, got ${JSON.stringify(attempts)}.`);
	}
	const threads = testConfig.threads ?? null;
	const isValidThreads = threads === null || isPositiveInteger(threads);
	if (!isValidThreads) {
		errors.push(`test.threads must be an integer of at least 1, got ${JSON.stringify(threads)}.`);
	}
	const tolerances = testComparisonTolerancesSchema.safeParse(testConfig.comparison ?? {});
	if (!tolerances.success) {
		errors.push(`test.comparison is invalid: ${z.prettifyError(tolerances.error)}`);
	}

	return {
		models,
		attempts: isValidAttempts ? attempts : 1,
		threads: isValidThreads ? threads : null,
		tolerances: tolerances.success ? tolerances.data : DEFAULT_TEST_COMPARISON_TOLERANCES,
		schedules: parseTestSchedules(testConfig.schedules, errors),
		errors,
	};
}

/** The valid entries of `test.schedules`, each one a cron with the tags, models and attempts it overrides. */
function parseTestSchedules(schedules: unknown, errors: string[]): TestScheduleSettings[] {
	if (schedules === undefined || schedules === null) {
		return [];
	}
	if (!Array.isArray(schedules)) {
		errors.push('test.schedules must be a list of { cron, tags, models, k } entries.');
		return [];
	}
	return schedules.flatMap((schedule) => {
		const scheduleErrors: string[] = [];
		const parsed = parseTestSchedule(schedule, scheduleErrors);
		errors.push(...scheduleErrors);
		return scheduleErrors.length === 0 ? [parsed] : [];
	});
}

function parseTestSchedule(schedule: unknown, errors: string[]): TestScheduleSettings {
	const entry = isRecord(schedule) ? schedule : {};
	const cron = typeof entry.cron === 'string' ? entry.cron.trim() : '';
	const cronError = cron ? getTestScheduleCronError(cron) : `expected a 'cron', got ${JSON.stringify(schedule)}.`;
	if (cronError) {
		errors.push(`test.schedules has an invalid entry: ${cronError}`);
	}
	const tags = entry.tags ?? [];
	const isValidTags = Array.isArray(tags) && tags.every((tag) => typeof tag === 'string' && tag.trim());
	if (!isValidTags) {
		errors.push(`test.schedules tags must be a list of tags, got ${JSON.stringify(tags)}.`);
	}
	const attempts = entry.k ?? null;
	const isValidAttempts = attempts === null || isPositiveInteger(attempts);
	if (!isValidAttempts) {
		errors.push(`test.schedules k must be an integer of at least 1, got ${JSON.stringify(attempts)}.`);
	}
	return {
		cron,
		tags: isValidTags ? tags.map((tag: string) => tag.trim()) : [],
		models: parseTestModels(entry.models, errors),
		attempts: isValidAttempts ? attempts : null,
	};
}

function isPositiveInteger(value: unknown): value is number {
	return typeof value === 'number' && Number.isInteger(value) && value >= 1;
}

function parseTestModels(models: unknown, errors: string[]): TestModelSelection[] | null {
	if (models === undefined || models === null) {
		return null;
	}
	if (!Array.isArray(models)) {
		errors.push(`test.models must be a list of ${TEST_MODEL_FORMAT} or ${TEST_MODEL_OBJECT_FORMAT} entries.`);
		return null;
	}
	const parsed = models.flatMap((model) => {
		const selection = parseTestModelEntry(model);
		if (typeof selection === 'string') {
			errors.push(selection);
			return [];
		}
		return [selection];
	});
	return parsed.length > 0 ? parsed : null;
}

/** A `provider:model_id` entry, or an object naming the model with the reasoning efforts to run it at, or `all`. */
function parseTestModelEntry(entry: unknown): TestModelSelection | string {
	const invalidEntry = `test.models has an invalid entry ${JSON.stringify(entry)}, expected`;
	if (!isRecord(entry)) {
		return parseTestModel(entry) ?? `${invalidEntry} ${TEST_MODEL_FORMAT}.`;
	}
	const model = parseTestModel(entry.model);
	const unknownKeys = Object.keys(entry).filter((key) => key !== 'model' && key !== 'reasoning_efforts');
	if (!model || unknownKeys.length > 0) {
		return `${invalidEntry} ${TEST_MODEL_OBJECT_FORMAT}.`;
	}
	if (entry.reasoning_efforts === undefined || entry.reasoning_efforts === null) {
		return model;
	}
	const reasoningEfforts = parseReasoningEfforts(model, entry.reasoning_efforts);
	return typeof reasoningEfforts === 'string' ? reasoningEfforts : { ...model, reasoningEfforts };
}

function parseTestModel(model: unknown): LlmSelectedModel | null {
	if (typeof model !== 'string') {
		return null;
	}
	const separatorIndex = model.indexOf(':');
	const provider = model.slice(0, separatorIndex);
	const modelId = model.slice(separatorIndex + 1);
	return separatorIndex > 0 && modelId && isLlmProvider(provider) ? { provider, modelId } : null;
}

/** The efforts listed for a model, from the lowest, or the error naming the ones it does not support. */
function parseReasoningEfforts(model: LlmSelectedModel, efforts: unknown): ActiveEffort[] | string {
	const label = `test.models reasoning_efforts of ${model.provider}:${model.modelId}`;
	const supported = getModelReasoningEfforts(model.provider, model.modelId);
	if (supported.length === 0) {
		return `${label}: this model has no reasoning efforts to pick.`;
	}
	if (efforts === 'all') {
		return supported;
	}
	if (!Array.isArray(efforts) || efforts.length === 0) {
		return `${label} must be 'all' or a list of efforts among ${supported.join(', ')}.`;
	}
	const unsupported = efforts.filter((effort: unknown) => {
		return !supported.some((candidate) => candidate === effort);
	});
	if (unsupported.length > 0) {
		return `${label} has unsupported efforts ${unsupported.map((effort) => JSON.stringify(effort)).join(', ')}, expected some of ${supported.join(', ')}.`;
	}
	return supported.filter((effort) => efforts.includes(effort));
}

function deriveDatabaseNameFromPath(databasePath: string): string {
	const trimmedPath = databasePath.trim();
	if (trimmedPath === ':memory:') {
		return 'memory';
	}
	const pathWithoutQuery = stripQueryString(trimmedPath);
	if (/^(?:md|motherduck):/i.test(pathWithoutQuery)) {
		const remainder = pathWithoutQuery.slice(pathWithoutQuery.indexOf(':') + 1);
		return remainder.trim() || 'motherduck';
	}
	return path.parse(pathWithoutQuery).name;
}

function stripQueryString(databasePath: string): string {
	return databasePath.split('?', 1)[0];
}

function normalizeString(value: unknown): string | null {
	return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

function normalizeIdentifyingValue(value: unknown): string | null {
	if (typeof value === 'number' && Number.isFinite(value)) {
		return String(value);
	}
	return normalizeString(value);
}

function loadConfig(configPath: string): unknown {
	try {
		return resolveFileReferences(yaml.load(fs.readFileSync(configPath, 'utf-8')), path.dirname(configPath));
	} catch (err) {
		logger.warn(`Failed to read or parse ${configPath}: ${err instanceof Error ? err.message : String(err)}`, {
			source: 'system',
		});
		return null;
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseRepoFullName(url: string): { repoFullName: string; provider: RepoProvider } | null {
	const githubRepoFullName = parseGithubRemoteRepoFullName(url);
	if (githubRepoFullName) {
		return { repoFullName: githubRepoFullName, provider: 'github' };
	}

	const gitlabRepoFullName = parseGitlabRepoFullName(url);
	if (gitlabRepoFullName) {
		return { repoFullName: gitlabRepoFullName, provider: 'gitlab' };
	}

	return null;
}

function parseGitlabRepoFullName(url: string): string | null {
	const host = gitlabBaseUrl().replace(/^https?:\/\//, '');
	const match = url.match(new RegExp(`${escapeRegExp(host)}[:/](.+?)(?:\\.git)?(?:[#?].*)?$`, 'i'));
	return match ? match[1] : null;
}
