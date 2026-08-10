import fs from 'node:fs';
import path from 'node:path';

import type { ContextGitUnavailableReason, RepoProvider } from '@nao/shared/types';

import { env } from '../env';
import * as gitlab from '../services/gitlab';
import type { InternalRepoProvider } from '../services/review-request-provider';
import { runGit, tryRunGit } from './git-repo';

export interface ContextRepoConfig {
	repoFullName: string;
	provider: RepoProvider;
}

export interface ContextRepositoryConnection {
	repoFullName: string;
	provider: InternalRepoProvider;
	branch: string | null;
	source: 'settings' | 'deployment';
	webUrl: string;
}

export interface UnresolvedContextRepo {
	provider: InternalRepoProvider;
	repoFullName: string;
	branch: string | null;
	source: ContextRepositoryConnection['source'];
	worktreeRoot: string;
	projectPrefix: null;
}

export interface ResolvedContextRepo extends Omit<UnresolvedContextRepo, 'projectPrefix'> {
	projectPrefix: string;
}

export type ContextRepo = UnresolvedContextRepo | ResolvedContextRepo;
export type GitPlatform = 'github' | 'gitlab' | 'bitbucket';
export type ContextRepoState = Pick<ContextRepo, 'provider' | 'repoFullName' | 'branch' | 'source'> & {
	platform: GitPlatform | null;
};

export class ContextProjectResolutionError extends Error {
	constructor(
		public readonly reason: Extract<ContextGitUnavailableReason, 'project-not-found' | 'project-ambiguous'>,
		message: string,
	) {
		super(message);
	}
}

const prefixCache = new Map<string, { commit: string; prefix: string }>();

export async function resolveContextRepo(
	projectId: string,
	projectFolder: string,
	userId: string,
	configOverride?: ContextRepoConfig | null,
): Promise<UnresolvedContextRepo | null> {
	const connection = await resolveContextRepository(projectId, configOverride);
	if (!connection) {
		return null;
	}
	const worktreeRoot = getContextWorktreePath(projectId, projectFolder, userId);
	return {
		provider: connection.provider,
		repoFullName: connection.repoFullName,
		branch: readCurrentBranch(worktreeRoot),
		source: connection.source,
		worktreeRoot,
		projectPrefix: null,
	};
}

export async function resolveContextRepository(
	projectId: string,
	configOverride?: ContextRepoConfig | null,
): Promise<ContextRepositoryConnection | null> {
	if (configOverride !== undefined) {
		return configOverride ? toRepositoryConnection(configOverride, null, 'settings') : null;
	}

	const config = await readContextRepoConfig(projectId);
	if (config) {
		return toRepositoryConnection(config, null, 'settings');
	}
	return env.NAO_CONTEXT_SOURCE === 'git' && env.NAO_CONTEXT_GIT_URL
		? {
				provider: 'generic',
				repoFullName: env.NAO_CONTEXT_GIT_URL,
				branch: env.NAO_CONTEXT_GIT_BRANCH || 'main',
				source: 'deployment',
				webUrl: sanitizeContextSourceRepositoryUrl(env.NAO_CONTEXT_GIT_URL),
			}
		: null;
}

export function resolveContextProject(
	repo: UnresolvedContextRepo,
	projectFolder: string,
	matchingCloneRoot: string | null,
): ResolvedContextRepo {
	const commit = runGit(repo.worktreeRoot, ['rev-parse', 'HEAD']).toString().trim();
	const cached = prefixCache.get(repo.worktreeRoot);
	if (cached?.commit === commit) {
		return { ...repo, branch: readCurrentBranch(repo.worktreeRoot), projectPrefix: cached.prefix };
	}

	const prefix =
		repo.provider === 'generic' && env.NAO_CONTEXT_GIT_SUBPATH !== undefined
			? normalizeProjectPath(env.NAO_CONTEXT_GIT_SUBPATH).replace(/\/+$/, '')
			: matchingCloneRoot
				? resolvePrefixFromClone(matchingCloneRoot, projectFolder)
				: resolvePrefixFromTrackedConfigs(repo.worktreeRoot);
	prefixCache.set(repo.worktreeRoot, { commit, prefix });
	return { ...repo, branch: readCurrentBranch(repo.worktreeRoot), projectPrefix: prefix };
}

