import fs from 'node:fs';
import path from 'node:path';

import { isLlmProvider, type LlmSelectedModel, type RepoProvider } from '@nao/shared/types';
import yaml from 'js-yaml';
import { z } from 'zod/v4';

import { getModelReasoningEfforts } from '../agents/provider-meta';
import { parseGithubRemoteRepoFullName } from '../services/github';
import { gitlabBaseUrl } from '../services/gitlab';
import type { LinkedContextRepo } from '../types/context-recommendation';
import type { ActiveEffort } from '../types/llm';
import {
	type ConfiguredTestSettings,
	DEFAULT_TEST_COMPARISON_TOLERANCES,
	testComparisonTolerancesSchema,
	type TestModelSelection,
} from '../types/test-run';
import { logger } from './logger';
import { resolveSecrets } from './nao-config-llm';
import { escapeRegExp } from './utils';

const DATABASE_TEMPLATES = ['columns', 'preview', 'profiling', 'query_history', 'ai_summary'] as const;
const DEFAULT_DATABASE_TEMPLATES = ['columns', 'preview'] as const;
const MAX_SYNC_TEMPLATE_SIZE = 1024 * 1024;
const SYNC_CONFIG_SECTIONS = ['databases', 'repos', 'notion', 'confluence', 'obsidian', 'semantic_layer'] as const;
const TEMPLATE_EXCLUDED_DIRECTORIES = new Set([
	'templates',
	'.git',
	'.venv',
	'venv',
	'node_modules',
	'__pycache__',
	'.nao',
]);
const SECRET_REFERENCE_PATTERN = /\$?\{\{\s*(env|aws|k8s)\(\s*['"]([^'"]+)['"]\s*\)\s*\}\}/g;
const AWS_SYNC_ENV_VARS = [
	'AWS_ACCESS_KEY_ID',
	'AWS_SECRET_ACCESS_KEY',
	'AWS_SESSION_TOKEN',
	'AWS_REGION',
	'AWS_DEFAULT_REGION',
	'AWS_BEARER_TOKEN_BEDROCK',
] as const;
const GCP_SYNC_ENV_VARS = [
	'GOOGLE_APPLICATION_CREDENTIALS',
	'GOOGLE_CLOUD_PROJECT',
	'GOOGLE_VERTEX_PROJECT',
	'GOOGLE_VERTEX_LOCATION',
	'VERTEX_GOOGLE_SERVICE_ACCOUNT_JSON',
	'VERTEX_GOOGLE_APPLICATION_CREDENTIALS',
] as const;
const K8S_SYNC_ENV_VARS = ['KUBERNETES_SERVICE_HOST', 'KUBERNETES_SERVICE_PORT'] as const;

export type ContextPresence = {
	rules: boolean;
	semantics: boolean;
	docs: boolean;
	notionDocs: boolean;
	databases: boolean;
};
const NAO_CONFIG_ENV_PATTERN = /\$?\{\{\s*env\(['"]([^'"]+)['"]\)\s*\}\}/g;
const MCP_CONFIG_ENV_PATTERN = /\$\{(\w+)\}/g;
const TEST_MODEL_FORMAT = "'provider:model_id'";
const TEST_MODEL_OBJECT_FORMAT = "{ model: 'provider:model_id', reasoning_efforts: [low, high] or all }";
const DATABASE_IDENTIFYING_FIELDS = ['database', 'project_id', 'dataset_id', 'catalog'] as const;

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

export function extractRequiredSyncEnvVars(projectFolder: string): string[] {
	const configPath = path.join(projectFolder, 'nao_config.yaml');
	const source = fs.readFileSync(configPath, 'utf8');
	const references = new Map<string, { protocol: string; name: string }>();
	const substituted = source.replace(SECRET_REFERENCE_PATTERN, (_match, protocol: string, name: string) => {
		const token = `__NAO_SYNC_SECRET_${references.size}__`;
		references.set(token, { protocol, name });
		return token;
	});
	const config = yaml.load(substituted);
	if (!isRecord(config)) {
		throw new Error('Cannot determine sync credentials because nao_config.yaml is not an object.');
	}
	const activeConfig: unknown[] = SYNC_CONFIG_SECTIONS.map((section) => config[section]);
	if (syncUsesLlm(config.databases, projectFolder)) {
		activeConfig.push(config.llm);
	}
	const required = new Set<string>();
	const protocols = new Set<string>();
	collectReferencedSecrets(activeConfig, references, required, protocols);
	for (const template of listProjectTemplates(projectFolder)) {
		const contents = fs.readFileSync(template, 'utf8');
		for (const [, protocol, name] of contents.matchAll(SECRET_REFERENCE_PATTERN)) {
			protocols.add(protocol);
			if (protocol === 'env') {
				required.add(name);
			}
		}
	}
	const activeConfigText = JSON.stringify(activeConfig).toLowerCase();
	if (
		protocols.has('aws') ||
		activeConfigText.includes('"athena"') ||
		activeConfigText.includes('"bedrock"') ||
		activeConfigText.includes('"auth_mode":"iam"')
	) {
		AWS_SYNC_ENV_VARS.forEach((name) => required.add(name));
	}
	if (activeConfigText.includes('"bigquery"') || activeConfigText.includes('"vertex"')) {
		GCP_SYNC_ENV_VARS.forEach((name) => required.add(name));
	}
	if (protocols.has('k8s')) {
		K8S_SYNC_ENV_VARS.forEach((name) => required.add(name));
	}
	return [...required].sort();
}

