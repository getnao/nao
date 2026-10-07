import { execFile } from 'node:child_process';
import { createPrivateKey } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { SignJWT } from 'jose';

import { env } from '../env';
import { NAO_CO_AUTHOR } from '../utils/git-identity';
import { getGitOAuthCredential, runGitWithOAuthAsync } from '../utils/git-oauth';

const GITHUB_API = 'https://api.github.com';
const GITHUB_AUTH_RETRY_DELAY_MS = 1_000;

interface ManagedRepositoryInput {
	projectId: string;
	projectName: string;
	projectDir: string;
}

interface ManagedRepository {
	repoFullName: string;
	url: string;
}

interface ManagedGithubConfig {
	org: string;
	appId: string;
	installationId: string;
	privateKey: string;
}

interface GithubRepository {
	full_name: string;
	html_url: string;
}

interface ManagedGithubRepository {
	repository: GithubRepository;
	created: boolean;
}

export async function provisionManagedGithubRepository(
	input: ManagedRepositoryInput,
): Promise<ManagedRepository | null> {
	const config = getManagedGithubConfig();
	if (!config) {
		return null;
	}

	let token = await createInstallationToken(config);
	const repoName = buildRepositoryName(input.projectName, input.projectId);
	const { repository, created } = await getOrCreateRepository(config.org, repoName, token);

	try {
		await initializeRepository(input.projectDir, repository.full_name);
		token = await pushRepositoryWithAuthenticationRetry(input.projectDir, repository.full_name, token, config);
	} catch (error) {
		if (created) {
			try {
				await deleteRepository(repository.full_name, token);
			} catch (cleanupError) {
				throw new Error(
					`Repository publishing failed: ${getErrorMessage(error)}; the newly created repository could not be deleted: ${getErrorMessage(cleanupError)}`,
					{ cause: new AggregateError([error, cleanupError]) },
				);
			}
		}
		throw error;
	}

	return {
		repoFullName: repository.full_name,
		url: repository.html_url,
	};
}

function getManagedGithubConfig(): ManagedGithubConfig | null {
	const values = [
		env.CLOUD_GITHUB_PROJECT_ORG,
		env.CLOUD_GITHUB_PROJECT_APP_ID,
		env.CLOUD_GITHUB_PROJECT_INSTALLATION_ID,
		env.CLOUD_GITHUB_PROJECT_PRIVATE_KEY,
	];

	if (values.every((value) => !value)) {
		if (env.NAO_MODE === 'cloud') {
			throw new Error('Managed GitHub project configuration is required in cloud mode');
		}
		return null;
	}

	const [org, appId, installationId, privateKey] = values;
	if (!org || !appId || !installationId || !privateKey) {
		throw new Error('Missing required GitHub project configuration');
	}

	return {
		org,
		appId,
		installationId,
		privateKey: privateKey.replace(/\\n/g, '\n'),
	};
}

async function createInstallationToken(config: ManagedGithubConfig): Promise<string> {
	const now = Math.floor(Date.now() / 1000);
	const key = createPrivateKey(config.privateKey);
	const jwt = await new SignJWT({})
		.setProtectedHeader({ alg: 'RS256' })
		.setIssuer(config.appId)
		.setIssuedAt(now - 60)
		.setExpirationTime(now + 9 * 60)
		.sign(key);

	const response = await fetch(`${GITHUB_API}/app/installations/${config.installationId}/access_tokens`, {
		method: 'POST',
		headers: githubHeaders(jwt),
	});

	if (!response.ok) {
		throw new Error(`Failed to create installation token: ${response.status}`);
	}

	const body = (await response.json()) as { token: string };
	return body.token;
}

async function getOrCreateRepository(org: string, repoName: string, token: string): Promise<ManagedGithubRepository> {
	const existing = await getRepository(org, repoName, token);
	if (existing) {
		return { repository: existing, created: false };
	}

	const response = await fetch(`${GITHUB_API}/orgs/${org}/repos`, {
		method: 'POST',
		headers: githubHeaders(token),
		body: JSON.stringify({
			name: repoName,
			private: true,
			auto_init: false,
			description: 'nao managed analytics project',
		}),
	});

	if (!response.ok) {
		throw new Error(`Failed to create repository: ${response.status}`);
	}

	return {
		repository: (await response.json()) as GithubRepository,
		created: true,
	};
}

async function getRepository(org: string, repoName: string, token: string): Promise<GithubRepository | null> {
	const response = await fetch(`${GITHUB_API}/repos/${org}/${repoName}`, {
		headers: githubHeaders(token),
	});

	if (response.status === 404) {
		return null;
	}

	if (!response.ok) {
		throw new Error(`Failed to get repository: ${response.status}`);
	}

	return response.json() as Promise<GithubRepository>;
}

