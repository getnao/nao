import { execFileSync } from 'node:child_process';
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

export function runGitWithOAuth(
	cwd: string,
	args: string[],
	credential: GitOAuthCredential,
	timeout = 120_000,
): Buffer {
	return runGitWithAskpass(cwd, args, credential, timeout);
}

export function runGitFetchWithCredentials(
	cwd: string,
	repositoryUrl: string,
	branch: string,
	options: GitRemoteCredentialOptions,
	timeout = 120_000,
): Buffer {
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
	return embeddedCredential ? runGitWithAskpass(cwd, args, embeddedCredential, timeout) : runGit(cwd, args, timeout);
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

function runGitWithAskpass(cwd: string, args: string[], credential: GitOAuthCredential, timeout: number): Buffer {
	const helperDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'nao-git-auth-'));
	const helperPath = path.join(helperDirectory, 'askpass');
	try {
		fs.writeFileSync(helperPath, ASKPASS_SCRIPT, { mode: 0o700 });
		return execFileSync('git', args, {
			cwd,
			stdio: 'pipe',
			timeout,
			env: {
				...process.env,
				GIT_ASKPASS: helperPath,
				GIT_TERMINAL_PROMPT: '0',
				NAO_GIT_TOKEN: credential.token,
				NAO_GIT_USERNAME: credential.username,
			},
		});
	} catch (error) {
		throw toGitError(error);
	} finally {
		fs.rmSync(helperDirectory, { recursive: true, force: true });
	}
}

function runGitWithSshKey(cwd: string, args: string[], sshKey: string, timeout: number): Buffer {
	const helperDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'nao-git-ssh-'));
	const keyPath = path.join(helperDirectory, 'key');
	try {
		fs.writeFileSync(keyPath, sshKey, { mode: 0o600 });
		const sshCommand = `${process.env.GIT_SSH_COMMAND?.trim() || 'ssh'} -i ${quoteShellArgument(keyPath)} -o IdentitiesOnly=yes`;
		return execFileSync('git', args, {
			cwd,
			stdio: 'pipe',
			timeout,
			env: {
				...process.env,
				GIT_SSH_COMMAND: sshCommand,
				GIT_TERMINAL_PROMPT: '0',
			},
		});
	} catch (error) {
		throw toGitError(error);
	} finally {
		fs.rmSync(helperDirectory, { recursive: true, force: true });
	}
}

function runGit(cwd: string, args: string[], timeout: number): Buffer {
	try {
		return execFileSync('git', args, {
			cwd,
			stdio: 'pipe',
			timeout,
			env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
		});
	} catch (error) {
		throw toGitError(error);
	}
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