export function invalidateContextProjectPrefix(worktreeRoot: string): void {
	prefixCache.delete(worktreeRoot);
}

export function getContextWorktreePath(projectId: string, projectFolder: string, userId: string): string {
	if (!/^[A-Za-z0-9_-]+$/.test(projectId) || projectId === '.' || projectId === '..') {
		throw new Error('Invalid project id for context worktree path.');
	}
	return path.join(
		path.dirname(path.resolve(projectFolder)),
		'.nao',
		'worktrees',
		projectId,
		sanitizeWorktreeUserId(userId),
	);
}

export function toContextRepoState(repo: ContextRepo | null): ContextRepoState | null {
	return repo
		? {
				provider: repo.provider,
				platform: resolveContextRepoPlatform(repo),
				repoFullName:
					repo.provider === 'generic'
						? sanitizeContextSourceRepositoryUrl(repo.repoFullName)
						: repo.repoFullName,
				branch: readCurrentBranch(repo.worktreeRoot),
				source: repo.source,
			}
		: null;
}

export function sanitizeContextSourceRepositoryUrl(repositoryUrl: string): string {
	return repositoryUrl.replace(/^(https?:\/\/)[^/]*@/i, '$1');
}

export function detectGitPlatform(repositoryUrl: string | undefined): GitPlatform | null {
	if (!repositoryUrl) {
		return null;
	}
	const shorthandHost = !repositoryUrl.includes('://')
		? repositoryUrl.match(/^(?:[^@/]+@)?([^:/]+):(.+)$/)?.[1]
		: undefined;
	let host = shorthandHost;
	if (!host) {
		try {
			host = new URL(repositoryUrl).hostname;
		} catch {
			return null;
		}
	}
	const normalizedHost = host.toLowerCase();
	return normalizedHost === 'github.com'
		? 'github'
		: normalizedHost === 'gitlab.com'
			? 'gitlab'
			: normalizedHost === 'bitbucket.org'
				? 'bitbucket'
				: null;
}

export function resolveContextSourceGitToken(): string | null {
	if (env.NAO_CONTEXT_GIT_TOKEN) {
		return env.NAO_CONTEXT_GIT_TOKEN;
	}
	return env.NAO_CONTEXT_GIT_SSH_KEY || hasEmbeddedRepositoryCredentials(env.NAO_CONTEXT_GIT_URL) ? '' : null;
}

export function hasEmbeddedRepositoryCredentials(repositoryUrl: string | undefined): boolean {
	if (!repositoryUrl || !/^https?:\/\//i.test(repositoryUrl)) {
		return false;
	}
	try {
		const parsed = new URL(repositoryUrl);
		return !!(parsed.username || parsed.password);
	} catch {
		return false;
	}
}

export function getWorktreeProjectRoot(repo: ResolvedContextRepo): string {
	return repo.projectPrefix ? path.join(repo.worktreeRoot, ...repo.projectPrefix.split('/')) : repo.worktreeRoot;
}

export function getCommittedProjectPaths(repo: ResolvedContextRepo): Set<string> {
	const output = runGit(repo.worktreeRoot, [
		'ls-tree',
		'-r',
		'-z',
		'--name-only',
		'HEAD',
		'--',
		repo.projectPrefix || '.',
	]);
	return new Set(
		parseNullDelimited(output)
			.map((repoPath) => fromRepoPath(repo, repoPath))
			.filter((entry): entry is string => entry !== null),
	);
}

export function readCommittedFile(repo: ResolvedContextRepo, projectPath: string, maxSize = 10 * 1024 * 1024): Buffer {
	const object = `HEAD:${toRepoPath(repo, projectPath)}`;
	const size = Number(runGit(repo.worktreeRoot, ['cat-file', '-s', object]).toString().trim());
	if (!Number.isFinite(size)) {
		throw new Error(`Unable to determine the committed size of ${projectPath}.`);
	}
	if (size > maxSize) {
		throw new Error(`File is too large (max ${formatFileSize(maxSize)}).`);
	}
	return runGit(repo.worktreeRoot, ['show', object], 5_000, maxSize + 64 * 1024);
}

