import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';

import type { LinkedContextRepo } from '../types/context-recommendation';
import type { TestContextChange } from '../types/test-run';
import { extractConfiguredRepos, extractRawRepoConfig } from '../utils/nao-config';
import {
	copyProductionContext,
	getSnapshotsRoot,
	readRegularFile,
	removeContextSnapshot,
} from './draft-context.service';
import { getProjectRuntimeEnvVars } from './project-runtime-env';
import { REVIEW_REQUEST_PROVIDERS, type ReviewRequest } from './review-request-provider';

const execFileAsync = promisify(execFile);

const LIST_BRANCHES_TIMEOUT_MS = 30_000;
const SYNC_TIMEOUT_MS = 10 * 60_000;
const COMMAND_OUTPUT_LIMIT = 2_000;
const SYNC_PROJECT_NAME = 'upstream-branch-sync';
const BRANCH_REF_PREFIX = 'refs/heads/';
const MAX_DIFF_FILE_BYTES = 1024 * 1024;
/** What `nao sync` and git need from the server environment: no secret of the project or the server. */
const INHERITED_ENV_NAMES = [
	'PATH',
	'HOME',
	'TMPDIR',
	'LANG',
	'LC_ALL',
	'VIRTUAL_ENV',
	'SSH_AUTH_SOCK',
	'SSL_CERT_FILE',
	'REQUESTS_CA_BUNDLE',
	'HTTPS_PROXY',
	'HTTP_PROXY',
	'NO_PROXY',
];

/** A git repository of `nao_config.yaml` whose branches can be tested before they reach production. */
export interface UpstreamRepo {
	name: string;
	url: string;
	/** The branch production syncs, the remote default branch when null. */
	branch: string | null;
}

export interface UpstreamBranch {
	name: string;
	commit: string;
}

export interface UpstreamBranchRef {
	repo: string;
	branch: string;
}

export interface UpstreamContextSnapshot {
	folder: string;
	/** Names the tested branch in runs, such as `business-context:analyst/orders`. */
	ref: string;
	commit: string;
	changes: TestContextChange[];
}

export interface UpstreamFileChange extends TestContextChange {
	/** Null when the file does not exist on that side or cannot be shown as text. */
	productionContent: string | null;
	branchContent: string | null;
}

export interface UpstreamChanges {
	ref: string;
	commit: string;
	changes: UpstreamFileChange[];
	/** The pull or merge request of the branch, when its repository is on a connected GitHub or GitLab. */
	reviewRequest: ReviewRequest | null;
}

interface UpstreamBranchInput {
	projectId: string;
	projectFolder: string;
	userId: string;
	upstream: UpstreamBranchRef;
}

interface SyncedUpstreamBranch {
	/** The repository as `nao sync` writes it at the branch head. */
	folder: string;
	contextPath: string;
	ref: string;
	commit: string;
}

/** Raised when the repository or branch cannot be tested, with a message the user can act on. */
export class UpstreamContextError extends Error {}

interface GitRemote {
	repo: UpstreamRepo;
	linkedRepo: LinkedContextRepo;
	env: NodeJS.ProcessEnv;
	/** Removed from command output, as git may print the authenticated URL. */
	secret: string | null;
}

export async function listUpstreamRepos(projectId: string, projectFolder: string): Promise<UpstreamRepo[]> {
	const repos = extractConfiguredRepos(projectFolder, await getProjectRuntimeEnvVars(projectId));
	return repos.flatMap((repo) => (repo.url ? [{ name: repo.name, url: repo.url, branch: repo.branch }] : []));
}

export async function listUpstreamBranches(input: {
	projectId: string;
	projectFolder: string;
	repo: string;
	userId: string;
}): Promise<UpstreamBranch[]> {
	const remote = await resolveGitRemote(input);
	return readRemoteBranches(remote);
}

/**
 * Copies the production context and replaces one synced repository with its content at the given branch, synced
 * the way production syncs it, so the copy differs from production by that branch's changes only.
 */
