import fs from 'node:fs';
import path from 'node:path';

import type { RepoProvider } from '@nao/shared/types';
import yaml from 'js-yaml';

import { escapeRegExp, gitlabBaseUrl } from '../services/gitlab';
import type { LinkedContextRepo } from '../types/context-recommendation';
import { logger } from './logger';

const NAO_CONFIG_ENV_PATTERN = /\$?\{\{\s*env\(['"]([^'"]+)['"]\)\s*\}\}/g;
const MCP_CONFIG_ENV_PATTERN = /\$\{(\w+)\}/g;
const DATABASE_IDENTIFYING_FIELDS = ['database', 'project_id', 'dataset_id', 'catalog'] as const;

type DatabaseIdentifyingField = (typeof DATABASE_IDENTIFYING_FIELDS)[number];

export type ConfiguredDatabase = {
	id: string;
	type?: string;
} & Partial<Record<DatabaseIdentifyingField, string>>;

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
	const configPath = path.join(projectFolder, 'nao_config.yaml');
	if (!fs.existsSync(configPath)) {
		return [];
	}

	const config = loadConfig(configPath);
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
