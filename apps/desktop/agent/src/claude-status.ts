import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import type { AccountInfo } from '@anthropic-ai/claude-agent-sdk';
import type { LocalAgentStatus } from '@nao/shared/local-agent';

import { type ClaudeExecutable, findClaudeExecutable } from './claude-executable';
import { withProbeSession } from './claude-probe';

const execFileAsync = promisify(execFile);
const VERSION_TIMEOUT_MS = 10_000;
const READY_STATUS_TTL_MS = 5 * 60 * 1000;

let cachedReadyStatus: { status: LocalAgentStatus; checkedAt: number } | undefined;

/** Whether Claude Code is installed and signed in, read without sending anything to the model. */
export async function getClaudeStatus(refresh = false): Promise<LocalAgentStatus> {
	if (!refresh && cachedReadyStatus && Date.now() - cachedReadyStatus.checkedAt < READY_STATUS_TTL_MS) {
		return cachedReadyStatus.status;
	}
	const status = await probeClaude();
	cachedReadyStatus = status.state === 'ready' ? { status, checkedAt: Date.now() } : undefined;
	return status;
}

async function probeClaude(): Promise<LocalAgentStatus> {
	const claude = await findClaudeExecutable();
	if (!claude) {
		return { state: 'not-installed' };
	}
	try {
		const version = await readVersion(claude);
		const initialization = await withProbeSession(claude, (_session, result) => result);
		if (!isSignedIn(initialization.account)) {
			return { state: 'not-logged-in', version };
		}
		return {
			state: 'ready',
			version,
			account: { email: initialization.account.email, subscriptionType: initialization.account.subscriptionType },
			models: initialization.models.map(({ value, displayName, description }) => ({
				value,
				displayName,
				description,
			})),
		};
	} catch (error) {
		return { state: 'error', message: error instanceof Error ? error.message : String(error) };
	}
}

async function readVersion(claude: ClaudeExecutable): Promise<string> {
	const { stdout } = await execFileAsync(claude.path, ['--version'], {
		timeout: VERSION_TIMEOUT_MS,
		env: claude.env,
	});
	return stdout.trim().split(/\s+/)[0] ?? stdout.trim();
}

/** Only an account with no token and no key at all is signed out; API keys and cloud providers count. */
function isSignedIn(account: AccountInfo): boolean {
	const hasToken = !!account.tokenSource && account.tokenSource !== 'none';
	const hasApiKey = !!account.apiKeySource && account.apiKeySource !== 'none';
	const usesCloudProvider = !!account.apiProvider && account.apiProvider !== 'firstParty';
	return hasToken || hasApiKey || usesCloudProvider || !!account.subscriptionType || !!account.email;
}
