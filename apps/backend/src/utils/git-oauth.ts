import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

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
