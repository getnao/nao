import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import type { GitPlatform } from './context-repo';
import { detectGitPlatform, sanitizeContextSourceRepositoryUrl } from './context-repo';
import { toGitError } from './git-repo';

const ASKPASS_SCRIPT = `#!/bin/sh
case "$1" in
  *Username*) printf '%s\\n' "$NAO_GIT_USERNAME" ;;
  *) printf '%s\\n' "$NAO_GIT_TOKEN" ;;
esac
`;

export interface GitOAuthCredential {
	token: string;
	username: string;
}

export interface GitRemoteCredentialOptions {
	platform?: GitPlatform | null;
	sshKey?: string;
	token?: string;
}

export function getGitOAuthCredential(provider: 'github' | 'gitlab', token: string): GitOAuthCredential {
	return {
		token,
		username: provider === 'gitlab' ? 'oauth2' : 'x-access-token',
	};
}

export async function runGitWithOAuth(
	cwd: string,
	args: string[],
	credential: GitOAuthCredential,
	timeout = 120_000,
): Promise<Buffer> {
	return runGitWithAskpass(cwd, args, credential, timeout);
}

export async function runGitFetchWithCredentials(
	cwd: string,
	repositoryUrl: string,
	branch: string,
	options: GitRemoteCredentialOptions,
	timeout = 120_000,
): Promise<Buffer> {
	const sanitizedUrl = sanitizeContextSourceRepositoryUrl(repositoryUrl);
	const args = ['fetch', '--no-tags', sanitizedUrl, branch];
	if (options.sshKey) {
		return runGitWithSshKey(cwd, args, options.sshKey, timeout);
	}
	if (options.token) {
		const platform = options.platform ?? detectGitPlatform(repositoryUrl);
		return runGitWithAskpass(cwd, args, { token: options.token, username: getTokenUsername(platform) }, timeout);
	}
	const embeddedCredential = readEmbeddedCredential(repositoryUrl, options.platform);
	return embeddedCredential
		? runGitWithAskpass(cwd, args, embeddedCredential, timeout)
		: runRemoteGit(cwd, args, timeout);
}

/** Runs a git command that talks to a remote without blocking the event loop. */
export async function runRemoteGit(cwd: string, args: string[], timeout = 120_000): Promise<Buffer> {
	try {
		return await execGit(cwd, args, timeout, { ...process.env, GIT_TERMINAL_PROMPT: '0' });
	} catch (error) {
		throw toGitError(error);
	}
}

export function getGitRemoteCredentialSecrets(
	repositoryUrl: string | undefined,
	options: Pick<GitRemoteCredentialOptions, 'sshKey' | 'token'>,
): string[] {
	const embeddedCredential = repositoryUrl ? readEmbeddedCredential(repositoryUrl) : null;
	return [options.token, options.sshKey, embeddedCredential?.username, embeddedCredential?.token].filter(
		(value): value is string => !!value,
	);
}

async function runGitWithAskpass(
	cwd: string,
	args: string[],
	credential: GitOAuthCredential,
	timeout: number,
): Promise<Buffer> {
	const helperDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'nao-git-auth-'));
	const helperPath = path.join(helperDirectory, 'askpass');
	try {
		fs.writeFileSync(helperPath, ASKPASS_SCRIPT, { mode: 0o700 });
		return await execGit(cwd, args, timeout, {
			...process.env,
			GIT_ASKPASS: helperPath,
			GIT_TERMINAL_PROMPT: '0',
			NAO_GIT_TOKEN: credential.token,
			NAO_GIT_USERNAME: credential.username,
		});
	} catch (error) {
		throw toGitError(error);
	} finally {
		fs.rmSync(helperDirectory, { recursive: true, force: true });
	}
}

async function runGitWithSshKey(cwd: string, args: string[], sshKey: string, timeout: number): Promise<Buffer> {
	const helperDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'nao-git-ssh-'));
	const keyPath = path.join(helperDirectory, 'key');
	try {
		fs.writeFileSync(keyPath, sshKey, { mode: 0o600 });
		const sshCommand = `${process.env.GIT_SSH_COMMAND?.trim() || 'ssh'} -i ${quoteShellArgument(keyPath)} -o IdentitiesOnly=yes`;
		return await execGit(cwd, args, timeout, {
			...process.env,
			GIT_SSH_COMMAND: sshCommand,
			GIT_TERMINAL_PROMPT: '0',
		});
	} catch (error) {
		throw toGitError(error);
	} finally {
		fs.rmSync(helperDirectory, { recursive: true, force: true });
	}
}

function execGit(cwd: string, args: string[], timeout: number, env: NodeJS.ProcessEnv): Promise<Buffer> {
	return new Promise((resolve, reject) => {
		execFile('git', args, { cwd, timeout, env, encoding: 'buffer' }, (error, stdout, stderr) => {
			if (error) {
				Object.assign(error, { stdout, stderr });
				reject(error);
				return;
			}
			resolve(Buffer.isBuffer(stdout) ? stdout : Buffer.from(stdout));
		});
	});
}

function readEmbeddedCredential(repositoryUrl: string, platform?: GitPlatform | null): GitOAuthCredential | null {
	if (!/^https?:\/\//i.test(repositoryUrl)) {
		return null;
	}
	try {
		const parsed = new URL(repositoryUrl);
		if (!parsed.username && !parsed.password) {
			return null;
		}
		return {
			username:
				decodeURIComponent(parsed.username) || getTokenUsername(platform ?? detectGitPlatform(repositoryUrl)),
			token: decodeURIComponent(parsed.password),
		};
	} catch {
		return null;
	}
}

function getTokenUsername(platform: GitPlatform | null | undefined): string {
	return platform === 'github'
		? 'x-access-token'
		: platform === 'gitlab'
			? 'oauth2'
			: platform === 'bitbucket'
				? 'x-token-auth'
				: 'git';
}

function quoteShellArgument(value: string): string {
	return `'${value.replaceAll("'", "'\\''")}'`;
}
