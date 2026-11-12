import fs from 'node:fs';
import path from 'node:path';

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ getProjectRuntimeEnvVars: vi.fn() }));

vi.mock('../../src/services/project-runtime-env', () => ({
	getProjectRuntimeEnvVars: mocks.getProjectRuntimeEnvVars,
}));

import {
	createUpstreamContextSnapshot,
	listUpstreamBranches,
	listUpstreamRepos,
	readUpstreamChanges,
	UpstreamContextError,
} from '../../src/services/upstream-context.service';
import { commitAll, initRepository, runGit, writeFiles } from '../helpers/context-git-fixture';
import { restoreProcessEnvAfterEach } from '../helpers/process-env-snapshot';
import { useTemporaryFolders } from '../helpers/temporary-folders';

/** Clones each configured repository at its branch like `nao sync` does, and records how it was called. */
const FAKE_NAO_SCRIPT = `#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const config = JSON.parse(fs.readFileSync('nao_config.yaml', 'utf8'));
fs.appendFileSync(path.join(__dirname, 'invocations.jsonl'), JSON.stringify({ args: process.argv.slice(2), config }) + '\\n');
for (const repo of config.repos) {
	const target = path.join('repos', repo.name);
	execFileSync('git', ['clone', '--quiet', '--branch', repo.branch, repo.url, target]);
	if (process.env.MOVE_BRANCH_DURING_SYNC) {
		execFileSync('git', ['-C', repo.url, 'update-ref', 'refs/heads/' + repo.branch, 'main']);
	}
	fs.rmSync(path.join(target, '.git'), { recursive: true, force: true });
}
`;

const createTemporaryFolder = useTemporaryFolders();
restoreProcessEnvAfterEach();
let root: string;
let upstreamFolder: string;
let projectFolder: string;
let fakeNaoFolder: string;

beforeEach(() => {
	mocks.getProjectRuntimeEnvVars.mockResolvedValue({});
	root = fs.realpathSync(createTemporaryFolder('nao-upstream-context-'));
	upstreamFolder = path.join(root, 'business');
	projectFolder = path.join(root, 'context');
	fakeNaoFolder = path.join(root, 'bin');
	writeFiles(upstreamFolder, {
		'revenue.md': 'Revenue includes every order.\n',
		'legacy.md': 'Old definition.\n',
	});
	initRepository(upstreamFolder);
	commitAll(upstreamFolder, 'initial');
	runGit(upstreamFolder, ['switch', '--quiet', '-c', 'analyst/net-revenue']);
	writeFiles(upstreamFolder, {
		'revenue.md': 'Revenue excludes returned orders.\n',
		'margin.md': 'Margin is revenue minus cost.\n',
	});
	fs.rmSync(path.join(upstreamFolder, 'legacy.md'));
	commitAll(upstreamFolder, 'net revenue');
	runGit(upstreamFolder, ['switch', '--quiet', 'main']);

	writeFiles(projectFolder, {
		'nao_config.yaml': [
			'project_name: fibi',
			'repos:',
			'  - name: business',
			`    url: ${upstreamFolder}`,
			'    branch: main',
			'    exclude: ["tests/**"]',
			'  - name: local-notes',
			'    local_path: ./notes',
			'',
		].join('\n'),
		'RULES.md': '# Rules\n',
		'repos/business/revenue.md': 'Revenue includes every order.\n',
		'repos/business/legacy.md': 'Old definition.\n',
	});
	writeFiles(fakeNaoFolder, { nao: FAKE_NAO_SCRIPT });
	fs.chmodSync(path.join(fakeNaoFolder, 'nao'), 0o755);
	process.env.PATH = `${fakeNaoFolder}${path.delimiter}${process.env.PATH}`;
});

const BRANCHES_INPUT = () => ({ projectId: 'project-1', projectFolder, repo: 'business', userId: 'user-1' });

describe('listUpstreamRepos', () => {
	it('lists the git repositories of the project, not its local folders', async () => {
		expect(await listUpstreamRepos('project-1', projectFolder)).toEqual([
			{ name: 'business', url: upstreamFolder, branch: 'main' },
		]);
	});
});

describe('listUpstreamBranches', () => {
	it('lists the remote branches with the production one first', async () => {
		const branches = await listUpstreamBranches(BRANCHES_INPUT());

		expect(branches.map((branch) => branch.name)).toEqual(['main', 'analyst/net-revenue']);
		expect(branches[1].commit).toBe(runGit(upstreamFolder, ['rev-parse', 'analyst/net-revenue']).toString().trim());
	});

	it('resolves a repository URL written as an env reference with the project variables', async () => {
		writeFiles(projectFolder, {
			'nao_config.yaml': [
				'project_name: fibi',
				'repos:',
				'  - name: business',
				`    url: "{{ env('BUSINESS_REPO_URL') }}"`,
				'',
			].join('\n'),
		});
		mocks.getProjectRuntimeEnvVars.mockResolvedValue({ BUSINESS_REPO_URL: upstreamFolder });

		const branches = await listUpstreamBranches(BRANCHES_INPUT());

		expect(branches.map((branch) => branch.name)).toContain('analyst/net-revenue');
		expect(mocks.getProjectRuntimeEnvVars).toHaveBeenCalledWith('project-1');
	});
});

