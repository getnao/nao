import fs from 'node:fs';
import path from 'node:path';

import type { RepoProvider } from '@nao/shared/types';
import yaml from 'js-yaml';

import { escapeRegExp, gitlabBaseUrl } from '../services/gitlab';
import type { LinkedContextRepo } from '../types/context-recommendation';
import { logger } from './logger';

const ENV_PATTERN = /\$?\{\{\s*env\(['"]([^'"]+)['"]\)\s*\}\}/g;
const DATABASE_TEMPLATES = ['columns', 'preview', 'profiling', 'query_history', 'ai_summary'] as const;
const DEFAULT_DATABASE_TEMPLATES = ['columns', 'preview'] as const;

export type ContextPresence = {
	rules: boolean;
	semantics: boolean;
	docs: boolean;
	notionDocs: boolean;
	databases: boolean;
};
const NAO_CONFIG_ENV_PATTERN = /\$?\{\{\s*env\(['"]([^'"]+)['"]\)\s*\}\}/g;
const MCP_CONFIG_ENV_PATTERN = /\$\{(\w+)\}/g;
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

export function extractConfiguredRepos(projectFolder: string): LinkedContextRepo[] {
	return configuredReposFrom(loadProjectConfig(projectFolder));
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

function configuredReposFrom(config: unknown): LinkedContextRepo[] {
	if (!isRecord(config) || !Array.isArray(config.repos)) {
		return [];
	}

	return config.repos.flatMap((repo) => {
		if (!isRecord(repo) || typeof repo.name !== 'string' || repo.name.trim() === '') {
			return [];
		}

		const url = typeof repo.url === 'string' && repo.url.trim() !== '' ? repo.url.trim() : null;
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
	const githubRepoFullName = parseGithubRepoFullName(url);
	if (githubRepoFullName) {
		return { repoFullName: githubRepoFullName, provider: 'github' };
	}

	const gitlabRepoFullName = parseGitlabRepoFullName(url);
	if (gitlabRepoFullName) {
		return { repoFullName: gitlabRepoFullName, provider: 'gitlab' };
	}

	return null;
}

function parseGithubRepoFullName(url: string): string | null {
	const match = url.match(/github\.com[:/]([^/\s]+)\/([^/\s#?]+?)(?:\.git)?(?:[#?].*)?$/i);
	return match ? `${match[1]}/${match[2]}` : null;
}

function parseGitlabRepoFullName(url: string): string | null {
	const host = gitlabBaseUrl().replace(/^https?:\/\//, '');
	const match = url.match(new RegExp(`${escapeRegExp(host)}[:/](.+?)(?:\\.git)?(?:[#?].*)?$`, 'i'));
	return match ? match[1] : null;
}