export function toRepoPath(repo: ResolvedContextRepo, projectPath: string): string {
	const normalized = normalizeProjectPath(projectPath);
	return repo.projectPrefix ? `${repo.projectPrefix}/${normalized}` : normalized;
}

export function fromRepoPath(repo: ResolvedContextRepo, repoPath: string): string | null {
	const normalized = repoPath.replaceAll('\\', '/');
	if (!repo.projectPrefix) {
		return normalized;
	}
	const prefix = `${repo.projectPrefix}/`;
	return normalized.startsWith(prefix) ? normalized.slice(prefix.length) : null;
}

export function normalizeProjectPath(projectPath: string): string {
	return projectPath.replaceAll('\\', '/').replace(/^\/+/, '');
}

function resolvePrefixFromClone(cloneRoot: string, projectFolder: string): string {
	const relative = path.relative(fs.realpathSync(cloneRoot), fs.realpathSync(projectFolder));
	if (relative.startsWith('..') || path.isAbsolute(relative)) {
		throw new ContextProjectResolutionError(
			'project-not-found',
			'The live project is outside the connected clone.',
		);
	}
	return relative.split(path.sep).join('/');
}

function resolveContextRepoPlatform(repo: ContextRepo): GitPlatform | null {
	if (repo.provider === 'github' || repo.provider === 'gitlab') {
		return repo.provider;
	}
	return env.NAO_CONTEXT_GIT_PLATFORM ?? detectGitPlatform(repo.repoFullName);
}

function resolvePrefixFromTrackedConfigs(worktreeRoot: string): string {
	const output = runGit(worktreeRoot, ['ls-files', '-z', '--', 'nao_config.yaml', ':(glob)**/nao_config.yaml']);
	const candidates = parseNullDelimited(output);
	if (candidates.length === 0) {
		throw new ContextProjectResolutionError(
			'project-not-found',
			'No tracked nao_config.yaml was found in the connected repository.',
		);
	}
	if (candidates.length > 1) {
		throw new ContextProjectResolutionError(
			'project-ambiguous',
			`Multiple nao projects were found: ${candidates.join(', ')}.`,
		);
	}
	const directory = path.posix.dirname(candidates[0]);
	return directory === '.' ? '' : directory;
}

async function readContextRepoConfig(projectId: string): Promise<ContextRepoConfig | null> {
	const contextRecommendationQueries = await import('../queries/context-recommendation.queries');
	const config = await contextRecommendationQueries.getConfig(projectId);
	if (!config?.repoFullName) {
		return null;
	}
	return {
		repoFullName: config.repoFullName,
		provider: config.repoProvider ?? 'github',
	};
}

function toRepositoryConnection(
	config: ContextRepoConfig,
	branch: string | null,
	source: ContextRepositoryConnection['source'],
): ContextRepositoryConnection {
	const baseUrl = config.provider === 'gitlab' ? gitlab.gitlabBaseUrl() : 'https://github.com';
	return {
		...config,
		branch,
		source,
		webUrl: `${baseUrl}/${config.repoFullName}`,
	};
}

function readCurrentBranch(worktreeRoot: string): string | null {
	const branch = tryRunGit(worktreeRoot, ['rev-parse', '--abbrev-ref', 'HEAD'])?.toString().trim();
	return branch && branch !== 'HEAD' ? branch : null;
}

function sanitizeWorktreeUserId(userId: string): string {
	const value = userId.trim();
	if (!value) {
		throw new Error('Invalid user id for context worktree path.');
	}
	return Buffer.from(value).reduce<string>((result, byte) => {
		const character = String.fromCharCode(byte);
		return /[A-Za-z0-9_-]/.test(character)
			? `${result}${character}`
			: `${result}%${byte.toString(16).toUpperCase().padStart(2, '0')}`;
	}, '');
}

function parseNullDelimited(output: Buffer): string[] {
	return output
		.toString()
		.split('\0')
		.filter((entry) => entry.length > 0);
}

function formatFileSize(size: number): string {
	return size % (1024 * 1024) === 0 ? `${size / (1024 * 1024)} MB` : `${size} bytes`;
}