async function deleteRepository(repoFullName: string, token: string): Promise<void> {
	const response = await fetch(`${GITHUB_API}/repos/${repoFullName}`, {
		method: 'DELETE',
		headers: githubHeaders(token),
	});

	if (!response.ok) {
		throw new Error(`Failed to delete repository: ${response.status}`);
	}
}

async function initializeRepository(projectDir: string, repoFullName: string): Promise<void> {
	if (!isGitRepository(projectDir)) {
		await runGit(projectDir, ['init', '-b', 'main']);
	}

	await runGit(projectDir, ['add', '-A']);

	const stagedFiles = (await runGit(projectDir, ['diff', '--cached', '--name-only'])).trim();
	if (stagedFiles) {
		assertNoSecrets(stagedFiles);
		await runGit(projectDir, ['commit', '-m', 'Initialize nao project'], {
			GIT_AUTHOR_NAME: NAO_CO_AUTHOR.name,
			GIT_AUTHOR_EMAIL: NAO_CO_AUTHOR.email,
			GIT_COMMITTER_NAME: NAO_CO_AUTHOR.name,
			GIT_COMMITTER_EMAIL: NAO_CO_AUTHOR.email,
		});
	}

	await assertRepositoryHasCommit(projectDir);

	const cleanUrl = `https://github.com/${repoFullName}.git`;
	await setOrigin(projectDir, cleanUrl);
}

async function pushRepositoryWithAuthenticationRetry(
	projectDir: string,
	repoFullName: string,
	token: string,
	config: ManagedGithubConfig,
): Promise<string> {
	try {
		await pushRepository(projectDir, repoFullName, token);
		return token;
	} catch (error) {
		if (!isGithubAuthenticationError(error)) {
			throw error;
		}
	}

	await new Promise((resolve) => setTimeout(resolve, GITHUB_AUTH_RETRY_DELAY_MS));
	const refreshedToken = await createInstallationToken(config);
	await pushRepository(projectDir, repoFullName, refreshedToken);
	return refreshedToken;
}

async function pushRepository(projectDir: string, repoFullName: string, token: string): Promise<void> {
	const cleanUrl = `https://github.com/${repoFullName}.git`;
	await runGitWithOAuthAsync(
		projectDir,
		['push', cleanUrl, 'HEAD:refs/heads/main'],
		getGitOAuthCredential('github', token),
	);
}

function isGithubAuthenticationError(error: unknown): boolean {
	const message = getErrorMessage(error).toLowerCase();
	return message.includes('invalid username or token') || message.includes('authentication failed');
}

function isGitRepository(projectDir: string): boolean {
	return fs.existsSync(path.join(projectDir, '.git'));
}

async function assertRepositoryHasCommit(projectDir: string): Promise<void> {
	try {
		await runGit(projectDir, ['rev-parse', '--verify', 'HEAD']);
	} catch {
		throw new Error('Cannot publish project: no files to commit');
	}
}

async function setOrigin(projectDir: string, url: string): Promise<void> {
	try {
		await runGit(projectDir, ['remote', 'set-url', 'origin', url]);
	} catch {
		await runGit(projectDir, ['remote', 'add', 'origin', url]);
	}
}

function assertNoSecrets(stagedFiles: string): void {
	const forbidden = stagedFiles.split('\n').filter(isEnvironmentFile);
	if (forbidden.length > 0) {
		throw new Error(`Refusing to commit secret files: ${forbidden.join(', ')}`);
	}
}

function isEnvironmentFile(filePath: string): boolean {
	const fileName = filePath.split('/').at(-1);
	return fileName === '.env' || (fileName?.startsWith('.env.') === true && fileName !== '.env.example');
}

function runGit(projectDir: string, args: string[], environment: Record<string, string> = {}): Promise<string> {
	return new Promise((resolve, reject) => {
		execFile(
			'git',
			args,
			{
				cwd: projectDir,
				encoding: 'utf-8',
				timeout: 120_000,
				env: { ...process.env, ...environment },
			},
			(error, stdout, stderr) => {
				if (error) {
					Object.assign(error, { stdout, stderr });
					reject(error);
					return;
				}
				resolve(stdout);
			},
		);
	});
}

function buildRepositoryName(projectName: string, projectId: string): string {
	const slug =
		projectName
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, '-')
			.replace(/^-|-$/g, '')
			.slice(0, 75) || 'project';
	return `nao-${slug}-${projectId.slice(0, 8)}`;
}

function githubHeaders(token: string): Record<string, string> {
	return {
		Authorization: `Bearer ${token}`,
		Accept: 'application/vnd.github+json',
		'Content-Type': 'application/json',
		'X-GitHub-Api-Version': '2022-11-28',
	};
}

function getErrorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