export async function createUpstreamContextSnapshot(input: UpstreamBranchInput): Promise<UpstreamContextSnapshot> {
	const remote = await resolveGitRemote({ ...input, repo: input.upstream.repo });
	const synced = await syncUpstreamBranch(input, remote);
	const folder = copyProductionContext(input.projectId, input.projectFolder);
	try {
		const snapshotRepoFolder = path.join(folder, synced.contextPath);
		const changes = listRepoChanges(snapshotRepoFolder, synced);
		fs.rmSync(snapshotRepoFolder, { recursive: true, force: true });
		fs.cpSync(synced.folder, snapshotRepoFolder, {
			recursive: true,
			filter: (source) => !fs.lstatSync(source).isSymbolicLink(),
		});
		return { folder, ref: synced.ref, commit: synced.commit, changes };
	} catch (error) {
		removeContextSnapshot(folder);
		throw error;
	}
}

/** The files the branch changes in the context, with their production and branch contents, to review before a run. */
export async function readUpstreamChanges(input: UpstreamBranchInput): Promise<UpstreamChanges> {
	const remote = await resolveGitRemote({ ...input, repo: input.upstream.repo });
	const [synced, reviewRequest] = await Promise.all([
		syncUpstreamBranch(input, remote),
		findUpstreamReviewRequest(remote, input),
	]);
	const productionRepoFolder = path.join(input.projectFolder, synced.contextPath);
	const changes = listRepoChanges(productionRepoFolder, synced).map((change) => {
		const repoPath = change.path.slice(synced.contextPath.length + 1);
		return {
			...change,
			productionContent: readTextFile(productionRepoFolder, repoPath),
			branchContent: readTextFile(synced.folder, repoPath),
		};
	});
	return { ref: synced.ref, commit: synced.commit, changes, reviewRequest };
}

/** A failed lookup only hides the link, as the changes can be reviewed and tested without it. */
async function findUpstreamReviewRequest(remote: GitRemote, input: UpstreamBranchInput): Promise<ReviewRequest | null> {
	const { linkedRepo } = remote;
	if (!linkedRepo.provider || !linkedRepo.repoFullName) {
		return null;
	}
	const provider = REVIEW_REQUEST_PROVIDERS[linkedRepo.provider];
	try {
		const token = await provider.getToken(input.userId);
		return token
			? await provider.findReviewRequestByBranch(token, linkedRepo.repoFullName, input.upstream.branch)
			: null;
	} catch {
		return null;
	}
}

/**
 * Syncs the repository at the branch head once per commit and filters, so reviewing the changes and running the
 * tests share one sync. The cache lives with the run snapshots, which removes it once unused for hours.
 */
async function syncUpstreamBranch(input: UpstreamBranchInput, remote: GitRemote): Promise<SyncedUpstreamBranch> {
	const branch = await readBranchHead(remote, input.upstream.branch);
	const repoConfig = { ...extractRawRepoConfig(input.projectFolder, remote.repo.name), branch: branch.name };
	const folder = path.join(
		getSnapshotsRoot(input.projectFolder, input.projectId),
		`upstream-${toFolderName(remote.repo.name)}-${branch.commit}-${hashConfig(repoConfig)}`,
	);
	if (!fs.existsSync(folder)) {
		await syncIntoCache(remote, repoConfig, folder);
		await assertBranchStayedAt(remote, branch, folder);
	}
	const now = new Date();
	fs.utimesSync(folder, now, now);
	return {
		folder,
		contextPath: `repos/${remote.repo.name}`,
		ref: `${remote.repo.name}:${branch.name}`,
		commit: branch.commit,
	};
}

async function readBranchHead(remote: GitRemote, branchName: string): Promise<UpstreamBranch> {
	const branch = (await readRemoteBranches(remote)).find((candidate) => candidate.name === branchName);
	if (!branch) {
		throw new UpstreamContextError(`Branch ${branchName} does not exist in ${remote.repo.url}.`);
	}
	return branch;
}

/**
 * `nao sync` clones the branch by name, so a push during the sync would leave newer files cached under the older
 * commit. The cache is dropped then, for the next sync to pick up the new commit.
 */
async function assertBranchStayedAt(remote: GitRemote, branch: UpstreamBranch, folder: string): Promise<void> {
	const head = await readBranchHead(remote, branch.name);
	if (head.commit !== branch.commit) {
		removeContextSnapshot(folder);
		throw new UpstreamContextError(`Branch ${branch.name} received new commits while it was syncing. Try again.`);
	}
}

