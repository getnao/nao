import fs from 'node:fs';
import path from 'node:path';

import type { RepoProvider } from '@nao/shared/types';
import yaml from 'js-yaml';

import { escapeRegExp, gitlabBaseUrl } from '../services/gitlab';
import type { LinkedContextRepo } from '../types/context-recommendation';
import { logger } from './logger';

const ENV_PATTERN = /\$?\{\{\s*env\(['"]([^'"]+)['"]\)\s*\}\}/g;
const DATABASE_TEMPLATES = ['columns', 'preview', 'profiling', 'query_history', 'ai_summary'] as const;
const DEFAULT_DATABASE_TEMPLATES = ['columns', 'query_history', 'preview'] as const;

export type ContextPresence = {
	rules: boolean;
	semantics: boolean;
	docs: boolean;
	notionDocs: boolean;
	databases: boolean;
};

export function extractRequiredEnvVars(projectFolder: string): string[] {
	const configPath = path.join(projectFolder, 'nao_config.yaml');
	if (!fs.existsSync(configPath)) {
		return [];
	}

	const content = fs.readFileSync(configPath, 'utf-8');
	const vars = new Set<string>();

	for (const match of content.matchAll(ENV_PATTERN)) {
		vars.add(match[1]);
	}

	return [...vars];
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

/** Returns the database templates enabled across all configured databases. */
export function extractConfiguredTemplates(projectFolder: string): string[] {
	const configPath = path.join(projectFolder, 'nao_config.yaml');
	if (!fs.existsSync(configPath)) {
		return [];
	}

	const config = loadConfig(configPath);
	if (!isRecord(config) || !Array.isArray(config.databases)) {
		return [];
	}

	const configuredTemplates = new Set<string>();
	for (const database of config.databases) {
		if (!isRecord(database)) {
			continue;
		}

		const templates = getDatabaseTemplates(database);
		for (const template of templates) {
			const normalizedTemplate = template === 'how_to_use' ? 'query_history' : template;
			if (normalizedTemplate !== 'description') {
				configuredTemplates.add(normalizedTemplate);
			}
		}
	}

	return DATABASE_TEMPLATES.filter((template) => configuredTemplates.has(template));
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

function hasDirectoryContent(directoryPath: string): boolean {
	if (!fs.existsSync(directoryPath)) {
		return false;
	}
	try {
		return fs.readdirSync(directoryPath).length > 0;
	} catch {
		return false;
	}
}

function getDatabaseTemplates(database: Record<string, unknown>): string[] {
	if (!('templates' in database) && !('accessors' in database)) {
		return [...DEFAULT_DATABASE_TEMPLATES];
	}

	const templates = 'templates' in database ? database.templates : database.accessors;
	return Array.isArray(templates)
		? templates.filter((template): template is string => typeof template === 'string')
		: [];
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