function collectReferencedSecrets(
	value: unknown,
	references: Map<string, { protocol: string; name: string }>,
	required: Set<string>,
	protocols: Set<string>,
): void {
	if (typeof value === 'string') {
		for (const [token, reference] of references) {
			if (value.includes(token)) {
				protocols.add(reference.protocol);
				if (reference.protocol === 'env') {
					required.add(reference.name);
				}
			}
		}
		return;
	}
	if (Array.isArray(value)) {
		value.forEach((item) => collectReferencedSecrets(item, references, required, protocols));
		return;
	}
	if (isRecord(value)) {
		Object.values(value).forEach((item) => collectReferencedSecrets(item, references, required, protocols));
	}
}

function listProjectTemplates(root: string, relativeDirectory = ''): string[] {
	const templates: string[] = [];
	for (const entry of fs.readdirSync(path.join(root, relativeDirectory), { withFileTypes: true })) {
		if (TEMPLATE_EXCLUDED_DIRECTORIES.has(entry.name)) {
			continue;
		}
		const relativePath = path.join(relativeDirectory, entry.name);
		if (entry.isDirectory()) {
			templates.push(...listProjectTemplates(root, relativePath));
		} else if (entry.isFile() && entry.name.endsWith('.j2')) {
			templates.push(path.join(root, relativePath));
		}
	}
	return templates;
}

export function syncUsesLlm(databases: unknown, projectFolder?: string): boolean {
	if (containsValue(databases, 'ai_summary')) {
		return true;
	}
	if (!projectFolder || !Array.isArray(databases) || !databases.some(isRecord)) {
		return false;
	}
	return configuredTemplatesFromDatabases(databases).some((template) => {
		const contents = readSyncTemplateOverride(projectFolder, template);
		if (contents === null) {
			return false;
		}
		return [...contents.matchAll(/{{[\s\S]*?}}|{%[\s\S]*?%}/g)].some(([block]) => /\bprompt\s*\(/.test(block));
	});
}

function readSyncTemplateOverride(projectFolder: string, template: string): string | null {
	const root = fs.realpathSync(projectFolder);
	const relativePath = path.join('templates', 'databases', `${template}.md.j2`);
	const templatePath = path.join(root, relativePath);
	if (!assertSafeTemplatePath(root, relativePath)) {
		return null;
	}

	const descriptor = fs.openSync(
		templatePath,
		fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK,
	);
	try {
		const stat = fs.fstatSync(descriptor);
		assertSafeTemplateFile(stat, relativePath);
		const content = Buffer.alloc(stat.size);
		let offset = 0;
		while (offset < content.length) {
			const bytesRead = fs.readSync(descriptor, content, offset, content.length - offset, offset);
			if (bytesRead === 0) {
				break;
			}
			offset += bytesRead;
		}
		const current = fs.fstatSync(descriptor);
		if (offset !== stat.size || current.size !== stat.size) {
			throw new Error(`Sync template "${relativePath}" changed while it was being inspected.`);
		}
		if (!assertSafeTemplatePath(root, relativePath)) {
			throw new Error(`Sync template "${relativePath}" changed while it was being inspected.`);
		}
		const pathStat = fs.statSync(templatePath);
		if (pathStat.dev !== stat.dev || pathStat.ino !== stat.ino) {
			throw new Error(`Sync template "${relativePath}" changed while it was being inspected.`);
		}
		return content.toString('utf8');
	} finally {
		fs.closeSync(descriptor);
	}
}

function assertSafeTemplatePath(root: string, relativePath: string): boolean {
	const parts = relativePath.split(path.sep);
	let current = root;
	for (const [index, part] of parts.entries()) {
		current = path.join(current, part);
		const stat = fs.lstatSync(current, { throwIfNoEntry: false });
		if (!stat) {
			return false;
		}
		if (stat.isSymbolicLink()) {
			throw new Error(`Sync template "${relativePath}" cannot contain symbolic links.`);
		}
		if (index < parts.length - 1 && !stat.isDirectory()) {
			throw new Error(`Sync template "${relativePath}" has a non-directory path component.`);
		}
	}
	return true;
}

function assertSafeTemplateFile(stat: fs.Stats, relativePath: string): void {
	if (!stat.isFile()) {
		throw new Error(`Sync template "${relativePath}" must be a regular file.`);
	}
	if (stat.size > MAX_SYNC_TEMPLATE_SIZE) {
		throw new Error(`Sync template "${relativePath}" exceeds the 1 MB size limit.`);
	}
}

function containsValue(value: unknown, expected: string): boolean {
	if (value === expected) {
		return true;
	}
	if (Array.isArray(value)) {
		return value.some((item) => containsValue(item, expected));
	}
	return isRecord(value) && Object.values(value).some((item) => containsValue(item, expected));
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
	return {
		rules: fs.existsSync(path.join(projectFolder, 'RULES.md')),
		semantics: hasDirectoryContent(path.join(projectFolder, 'semantics')),
		docs: hasDirectoryContent(path.join(projectFolder, 'docs')),
		notionDocs: hasDirectoryContent(path.join(projectFolder, 'docs', 'notion')),
		databases: hasDirectoryContent(path.join(projectFolder, 'databases')),
	};
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
				url,
				branch,
				localPath,
				repoFullName: parsed?.repoFullName ?? null,
				provider: parsed?.provider ?? null,
			},
		];
	});
}

function configuredTemplatesFrom(config: unknown): string[] {
	if (!isRecord(config) || !Array.isArray(config.databases)) {
		return [...DEFAULT_DATABASE_TEMPLATES];
	}
	return configuredTemplatesFromDatabases(config.databases);
}

function configuredTemplatesFromDatabases(databases: unknown[]): string[] {
	const configuredTemplates = new Set<string>();
	for (const database of databases) {
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
		errors,
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
		return yaml.load(fs.readFileSync(configPath, 'utf-8'));
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