/** Syncs into a folder of its own then moves it in place, so a concurrent sync of the same commit cannot mix files. */
async function syncIntoCache(remote: GitRemote, repoConfig: Record<string, unknown>, folder: string): Promise<void> {
	const syncFolder = `${folder}-${randomUUID()}`;
	try {
		const syncedRepoFolder = await syncRepo(remote, repoConfig, syncFolder);
		try {
			fs.renameSync(syncedRepoFolder, folder);
		} catch (error) {
			if (!fs.existsSync(folder)) {
				throw error;
			}
		}
	} finally {
		removeContextSnapshot(syncFolder);
	}
}

function listRepoChanges(productionRepoFolder: string, synced: SyncedUpstreamBranch): TestContextChange[] {
	return diffFolders(productionRepoFolder, synced.folder).map((change) => ({
		...change,
		path: `${synced.contextPath}/${change.path}`,
	}));
}

/** Null for a missing, oversized or binary file, which the diff cannot show as text. */
function readTextFile(root: string, repoPath: string): string | null {
	const content = readRegularFile(root, repoPath);
	if (!content || content.length > MAX_DIFF_FILE_BYTES || content.includes(0)) {
		return null;
	}
	return content.toString('utf8');
}

function toFolderName(name: string): string {
	return name.replace(/[^A-Za-z0-9_.-]/g, '_');
}

function hashConfig(config: Record<string, unknown>): string {
	return createHash('sha256').update(JSON.stringify(config)).digest('hex').slice(0, 12);
}

/** The project's variables resolve the `{{ env(...) }}` references of the repository settings, as in production. */
async function resolveGitRemote(input: {
	projectId: string;
	projectFolder: string;
	repo: string;
	userId: string;
}): Promise<GitRemote> {
	const envVars = await getProjectRuntimeEnvVars(input.projectId);
	const linkedRepo = extractConfiguredRepos(input.projectFolder, envVars).find((repo) => repo.name === input.repo);
	if (!linkedRepo?.url) {
		throw new UpstreamContextError(`No git repository named ${input.repo} is configured in nao_config.yaml.`);
	}
	const repo = { name: linkedRepo.name, url: linkedRepo.url, branch: linkedRepo.branch };
	const authenticatedUrl = await resolveAuthenticatedUrl(linkedRepo, input.userId);
	return {
		repo,
		linkedRepo,
		env: createGitEnvironment(repo.url, authenticatedUrl, envVars),
		secret: authenticatedUrl,
	};
}

/** Uses the user's GitHub or GitLab account when connected, else whatever git credentials the server has. */
async function resolveAuthenticatedUrl(repo: LinkedContextRepo, userId: string): Promise<string | null> {
	if (!repo.provider || !repo.repoFullName) {
		return null;
	}
	const provider = REVIEW_REQUEST_PROVIDERS[repo.provider];
	const token = await provider.getToken(userId);
	return token ? provider.authenticatedRepoUrl(token, repo.repoFullName) : null;
}

/**
 * Git reads the URL rewrite from the environment, so the token reaches `nao sync` without being written to disk. The
 * project's variables go along, for `nao sync` to resolve the repository settings as in production.
 */
function createGitEnvironment(
	url: string,
	authenticatedUrl: string | null,
	envVars: Record<string, string>,
): NodeJS.ProcessEnv {
	const env: NodeJS.ProcessEnv = { ...envVars, GIT_TERMINAL_PROMPT: '0' };
	for (const name of INHERITED_ENV_NAMES) {
		if (process.env[name] !== undefined) {
			env[name] = process.env[name];
		}
	}
	if (authenticatedUrl) {
		env.GIT_CONFIG_COUNT = '1';
		env.GIT_CONFIG_KEY_0 = `url.${authenticatedUrl}.insteadOf`;
		env.GIT_CONFIG_VALUE_0 = url;
	}
	return env;
}