describe('createUpstreamContextSnapshot', () => {
	it('replaces the synced repository with its branch in a copy of production and lists the changes', async () => {
		const snapshot = await createUpstreamContextSnapshot({
			projectId: 'project-1',
			projectFolder,
			userId: 'user-1',
			upstream: { repo: 'business', branch: 'analyst/net-revenue' },
		});

		expect(snapshot.ref).toBe('business:analyst/net-revenue');
		expect(snapshot.commit).toBe(runGit(upstreamFolder, ['rev-parse', 'analyst/net-revenue']).toString().trim());
		expect(snapshot.changes).toEqual([
			{ path: 'repos/business/legacy.md', kind: 'deleted' },
			{ path: 'repos/business/margin.md', kind: 'added' },
			{ path: 'repos/business/revenue.md', kind: 'modified' },
		]);
		expect(fs.readFileSync(path.join(snapshot.folder, 'repos/business/revenue.md'), 'utf8')).toBe(
			'Revenue excludes returned orders.\n',
		);
		expect(fs.readFileSync(path.join(snapshot.folder, 'RULES.md'), 'utf8')).toBe('# Rules\n');
		expect(fs.readFileSync(path.join(projectFolder, 'repos/business/revenue.md'), 'utf8')).toBe(
			'Revenue includes every order.\n',
		);
		const snapshotsRoot = path.dirname(snapshot.folder);
		expect(fs.readdirSync(snapshotsRoot).filter((entry) => entry !== path.basename(snapshot.folder))).toEqual([
			expect.stringMatching(/^upstream-business-[0-9a-f]{40}-[0-9a-f]{12}$/),
		]);
	});

	it('syncs the repository with its production filters at the picked branch only', async () => {
		await createUpstreamContextSnapshot({
			projectId: 'project-1',
			projectFolder,
			userId: 'user-1',
			upstream: { repo: 'business', branch: 'analyst/net-revenue' },
		});

		const [invocation] = readNaoInvocations();
		expect(invocation.args).toEqual(['sync', '--provider', 'repos:business']);
		expect(invocation.config.repos).toEqual([
			{ name: 'business', url: upstreamFolder, branch: 'analyst/net-revenue', exclude: ['tests/**'] },
		]);
	});

	it.each([
		{ upstream: { repo: 'business', branch: 'missing' }, message: /Branch missing does not exist/ },
		{ upstream: { repo: 'local-notes', branch: 'main' }, message: /No git repository named local-notes/ },
	])('rejects $upstream.repo:$upstream.branch without leaving a snapshot', async ({ upstream, message }) => {
		const attempt = createUpstreamContextSnapshot({
			projectId: 'project-1',
			projectFolder,
			userId: 'user-1',
			upstream,
		});

		await expect(attempt).rejects.toBeInstanceOf(UpstreamContextError);
		await expect(attempt).rejects.toThrow(message);
		expect(fs.existsSync(path.join(root, '.nao'))).toBe(false);
	});
});

describe('readUpstreamChanges', () => {
	it('lists the changed files with their production and branch contents', async () => {
		const upstreamChanges = await readUpstreamChanges(netRevenueInput());

		expect(upstreamChanges.ref).toBe('business:analyst/net-revenue');
		expect(upstreamChanges.reviewRequest).toBeNull();
		expect(upstreamChanges.changes).toEqual([
			{
				path: 'repos/business/legacy.md',
				kind: 'deleted',
				productionContent: 'Old definition.\n',
				branchContent: null,
			},
			{
				path: 'repos/business/margin.md',
				kind: 'added',
				productionContent: null,
				branchContent: 'Margin is revenue minus cost.\n',
			},
			{
				path: 'repos/business/revenue.md',
				kind: 'modified',
				productionContent: 'Revenue includes every order.\n',
				branchContent: 'Revenue excludes returned orders.\n',
			},
		]);
	});

	it('refuses a sync during which the branch received new commits', async () => {
		mocks.getProjectRuntimeEnvVars.mockResolvedValue({ MOVE_BRANCH_DURING_SYNC: '1' });

		await expect(readUpstreamChanges(netRevenueInput())).rejects.toThrow(
			'received new commits while it was syncing',
		);
	});

	it('syncs a branch once per commit, so the run reuses the sync of the review', async () => {
		await readUpstreamChanges(netRevenueInput());
		await createUpstreamContextSnapshot(netRevenueInput());
		expect(readNaoInvocations()).toHaveLength(1);

		runGit(upstreamFolder, ['switch', '--quiet', 'analyst/net-revenue']);
		writeFiles(upstreamFolder, { 'margin.md': 'Margin is revenue minus cost and fees.\n' });
		commitAll(upstreamFolder, 'fees');
		const upstreamChanges = await readUpstreamChanges(netRevenueInput());

		expect(readNaoInvocations()).toHaveLength(2);
		expect(upstreamChanges.changes.find((change) => change.path.endsWith('margin.md'))?.branchContent).toBe(
			'Margin is revenue minus cost and fees.\n',
		);
	});
});

function netRevenueInput() {
	return {
		projectId: 'project-1',
		projectFolder,
		userId: 'user-1',
		upstream: { repo: 'business', branch: 'analyst/net-revenue' },
	};
}

function readNaoInvocations(): { args: string[]; config: { repos: unknown[] } }[] {
	return fs
		.readFileSync(path.join(fakeNaoFolder, 'invocations.jsonl'), 'utf8')
		.trim()
		.split('\n')
		.map((line) => JSON.parse(line));
}