async function readRemoteBranches(remote: GitRemote): Promise<UpstreamBranch[]> {
	const output = await runCommand(remote, 'git', ['ls-remote', '--heads', '--', remote.repo.url], {
		timeout: LIST_BRANCHES_TIMEOUT_MS,
	});
	const branches = output.split('\n').flatMap((line) => {
		const [commit, ref] = line.trim().split('\t');
		return commit && ref?.startsWith(BRANCH_REF_PREFIX)
			? [{ name: ref.slice(BRANCH_REF_PREFIX.length), commit }]
			: [];
	});
	return sortProductionBranchFirst(branches, remote.repo.branch);
}

function sortProductionBranchFirst(branches: UpstreamBranch[], productionBranch: string | null): UpstreamBranch[] {
	return [...branches].sort((left, right) => {
		if (left.name === productionBranch || right.name === productionBranch) {
			return left.name === productionBranch ? -1 : 1;
		}
		return left.name.localeCompare(right.name);
	});
}

/** Runs `nao sync` on a project holding only this repository, so no database or template of production is touched. */
async function syncRepo(remote: GitRemote, repoConfig: Record<string, unknown>, syncFolder: string): Promise<string> {
	fs.mkdirSync(syncFolder, { recursive: true });
	fs.writeFileSync(
		path.join(syncFolder, 'nao_config.yaml'),
		JSON.stringify({ project_name: SYNC_PROJECT_NAME, repos: [repoConfig] }, null, 2),
	);
	await runCommand(remote, 'nao', ['sync', '--provider', `repos:${remote.repo.name}`], {
		cwd: syncFolder,
		timeout: SYNC_TIMEOUT_MS,
	});
	const syncedRepoFolder = path.join(syncFolder, 'repos', remote.repo.name);
	if (!fs.existsSync(syncedRepoFolder)) {
		throw new UpstreamContextError(`nao sync did not sync ${remote.repo.name} at branch ${repoConfig.branch}.`);
	}
	return syncedRepoFolder;
}

async function runCommand(
	remote: GitRemote,
	command: string,
	args: string[],
	options: { cwd?: string; timeout: number },
): Promise<string> {
	try {
		const { stdout } = await execFileAsync(command, args, {
			...options,
			env: remote.env,
			maxBuffer: 64 * 1024 * 1024,
		});
		return stdout;
	} catch (error) {
		throw new UpstreamContextError(`${command} ${args[0]} failed: ${describeCommandError(error, remote.secret)}`);
	}
}

function describeCommandError(error: unknown, secret: string | null): string {
	const failure = error as { code?: unknown; stdout?: string; stderr?: string; message?: string };
	if (failure.code === 'ENOENT') {
		return 'the command is not installed on the server.';
	}
	const output = [failure.stderr, failure.stdout].filter(Boolean).join('\n').trim() || failure.message || '';
	const redacted = secret ? output.replaceAll(secret, '***') : output;
	return redacted.slice(-COMMAND_OUTPUT_LIMIT);
}

/** The files that differ between two folders, compared by content, with paths relative to them. */
function diffFolders(before: string, after: string): TestContextChange[] {
	const beforeFiles = listFiles(before);
	const afterFiles = listFiles(after);
	const changes: TestContextChange[] = [];
	for (const file of afterFiles) {
		if (!beforeFiles.has(file)) {
			changes.push({ path: file, kind: 'added' });
		} else if (!haveSameContent(path.join(before, file), path.join(after, file))) {
			changes.push({ path: file, kind: 'modified' });
		}
	}
	for (const file of beforeFiles) {
		if (!afterFiles.has(file)) {
			changes.push({ path: file, kind: 'deleted' });
		}
	}
	return changes.sort((left, right) => left.path.localeCompare(right.path));
}

/** Sizes are compared first, so most changed files are told apart without reading them. */
function haveSameContent(left: string, right: string): boolean {
	if (fs.statSync(left).size !== fs.statSync(right).size) {
		return false;
	}
	return fs.readFileSync(left).equals(fs.readFileSync(right));
}

function listFiles(root: string): Set<string> {
	if (!fs.existsSync(root)) {
		return new Set();
	}
	const files = fs
		.readdirSync(root, { recursive: true, withFileTypes: true })
		.filter((entry) => entry.isFile())
		.map((entry) => path.relative(root, path.join(entry.parentPath, entry.name)).split(path.sep).join('/'));
	return new Set(files);
}
